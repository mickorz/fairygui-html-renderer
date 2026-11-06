// Inspector（沿袭 egret 项目 P3-A P2 inspector，适配 FairyGUI Scene JSON 字段）
// 只读 Scene JSON（ED.index），禁止从 DOM/CSS 反推
// 分组：Basic（节点身份）/ Transform（xy/size + 变换属性）/ Image（资源）/ Text（文本属性）
//   / Component（组件溯源：展开来源）/ Advanced（attrs + gears，默认折叠）/ Diagnostics（未支持上报）
// DOM 安全：动态值一律 DOM API + textContent，外部工程数据不裸拼 innerHTML；空分组整组隐藏

export function inspectorScript(): string {
  return `
// ---- Inspector（inspector） ----
(function () {
  var el = document.getElementById("inspector");
  var EMPTY = '<div class="empty">请选择一个节点<br/><br/>在左侧 Scene Tree 或中间 Canvas<br/>点击一个节点查看它的属性。</div>';

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function kv(k, v) {
    var row = document.createElement("div");
    row.className = "kv";
    var ke = document.createElement("span");
    ke.className = "k";
    ke.textContent = k;
    var ve = document.createElement("span");
    ve.className = "v";
    if (v === null || v === undefined || v === "") ve.textContent = "—";
    else if (typeof v === "object" && v.nodeType) ve.appendChild(v);
    else ve.textContent = String(v);
    row.appendChild(ke);
    row.appendChild(ve);
    return row;
  }
  function kvCopy(k, v) {
    var ve = document.createElement("span");
    var txt = document.createElement("span");
    txt.textContent = v == null ? "—" : String(v);
    ve.appendChild(txt);
    if (v != null && String(v).length) {
      var btn = document.createElement("button");
      btn.textContent = "复制";
      btn.onclick = function () {
        var s = String(v);
        if (navigator.clipboard) navigator.clipboard.writeText(s).then(function () { btn.textContent = "已复制"; setTimeout(function () { btn.textContent = "复制"; }, 900); });
        else btn.textContent = "无法复制";
      };
      ve.appendChild(btn);
    }
    return kv(k, ve);
  }
  function sub(title) {
    var d = document.createElement("div");
    d.className = "insp-sub";
    d.textContent = title;
    return d;
  }
  // 颜色值（#RRGGBB）：色块 + 原值
  function colorValue(v) {
    var ve = document.createElement("span");
    var raw = String(v);
    var hex = null;
    var m = /^#?([0-9a-fA-F]{6,8})$/.exec(raw.trim());
    if (m) hex = "#" + raw.trim().replace(/^#/, "").slice(0, 6).toLowerCase();
    if (hex) {
      var sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = hex;
      ve.appendChild(sw);
    }
    var t = document.createElement("span");
    t.textContent = raw;
    ve.appendChild(t);
    return ve;
  }
  function preBlock(obj) {
    var pre = document.createElement("pre");
    pre.textContent = JSON.stringify(obj, null, 1);
    return pre;
  }
  function emptyNote(text) {
    var d = document.createElement("div");
    d.className = "none";
    d.textContent = text;
    return d;
  }
  function hasV(v) { return v !== undefined && v !== null && v !== ""; }

  // ---- 分组渲染（返回 null = 整组隐藏） ----
  function renderBasic(n) {
    var body = document.createDocumentFragment();
    body.appendChild(kv("类型 type", n.type));
    body.appendChild(kv("名称 name", n.name));
    body.appendChild(kv("标识 id", n.id));
    body.appendChild(kvCopy("key (stableKey)", n.key));
    body.appendChild(kvCopy("实例路径 path", n.path));
    return body;
  }

  // Transform：原始 XML 声明（xy/size + 变换 attrs）
  function renderTransform(n) {
    var body = document.createDocumentFragment();
    body.appendChild(sub("原始 XML 声明"));
    body.appendChild(kv("xy", JSON.stringify(n.xy)));
    body.appendChild(kv("size", n.size ? JSON.stringify(n.size) : null));
    var a = n.attrs || {};
    ["pivot", "anchor", "rotation", "skewX", "skewY", "scaleX", "scaleY", "alpha", "grayed", "visible", "touchable"].forEach(function (k) {
      if (hasV(a[k])) body.appendChild(kv(k, a[k]));
    });
    return body;
  }

  // Image：资源引用（image 的 src 资源 id / loader 的 url）
  function renderImage(n) {
    var a = n.attrs || {};
    var has = hasV(n.src) || hasV(a.url);
    if (!has) return null;
    var body = document.createDocumentFragment();
    body.appendChild(sub("资源引用"));
    if (hasV(n.src)) body.appendChild(kv("src（资源 id）", n.src));
    if (hasV(a.url)) body.appendChild(kv("url（loader）", a.url));
    ["scale9grid", "fillMethod", "fillAmount", "color", "flip"].forEach(function (k) {
      if (hasV(a[k])) body.appendChild(kv(k, k === "color" ? colorValue(a[k]) : a[k]));
    });
    return body;
  }

  var TEXT_COLOR_KEYS = { color: true, strokeColor: true };
  var TEXT_KEYS = ["text", "fontSize", "font", "bold", "italic", "align", "vAlign", "leading", "letterSpacing", "underline", "stroke", "autoSize", "singleLine", "ubb", "prompt", "password", "maxLength", "vars"];
  function renderText(n) {
    var a = n.attrs || {};
    var has = TEXT_KEYS.some(function (k) { return hasV(a[k]); });
    if (!has) return null;
    var body = document.createDocumentFragment();
    body.appendChild(sub("文本属性"));
    TEXT_KEYS.forEach(function (k) {
      var v = a[k];
      if (!hasV(v)) return;
      if (TEXT_COLOR_KEYS[k]) body.appendChild(kv(k, colorValue(v)));
      else body.appendChild(kv(k, v));
    });
    return body;
  }

  // Component 溯源：实例与来源分离（当前实例的引用信息，不混入源组件属性）
  function renderComponent(n) {
    if (!n.component && !(n.children && n.children.length)) return null;
    var body = document.createDocumentFragment();
    body.appendChild(sub("组件溯源"));
    if (n.component) {
      body.appendChild(kvCopy("来源文件", n.component.file));
      body.appendChild(kv("packageId", n.component.packageId));
      body.appendChild(kv("resourceId", n.component.resourceId));
    } else {
      body.appendChild(emptyNote("无组件引用"));
    }
    if (n.children && n.children.length) {
      body.appendChild(emptyNote("展开内容：子树来自来源组件（构建期静态展开）"));
    }
    return body;
  }

  function renderAdvanced(n) {
    var a = n.attrs || {};
    var hasAttrs = Object.keys(a).length > 0;
    var hasGears = n.gears && n.gears.length;
    if (!hasAttrs && !hasGears) return null;
    var body = document.createDocumentFragment();
    body.appendChild(sub("原始 XML 属性 attrs（完整声明快照）"));
    if (hasAttrs) body.appendChild(preBlock(a)); else body.appendChild(emptyNote("无属性"));
    if (hasGears) {
      body.appendChild(sub("gears（gear 声明）"));
      body.appendChild(preBlock(n.gears));
    }
    return body;
  }

  // Diagnostics：当前节点未支持上报（诚实报告，不静默）
  function renderDiagnostics(n) {
    var uns = n.unsupported || [];
    if (!uns.length) return null;
    var body = document.createDocumentFragment();
    body.appendChild(sub("未支持上报（" + uns.length + "）"));
    uns.forEach(function (u) {
      var row = document.createElement("div");
      row.className = "diag diag-warn";
      row.textContent = String(u.reason || u);
      body.appendChild(row);
    });
    return body;
  }

  var GROUPS = [
    { id: "basic", title: "Basic 节点身份", render: renderBasic },
    { id: "transform", title: "Transform 变换", render: renderTransform },
    { id: "image", title: "Image 资源", render: renderImage },
    { id: "text", title: "Text 文本", render: renderText },
    { id: "component", title: "Component 组件溯源", render: renderComponent },
    { id: "advanced", title: "Advanced 高级属性", render: renderAdvanced },
    { id: "diagnostics", title: "Diagnostics 诊断", render: renderDiagnostics }
  ];
  var collapsed = { advanced: true }; // Advanced 默认折叠（attrs 快照长）

  function groupEl(g, node) {
    var body = g.render(node);
    if (!body) return null; // 无数据整组隐藏
    var grp = document.createElement("div");
    grp.className = "grp";
    var head = document.createElement("div");
    head.className = "grp-head";
    var caret = document.createElement("span");
    caret.className = "caret" + (body.childNodes.length ? " clk" : "");
    caret.textContent = body.childNodes.length ? (collapsed[g.id] ? "+" : "-") : "";
    var title = document.createElement("span");
    title.textContent = g.title;
    head.appendChild(caret);
    head.appendChild(title);
    grp.appendChild(head);
    if (body.childNodes.length) {
      var bodyEl = document.createElement("div");
      bodyEl.className = "grp-body";
      if (collapsed[g.id]) bodyEl.style.display = "none";
      while (body.childNodes.length) bodyEl.appendChild(body.firstChild);
      grp.appendChild(bodyEl);
      head.onclick = function () {
        collapsed[g.id] = !collapsed[g.id];
        caret.textContent = collapsed[g.id] ? "+" : "-";
        bodyEl.style.display = collapsed[g.id] ? "none" : "";
      };
    }
    return grp;
  }

  function render() {
    if (!ED.sel) { el.innerHTML = EMPTY; return; }
    var entry = ED.index && ED.index.get(ED.sel);
    if (!entry) {
      el.innerHTML = "";
      var d = document.createElement("div");
      d.className = "empty";
      d.textContent = "选中节点不在当前文档索引中: " + ED.sel;
      el.appendChild(d);
      return;
    }
    var n = entry.node;
    el.innerHTML = "";
    var head = document.createElement("div");
    head.className = "insp-head";
    var ht = document.createElement("span");
    ht.textContent = (n.type || "?") + (n.name || n.id ? " " + (n.name || n.id) : "");
    head.appendChild(ht);
    if (n.unsupported && n.unsupported.length) {
      var b = document.createElement("span");
      b.className = "badge sim";
      b.textContent = "未支持";
      head.appendChild(b);
    }
    el.appendChild(head);
    GROUPS.forEach(function (g) {
      var ge = groupEl(g, n);
      if (ge) el.appendChild(ge);
    });
  }

  edSubscribe(render);
  el.innerHTML = EMPTY;
})();
`;
}
