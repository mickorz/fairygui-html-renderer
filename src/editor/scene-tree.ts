// Scene Tree（沿袭 egret 项目 P3-A scene-tree，适配 FairyGUI Scene JSON）
// 数据：/api/scene nodes 递归（子层经 component.children 嵌套，构建期已展开）
// 徽章：展开（component 来源文件 != 当前文件）/ 未支持（unsupported）
// 点击行为：行点击 = 选中节点；caret 独立点击 = 展开/折叠（不触发选中）
// Canvas 来源的选择：自动展开父链 + 滚动定位 + 闪烁

export function sceneTreeScript(): string {
  return `
// ---- Scene Tree（scene-tree） ----
(function () {
  var treeEl = document.getElementById("scene-tree");
  var infoEl = document.getElementById("st-info");
  var lastInitDoc = null; // 默认展开绑定文档对象身份（加载中与加载完成是不同对象）
  var lastSel = null;     // 上次选择的 key（识别"选择变化"并定位）

  // L9b 图形化节点图标（对齐原版白色描边风 SVG，无 emoji）
  var NODE_SVG = {
    image: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><circle cx="9" cy="3.5" r="1.2"/><path d="M1.5 10.5 5 6.5l2.5 3 1.5-1.5 2 2.5"/></svg>',
    text: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><path d="M2.5 2.5h7M6 2.5v7"/></svg>',
    richtext: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><path d="M2.5 2.5h7M6 2.5v7"/><path d="M3.5 9.5h5"/></svg>',
    inputtext: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><rect x="1.5" y="3" width="9" height="6" rx="1"/><path d="M6 4.5v3"/></svg>',
    graph: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><circle cx="5" cy="5" r="3"/><rect x="6" y="6" width="4.5" height="4.5"/></svg>',
    group: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><rect x="1.5" y="1.5" width="9" height="9" stroke-dasharray="2.5,2"/></svg>',
    list: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><path d="M2.5 3h7M2.5 6h7M2.5 9h7"/></svg>',
    loader: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><path d="M6 2v5"/><path d="M3.5 5.5 6 8l2.5-2.5"/><path d="M2.5 10.5h7"/></svg>',
    component: '<svg viewBox="0 0 16 16" width="12" height="12"><polygon points="8,1 15,4.5 8,8 1,4.5" fill="none" stroke="#c8c8c8" stroke-width="1.3"/><polygon points="1,4.5 8,8 8,15 1,11.5" fill="none" stroke="#c8c8c8" stroke-width="1.3"/><polygon points="15,4.5 8,8 8,15 15,11.5" fill="#c8c8c8" fill-opacity="0.25" stroke="#c8c8c8" stroke-width="1.3"/></svg>',
    jta: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#c8c8c8" stroke-width="1.2"><rect x="2.5" y="2.5" width="7" height="7"/><path d="M1 4h1.5M1 8h1.5M9.5 4H11M9.5 8H11"/></svg>'
  };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function nodeRow(key, depth) {
    var entry = ED.index && ED.index.get(key);
    if (!entry) return null;
    var n = entry.node;
    var kids = n.children || [];
    var expanded = !!ED.stExpanded[key];
    var el = document.createElement("div");
    el.className = "row node" + (ED.sel === key ? " sel" : "");
    el.dataset.key = key;
    el.style.paddingLeft = (8 + depth * 14) + "px";
    var ident = n.name || n.id || "";
    var html = '<span class="caret' + (kids.length ? ' clk' : '') + '">' + (kids.length ? (expanded ? "-" : "+") : "") + '</span>' +
      '<span class="icon" title="' + esc(n.type) + '">' + (NODE_SVG[n.type] || '<svg viewBox="0 0 12 12" width="12" height="12" fill="#888"><circle cx="6" cy="6" r="1.5"/></svg>') + '</span>' +
      '<span class="lbl" title="' + esc(n.type + " " + key) + '">' + esc(ident) + '</span>';
    if (n.component && n.component.file && ED.file && n.component.file !== ED.file) html += '<span class="badge exp" title="' + esc(n.component.file) + '">展开</span>';
    if (n.unsupported && n.unsupported.length) html += '<span class="badge sim" title="' + esc(n.unsupported.join("; ")) + '">未支持</span>';
    el.innerHTML = html;
    // 行点击 = 仅选中（Store 驱动，Canvas 同步高亮）
    el.onclick = function () { edSelect(key, "tree"); };
    // caret 独立点击 = 仅展开/折叠
    if (kids.length) {
      el.querySelector(".caret").onclick = function (e) {
        e.stopPropagation();
        ED.stExpanded[key] = !ED.stExpanded[key];
        render();
      };
    }
    return el;
  }

  function render() {
    if (!ED.file) {
      treeEl.innerHTML = '<div class="empty">打开左侧组件后展示节点结构</div>';
      infoEl.textContent = "";
      return;
    }
    if (!ED.doc) {
      treeEl.innerHTML = '<div class="empty">Scene JSON 加载中...</div>';
      infoEl.textContent = "";
      return;
    }
    if (ED.doc.error) {
      treeEl.innerHTML = '<div class="err">Scene JSON 加载失败: ' + esc(ED.doc.error) + '<br/><button onclick="edOpenComponent(ED.file)">重试</button></div>';
      infoEl.textContent = "";
      return;
    }
    treeEl.innerHTML = "";
    function walk(key, depth) {
      var row = nodeRow(key, depth);
      if (!row) return;
      treeEl.appendChild(row);
      if (ED.stExpanded[key]) {
        var entry = ED.index.get(key);
        var kids = (entry.node.children || []);
        for (var i = 0; i < kids.length; i++) walk(kids[i].key, depth + 1);
      }
    }
    var nodes = ED.doc.nodes || [];
    for (var i = 0; i < nodes.length; i++) walk(nodes[i].key, 0);
    infoEl.textContent = (ED.index ? ED.index.size : 0) + " 节点";
  }

  // 默认展开：第一层节点
  function initExpansion() {
    if (!ED.doc || !ED.index) return;
    ED.stExpanded = {};
    var nodes = ED.doc.nodes || [];
    for (var i = 0; i < nodes.length; i++) ED.stExpanded[nodes[i].key] = true;
  }

  // Canvas/Inspector 来源的选择：展开父链 + 滚动定位 + 闪烁
  function revealSelection() {
    if (!ED.sel || !ED.index) return;
    var entry = ED.index.get(ED.sel);
    if (!entry) return;
    var k = entry.parentKey;
    while (k) {
      ED.stExpanded[k] = true;
      var p = ED.index.get(k);
      k = p && p.parentKey;
    }
    render();
    var rows = treeEl.querySelectorAll(".row.node");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.key === ED.sel) {
        rows[i].scrollIntoView({ block: "nearest" });
        rows[i].style.background = "#4a6a8a";
        (function (r) { setTimeout(function () { r.style.background = ""; }, 800); })(rows[i]);
        return;
      }
    }
  }

  edSubscribe(function () {
    if (ED.doc && !ED.doc.error && ED.doc !== lastInitDoc) {
      lastInitDoc = ED.doc;
      initExpansion();
    }
    if (ED.sel !== lastSel) {
      lastSel = ED.sel;
      if (ED.sel && (ED.source === "canvas" || ED.source === "inspector")) revealSelection();
    }
    render();
  });
})();
`;
}
