// Selection Store 与文档加载（沿袭 egret 项目 P3-A editor-state，适配 FairyGUI 数据源）
// 零构建 vanilla：导出拼入页面的脚本字符串（与页面其他 editor 模块共享全局 ED）
//
// ED 数据流：
//   openComponent(component) -> 拉取 /api/scene?component=（fetchSeq 防过期） -> 构建 key 索引 -> edNotify 分发
//   setSelection(key, source) -> edNotify -> tree/canvas/inspector 各自响应

export function stateScript(): string {
  return `
// ---- Selection Store + 文档加载（editor-state） ----
(function () {
  window.ED = {
    file: null,            // 当前组件相对路径（如 Basics/Demo_Button.xml）
    doc: null,             // /api/scene 文档（{file,packageId,size,extension,controllers,nodes} 或 {error}）
    docId: "",             // 当前文档标识（每次 openComponent 递增；postMessage 过期过滤）
    docSeq: 0,
    fetchSeq: 0,           // 请求序号：连续快速切换组件时只认最新
    sel: null,             // 当前选中 stableKey
    source: null,          // 选择来源 "tree"|"canvas"|"inspector"（防循环）
    zoom: 1,               // 画布缩放（0.1~4；只改外层视觉，不改 Scene JSON/渲染）
    zoomFit: false,        // Fit 模式标记（窗口 resize 时重新适配；手动缩放后取消）
    ptExpanded: {},        // 工程树包展开集合（包名 -> bool）
    stExpanded: {},        // Scene Tree 节点展开集合（key -> bool）
    index: null,           // Map<key, {node, parentKey, depth}>（Scene Tree 与 Inspector 共用）
    subs: []
  };

  window.edSubscribe = function (fn) { ED.subs.push(fn); };
  window.edNotify = function () {
    for (var i = 0; i < ED.subs.length; i++) {
      try { ED.subs[i](ED); } catch (e) { console.error("[editor-sub]", e); }
    }
  };

  // 统一选择入口：key 为 stableKey；source 区分来源，防树与画布互相回发成环；幂等
  window.edSelect = function (key, source) {
    if (!key || (ED.sel === key && ED.source === source)) return;
    ED.sel = key;
    ED.source = source;
    edNotify();
  };
  window.edDeselect = function (source) {
    if (ED.sel === null) return;
    ED.sel = null;
    ED.source = source || null;
    edNotify();
  };

  // 统一缩放入口：clamp 10%~400%；fit 标记 Fit 模式（resize 重适配依据）；幂等
  window.edSetZoom = function (z, fit) {
    var v = Math.max(0.1, Math.min(4, z));
    if (ED.zoom === v && ED.zoomFit === !!fit) return;
    ED.zoom = v;
    ED.zoomFit = !!fit;
    edNotify();
  };

  window.edOpenComponent = function (file) {
    if (ED.file === file && ED.doc && !ED.doc.error) return; // 重复点击不重载（防 iframe 闪烁）
    ED.file = file;
    var seq = ++ED.fetchSeq;
    ED.doc = null;
    ED.sel = null; ED.source = null;
    ED.docId = "d" + (++ED.docSeq);
    ED.stExpanded = {}; ED.index = null;
    ED.zoom = 1; ED.zoomFit = false; // 组件切换重置缩放
    edNotify(); // 通知加载中状态
    fetch("/api/scene?component=" + encodeURIComponent(file)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (doc) {
      if (seq !== ED.fetchSeq) return; // 过期响应丢弃
      ED.doc = doc;
      edBuildIndex();
      edNotify();
    }).catch(function (err) {
      if (seq !== ED.fetchSeq) return;
      ED.doc = { error: String((err && err.message) || err) };
      edNotify();
    });
  };

  // key 索引：一次深度遍历构建（Scene Tree 渲染 / Inspector 查询 / 定位共用）
  // FairyGUI Scene JSON：nodes 为组件直接子节点，子层经 component.children 嵌套
  window.edBuildIndex = function () {
    var index = new Map();
    function walk(n, parentKey, depth) {
      index.set(n.key, { node: n, parentKey: parentKey, depth: depth });
      var kids = n.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i], n.key, depth + 1);
    }
    var nodes = (ED.doc && ED.doc.nodes) || [];
    for (var i = 0; i < nodes.length; i++) walk(nodes[i], null, 0);
    ED.index = index;
  };
})();
`;
}
