// Selection Store 与文档加载（沿袭 egret 项目 P3-A editor-state，适配 FairyGUI 数据源）
// 零构建 vanilla：导出拼入页面的脚本字符串（与页面其他 editor 模块共享全局 ED）
//
// ED 数据流：
//   openComponent(component) -> 拉取 /api/scene?component=（ED.api 统一入口，fetchSeq 防过期 + abort） -> 构建 key 索引 -> edNotify 分发
//   setSelection(key, source) -> edNotify -> tree/canvas/inspector 各自响应
//
// 多工程切换（P0-B）：工程是请求的上下文不是服务状态——
//   ED.project = 当前工程名（URL ?project= 为权威，localStorage 只记忆，服务端 defaultProject 兜底）
//   ED.api(url, opts) = 统一请求入口：全部请求自动携带 ?project= 与当前工程的 abort signal
//   edSetProject(name) = 切换生命周期：中止在途请求 -> 代际递增 -> 清空状态 -> URL/localStorage 同步 -> notify

export function stateScript(): string {
  return `
// ---- Selection Store + 文档加载 + 工程上下文（editor-state） ----
(function () {
  window.ED = {
    project: null,          // 当前工程名（多工程；null = 未初始化，初始化前不发数据请求）
    projectGen: 0,          // 工程代际：每次切换递增；旧工程慢回包比对丢弃（AbortController 双保险）
    abort: null,            // 当前工程的 AbortController（ED.api 自动挂 signal；切换时 abort 全部在途请求）
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

  // 统一请求入口（P0-B）：自动携带 ?project=（当前工程）与 abort signal；
  // 页面全部数据请求（含 POST）必须过这一处，禁止散落 fetch 直调
  window.edApi = function (url, opts) {
    var u = new URL(url, location.origin);
    if (ED.project) u.searchParams.set("project", ED.project);
    opts = opts || {};
    if (ED.abort) opts.signal = ED.abort.signal;
    return fetch(u, opts);
  };

  // 工程切换生命周期（P0-B）：URL 为权威，localStorage 只记忆；
  // 中止在途 -> 代际递增 -> 清空全部状态（含 docId，旧 iframe 在途消息失配丢弃）-> notify
  window.edSetProject = function (name) {
    if (!name || ED.project === name) return;
    if (ED.abort) { try { ED.abort.abort(); } catch (e) { /* 忽略 */ } }
    ED.abort = new AbortController();
    ED.projectGen++;
    ED.project = name;
    ED.file = null;
    ED.doc = null;
    ED.docId = "";
    ED.sel = null; ED.source = null;
    ED.ptExpanded = {}; ED.stExpanded = {}; ED.index = null;
    ED.zoom = 1; ED.zoomFit = false;
    try { localStorage.setItem("fgui.project", name); } catch (e) { /* 存储不可用时忽略 */ }
    try { history.replaceState(null, "", "?project=" + encodeURIComponent(name)); } catch (e) { /* 忽略 */ }
    edNotify();
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
    edApi("/api/scene?component=" + encodeURIComponent(file)).then(function (r) {
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
