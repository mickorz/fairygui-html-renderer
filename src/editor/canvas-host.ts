// Canvas 宿主（沿袭 egret 项目 P3-A canvas-host，适配 FairyGUI 数据源）
// iframe 加载 /view?component=..&bare=1&docid=..&clip=0（bare 无信息条，docid 驱动 postMessage 协议，clip=0 不裁剪溢出画布内容方便查看 L8）
// postMessage 双向选择：
//   iframe -> 父：CANVAS_READY / NODE_SELECTED / NODE_DESELECTED / NODE_NOT_FOUND（均携带 documentId）
//   父 -> iframe：SELECT_NODE / DESELECT_NODE（携带 documentId）
//   校验链：origin -> e.source -> documentId；防环：仅转发非 canvas 来源的选择到画布
// 缩放只改外层视觉（iframe transform），不改 Scene JSON/渲染

export function canvasHostScript(): string {
  return `
// ---- Canvas 宿主（canvas-host） ----
(function () {
  var frame = document.getElementById("frame");
  var frameBox = document.getElementById("frame-box");
  var relBar = document.getElementById("rel-bar");
  var lastDocRef = null; // 守卫用 doc 对象身份：加载中（null）与加载完成（新对象）是不同状态
  var canvasReady = false; // iframe 文档就绪（CANVAS_READY 后才可发消息）
  var ZOOM_STEP = 1.25;

  function applyZoom() {
    var size = (ED.doc && !ED.doc.error && ED.doc.size) || [640, 480];
    var w = size[0] || 640;
    var h = size[1] || 480;
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    frame.style.transformOrigin = "0 0";
    frame.style.transform = ED.zoom === 1 ? "" : "scale(" + ED.zoom + ")";
    frameBox.style.width = Math.round(w * ED.zoom) + "px";
    frameBox.style.height = Math.round(h * ED.zoom) + "px";
  }

  // topbar 缩放控件：步进 x1.25；手动缩放取消 Fit 模式
  document.getElementById("tb-zoom-in").onclick = function () { edSetZoom(ED.zoom * ZOOM_STEP, false); };
  document.getElementById("tb-zoom-out").onclick = function () { edSetZoom(ED.zoom / ZOOM_STEP, false); };
  document.getElementById("tb-zoom-reset").onclick = function () { edSetZoom(1, false); };

  // Fit：用 #viewport 实际可视区域；scale = min((vw-2p)/stageW, (vh-2p)/stageH)
  var FIT_PAD = 20;
  function fitZoom() {
    var size = (ED.doc && !ED.doc.error && ED.doc.size) || [640, 480];
    var sw = size[0] || 640;
    var sh = size[1] || 480;
    var vp = document.getElementById("viewport");
    var vw = vp.clientWidth - FIT_PAD * 2;
    var vh = vp.clientHeight - FIT_PAD * 2;
    if (vw <= 0 || vh <= 0) return;
    edSetZoom(Math.min(vw / sw, vh / sh), true);
  }
  document.getElementById("tb-fit").onclick = fitZoom;
  window.addEventListener("resize", function () { if (ED.zoomFit) fitZoom(); });

  function postToCanvas(m) {
    if (canvasReady && frame.contentWindow) frame.contentWindow.postMessage(m, location.origin);
  }

  // 树/Inspector 侧选择 -> 画布高亮（canvas 来源已在 iframe 本地高亮，回发会成环）
  function sendSelection() {
    if (ED.source !== "tree" && ED.source !== "inspector") return;
    if (ED.sel) postToCanvas({ type: "SELECT_NODE", documentId: ED.docId, key: ED.sel });
    else postToCanvas({ type: "DESELECT_NODE", documentId: ED.docId });
  }

  // iframe -> 父：就绪/选中/取消/未找到（校验链 origin -> source -> documentId -> 字段类型）
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin) return;
    if (e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || typeof m !== "object" || m.documentId !== ED.docId) return; // 过期文档消息丢弃
    if (m.type === "CANVAS_READY") {
      canvasReady = true;
      sendSelection(); // 树侧已选中而画布刚就绪：补发高亮
      return;
    }
    if (m.type === "NODE_SELECTED") {
      if (typeof m.key !== "string" || !m.key) return;
      edSelect(m.key, "canvas");
      return;
    }
    if (m.type === "NODE_DESELECTED") {
      edDeselect("canvas");
      return;
    }
    if (m.type === "NODE_NOT_FOUND") {
      console.warn("[canvas-host] 画布未找到节点:", m.key);
      return;
    }
  });

  // ---- 组件关系条（S3 接入）：/api/component-graph 邻域 + 芯片跳转 ----
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function chipHtml(id, name, kind, jump) {
    return '<a class="chip" data-id="' + esc(id) + '" data-file="' + esc(jump) + '" href="#">' +
      esc(name) + ' <small>' + kind + "·" + esc(jump) + '</small></a>';
  }
  function loadRel() {
    var id = ED.doc && ED.doc.packageId && ED.doc.resourceId ? ED.doc.packageId + "." + ED.doc.resourceId : null;
    if (!id) {
      relBar.style.display = "block";
      relBar.innerHTML = '<span class="none">当前文档无资源 id</span>';
      return;
    }
    relBar.style.display = "block";
    relBar.innerHTML = '<div class="title">组件关系加载中...</div>';
    var docRef = ED.doc; // 慢回包校验：回包时文档已换（含工程切换）则丢弃，防旧工程覆盖新工程 rel-bar
    edApi("/api/component-graph?key=" + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (nb) {
      if (ED.doc !== docRef) return;
      if (!nb.node) { relBar.innerHTML = '<span class="none">组件 ' + esc(id) + ' 无图节点</span>'; return; }
      // 引用目标 id -> 展示名（file 去包前缀）；点击跳转对应组件文件
      var html = '<div class="title">组件关系：' + esc(nb.node.name) + ' <span class="none">(' + esc(nb.node.file) + ')</span></div>';
      html += '<div class="group"><span class="label">引用了</span>' + (nb.uses.length ? nb.uses.map(function (e) { return chipHtml(e.to, e.otherName, e.edge, e.otherFile); }).join("") : '<span class="none">无</span>') + '</div>';
      html += '<div class="group"><span class="label">被引用</span>' + (nb.usedBy.length ? nb.usedBy.map(function (e) { return chipHtml(e.from, e.otherName, e.edge, e.otherFile); }).join("") : '<span class="none">无（入口组件）</span>') + '</div>';
      if (nb.inCycle && nb.inCycle.length) html += '<div class="cycle">警告：该组件在图级引用环中 [' + nb.inCycle.map(esc).join(", ") + ']</div>';
      relBar.innerHTML = html;
    }).catch(function () {
      if (ED.doc !== docRef) return;
      relBar.innerHTML = '<div class="title">组件关系 <span class="none">加载失败</span></div>';
    });
  }
  // 芯片点击：跳转对应组件（file 为工程相对路径，直接 edOpenComponent）
  relBar.addEventListener("click", function (e) {
    var a = e.target.closest("a.chip");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.file) edOpenComponent(a.dataset.file);
  });

  edSubscribe(function () {
    if (ED.doc !== lastDocRef) { // 新文档（含加载中）：画布需重载，就绪状态重置
      lastDocRef = ED.doc;
      canvasReady = false;
      if (!ED.file || !ED.doc || ED.doc.error) {
        relBar.style.display = "none";
        frame.src = "about:blank";
        frameBox.style.width = "0";
        frameBox.style.height = "0";
        return;
      }
      applyZoom();
      // iframe src 带工程上下文（P0-B）：iframe 内资源 URL 由服务端按该 project 解析落位
      frame.src = "/view?component=" + encodeURIComponent(ED.file) + "&bare=1&docid=" + encodeURIComponent(ED.docId) + "&clip=0"
        + (ED.project ? "&project=" + encodeURIComponent(ED.project) : "");
      loadRel();
      return;
    }
    // 同文档内：缩放变化 + 选择变化（树来源 -> 转发画布高亮）
    if (ED.doc && !ED.doc.error) {
      applyZoom();
      sendSelection();
    }
  });
})();
`;
}
