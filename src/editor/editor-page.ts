// 三栏可视化工作台页面（沿袭 egret 项目 P3-A editor-page，适配 FairyGUI）
// 零构建 vanilla：各 editor 模块导出脚本字符串，此处拼装成单页
// 布局：左（工程组件树 + Scene Tree 上下分区）| 中（Canvas iframe + 缩放）| 右（Inspector）

import { stateScript } from "./editor-state.js";
import { projectTreeScript } from "./project-tree.js";
import { sceneTreeScript } from "./scene-tree.js";
import { canvasHostScript } from "./canvas-host.js";
import { inspectorScript } from "./inspector.js";

/** 工作台完整页面 HTML（服务端 `/` 路由返回） */
export function editorPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>FairyGUI UI 工作台 - fairygui-html-renderer</title>
<style>
* { box-sizing:border-box; }
html, body { margin:0; height:100%; }
body { font-family:"Microsoft YaHei", "PingFang SC", sans-serif; background:#222; color:#ddd; display:flex; flex-direction:column; overflow:hidden; font-size:12px; }

#topbar { height:34px; flex:none; display:flex; align-items:center; gap:10px; padding:0 10px; background:#2b2b2b; border-bottom:1px solid #444; }
#topbar .name { color:#8ee6ff; white-space:nowrap; }
#topbar select { background:#1e1e1e; color:#8ee6ff; border:1px solid #555; border-radius:3px; padding:2px 4px; font-size:12px; max-width:220px; }
#tb-file { color:#ffd666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:36%; }
#tb-stage { color:#888; white-space:nowrap; }
#tb-spacer { flex:1; }
#tb-zoom { color:#888; white-space:nowrap; }
#topbar button { background:#333; color:#ccc; border:1px solid #555; border-radius:3px; padding:2px 8px; cursor:pointer; font-size:12px; }
#topbar button:disabled { opacity:.4; cursor:default; }

#body { flex:1; display:flex; min-height:0; }

#left { width:290px; min-width:200px; max-width:560px; flex:none; display:flex; flex-direction:column; background:#2b2b2b; border-right:1px solid #444; min-height:0; }
#vsplit1, #vsplit2 { width:5px; flex:none; cursor:col-resize; background:#2b2b2b; }
#hsplit { height:5px; flex:none; cursor:row-resize; background:#262626; }
#vsplit1:hover, #vsplit2:hover, #hsplit:hover { background:#4a6a8a; }

#proj-pane { height:65%; min-height:110px; flex:none; display:flex; flex-direction:column; overflow:hidden; background:#3f3f3f; }
#scene-pane { flex:1; min-height:80px; display:flex; flex-direction:column; overflow:hidden; background:#3f3f3f; }
.pane-tabs { flex:none; display:flex; align-items:center; gap:2px; padding:0 4px; background:#464646; border-bottom:1px solid #3a3a3a; }
.pane-tabs .tab { flex:none; padding:5px 10px 4px; color:#999; background:none; border:none; cursor:default; font-size:12px; }
.pane-tabs .tab.active { color:#fff; background:none; font-weight:500; }
.pane-tabs .info { flex:1; color:#777; font-size:11px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; text-align:right; padding-right:4px; }
.pane-tabs button { background:#333; color:#aaa; border:1px solid #555; border-radius:3px; padding:1px 6px; cursor:pointer; font-size:11px; margin-left:4px; }
.pane-search { flex:none; padding:4px 6px 2px; }
.pane-search input { width:100%; padding:4px 6px; background:#353535; color:#ddd; border:1px solid #555; border-radius:2px; font-size:12px; }
.tree::-webkit-scrollbar, #viewport::-webkit-scrollbar { width:8px; height:8px; }
.tree::-webkit-scrollbar-thumb, #viewport::-webkit-scrollbar-thumb { background:#5a5a5a; border-radius:4px; }
.tree::-webkit-scrollbar-track, #viewport::-webkit-scrollbar-track { background:transparent; }

#canvas-col { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
#rel-bar { display:none; flex:none; padding:6px 10px; background:#262626; border-bottom:1px solid #444; max-height:130px; overflow:auto; }
#rel-bar .title { color:#8ee6ff; margin-bottom:3px; }
#rel-bar .group { margin:3px 0; }
#rel-bar .label { color:#888; display:inline-block; width:56px; }
#rel-bar a.chip { display:inline-block; background:#333; color:#ffd666; border:1px solid #555; border-radius:3px; padding:1px 7px; margin:2px 4px 2px 0; cursor:pointer; text-decoration:none; font-size:11px; }
#rel-bar a.chip small { color:#888; }
#rel-bar .cycle { color:#ff9d66; margin-top:3px; }
#rel-bar .none { color:#666; }
#viewport { flex:1; min-height:0; overflow:auto; background:#191919; display:flex; }
#frame-box { margin:auto; flex:none; }
#frame { border:none; display:block; background:#1e1e1e; }

#right { width:320px; min-width:240px; max-width:520px; flex:none; overflow:auto; background:#2b2b2b; border-left:1px solid #444; }

.tree { flex:1; min-height:0; overflow:auto; padding:2px 0; }
.tree .row { display:flex; align-items:center; gap:4px; padding:0 6px; height:26px; line-height:26px; cursor:pointer; white-space:nowrap; }
.tree .row:hover { background:#2f2f2f; }
.tree .row.sel { background:#4d6a85; color:#fff; }
.tree .row.sel .lbl .id { color:#dce9ff; }
.tree .row .caret { width:12px; flex:none; color:#6fa1d8; text-align:center; opacity:0.55; }
.tree .row.open > .caret, .tree .row .caret.clk:hover { opacity:1; }
.tree .row .caret.clk { cursor:pointer; border-radius:3px; }
.tree .row .caret.clk:hover { color:#fff; background:#3a3a3a; }
.tree .row .icon { flex:none; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; }
.tree .row .icon svg { display:block; }
.tree .row .lbl { color:#c9c9c9; overflow:hidden; text-overflow:ellipsis; }
.tree .row.file .lbl, .tree .row.res .lbl { color:#b9b9b9; }
.tree .row .lbl .id { color:#7ec6ff; }
.tree .row .badge { flex:none; font-size:10px; border-radius:3px; padding:0 4px; }
.badge.exp { background:#3a3352; color:#c9a6ff; }
.badge.sim { background:#52402a; color:#ffb96b; }
.badge.syn { background:#2f4a44; color:#7fdcbb; }
.badge.cnt { background:#333; color:#777; }
.tree .empty, #inspector .empty { color:#777; padding:16px 10px; line-height:1.7; }
.tree .err { color:#ff9d66; padding:10px; line-height:1.6; }
.tree .err button { margin-top:6px; }

#inspector { padding:4px 0; }
#inspector .insp-head { padding:5px 8px; color:#ffd666; background:#262626; border-bottom:1px solid #333; }
#inspector .insp-head .badge { margin-left:6px; }
#inspector .insp-sub { padding:4px 8px 2px 20px; color:#7ec6ff; font-size:11px; }
#inspector .diag { padding:2px 8px 2px 20px; line-height:1.5; }
#inspector .diag .lv { color:#888; }
#inspector .diag-warn { color:#ffb96b; }
#inspector .diag-err { color:#ff7d66; }
#inspector .none { color:#666; padding:2px 8px 2px 20px; }
#inspector .grp { border-bottom:1px solid #333; }
#inspector .grp-head { display:flex; align-items:center; gap:6px; padding:5px 8px; cursor:pointer; color:#8ee6ff; background:#262626; }
#inspector .grp-head .info { flex:1; }
#inspector .kv { display:flex; padding:2px 8px 2px 20px; }
#inspector .kv .k { width:96px; flex:none; color:#888; }
#inspector .kv .v { flex:1; color:#ccc; word-break:break-all; white-space:pre-wrap; }
#inspector .v .swatch { display:inline-block; width:12px; height:12px; border:1px solid #555; border-radius:2px; vertical-align:-2px; margin-right:4px; }
#inspector .v button { background:#333; color:#aaa; border:1px solid #555; border-radius:3px; padding:0 5px; cursor:pointer; font-size:10px; margin-left:4px; }
#inspector pre { margin:4px 8px 4px 20px; padding:6px; background:#1e1e1e; border:1px solid #3a3a3a; border-radius:3px; color:#9cc; font-size:11px; overflow:auto; max-height:260px; }

body.dragging { user-select:none; }
body.dragging-v { cursor:col-resize; }
body.dragging-h { cursor:row-resize; }
body.dragging iframe { pointer-events:none; }
</style>
</head>
<body>
<div id="topbar">
  <select id="tb-project-sel" title="切换 FairyGUI 工程" style="display:none"></select>
  <span class="name" id="tb-project">加载中...</span>
  <span id="tb-file">选择左侧组件</span>
  <span id="tb-stage"></span>
  <span id="tb-spacer"></span>
  <span id="tb-zoom">缩放 100%</span>
  <button id="tb-zoom-out" title="缩小">-</button>
  <button id="tb-zoom-reset" title="重置 100%">100%</button>
  <button id="tb-zoom-in" title="放大">+</button>
  <button id="tb-fit" title="适配画布">Fit</button>
</div>
<div id="body">
  <div id="left">
    <div id="proj-pane">
      <div class="pane-tabs"><button class="tab active"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#e0e0e0" stroke-width="1.2"><path d="M2 6 6 2.5 10 6"/><path d="M3.5 5.5v4h5v-4"/></svg>资源库</button><span class="info" id="pt-info"></span><button id="pt-locate" title="定位当前打开的组件">定位</button></div>
      <div class="pane-search">
        <input id="pt-q" placeholder="搜索：资源名 / 资源 id / 包名" />
      </div>
      <div id="proj-tree" class="tree">加载中...</div>
    </div>
    <div id="hsplit"></div>
    <div id="scene-pane">
      <div class="pane-tabs"><button class="tab active"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#e0e0e0" stroke-width="1.2"><path d="M2 2.5h8"/><path d="M2 6h8"/><path d="M2 9.5h8"/></svg>显示列表</button><span class="info" id="st-info"></span></div>
      <div id="scene-tree" class="tree"><div class="empty">打开左侧组件后展示节点结构</div></div>
    </div>
  </div>
  <div id="vsplit1"></div>
  <div id="canvas-col">
    <div id="rel-bar"></div>
    <div id="viewport"><div id="frame-box"><iframe id="frame"></iframe></div></div>
  </div>
  <div id="vsplit2"></div>
  <div id="right"><div id="inspector"><div class="empty">请选择一个节点<br/><br/>在左侧 Scene Tree 或中间 Canvas<br/>点击一个节点查看它的属性。</div></div></div>
</div>
<script>
${stateScript()}
${projectTreeScript()}
${sceneTreeScript()}
${canvasHostScript()}
${inspectorScript()}

// ---- 初始化：多工程解析 / 布局持久化 / 拖拽分隔条 / topbar 刷新 ----
(function () {
  // 多工程初始化（P0-B）：URL ?project= 为权威 > localStorage 记忆 > 服务端默认；
  // 单工程模式隐藏下拉；edSetProject 内统一做 URL 固化 + localStorage 记忆 + 生命周期切换
  fetch("/api/projects").then(function (r) { return r.json(); }).then(function (d) {
    var sel = document.getElementById("tb-project-sel");
    var projects = d.projects || [];
    var names = projects.map(function (p) { return p.name; });
    var urlName = new URLSearchParams(location.search).get("project");
    var lsName = null;
    try { lsName = localStorage.getItem("fgui.project"); } catch (e) { /* 存储不可用时忽略 */ }
    var current = (urlName && names.indexOf(urlName) >= 0) ? urlName
      : (lsName && names.indexOf(lsName) >= 0 ? lsName : d.defaultProject);
    if (!current) { document.getElementById("tb-project").textContent = "无工程"; return; }
    if (d.mode === "multi" && projects.length > 1) {
      sel.style.display = "";
      sel.innerHTML = projects.map(function (p) {
        return '<option value="' + p.name + '">' + p.name + " · " + p.packageCount + " 包</option>";
      }).join("");
      sel.value = current;
      sel.onchange = function () { edSetProject(sel.value); };
    }
    PROJECTS = projects; // 先存包数表再切换（edSetProject -> notify -> 顶栏刷新需要它）
    edSetProject(current); // 统一切换入口：URL 固化 + 记忆 + abort 清状态 + notify
  }).catch(function () {
    document.getElementById("tb-project").textContent = "工程清单加载失败";
  });
  var PROJECTS = []; // [{name, packageCount}]（/api/projects；工程名 -> 包数，供顶栏刷新）

  var LKEY = "fgui-editor-layout";
  function saveLayout() {
    try { localStorage.setItem(LKEY, JSON.stringify({
      lw: document.getElementById("left").style.width || null,
      rw: document.getElementById("right").style.width || null,
      ph: document.getElementById("proj-pane").style.height || null
    })); } catch (e) { /* 存储不可用时忽略 */ }
  }
  (function restoreLayout() {
    try {
      var l = JSON.parse(localStorage.getItem(LKEY) || "{}");
      if (l.lw) document.getElementById("left").style.width = l.lw;
      if (l.rw) document.getElementById("right").style.width = l.rw;
      if (l.ph) document.getElementById("proj-pane").style.height = l.ph;
    } catch (e) { /* 忽略损坏的布局 */ }
  })();

  // 拖拽分隔条：body 加 overlay 类防 iframe 吞鼠标事件
  function dragSplit(el, dir, apply) {
    el.addEventListener("mousedown", function (e) {
      e.preventDefault();
      document.body.classList.add("dragging");
      document.body.classList.add(dir === "x" ? "dragging-v" : "dragging-h");
      function mv(ev) { apply(ev); }
      function up() {
        document.body.classList.remove("dragging", "dragging-v", "dragging-h");
        document.removeEventListener("mousemove", mv);
        document.removeEventListener("mouseup", up);
        saveLayout();
      }
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up);
    });
  }
  dragSplit(document.getElementById("vsplit1"), "x", function (ev) {
    var left = ev.clientX - document.getElementById("body").getBoundingClientRect().left;
    document.getElementById("left").style.width = Math.max(200, Math.min(560, left)) + "px";
  });
  dragSplit(document.getElementById("vsplit2"), "x", function (ev) {
    var w = window.innerWidth - ev.clientX - 5;
    document.getElementById("right").style.width = Math.max(240, Math.min(520, w)) + "px";
  });
  dragSplit(document.getElementById("hsplit"), "y", function (ev) {
    var top = document.getElementById("proj-pane").getBoundingClientRect().top;
    document.getElementById("proj-pane").style.height = Math.max(110, Math.min(window.innerHeight - top - 120, ev.clientY - top)) + "px";
  });

  // topbar 工程名/文件/舞台尺寸/缩放刷新（工程名随 ED.project 变化刷新，包数查 PROJECTS）
  edSubscribe(function () {
    var tp = document.getElementById("tb-project");
    if (ED.project) {
      var pc = 0;
      for (var i = 0; i < PROJECTS.length; i++) { if (PROJECTS[i].name === ED.project) pc = PROJECTS[i].packageCount; }
      tp.textContent = ED.project + " · " + pc + " 包";
    }
    document.getElementById("tb-file").textContent = ED.file || "选择左侧组件";
    var size = ED.doc && ED.doc.size;
    document.getElementById("tb-stage").textContent = size ? (size[0] + " x " + size[1]) : "";
    document.getElementById("tb-zoom").textContent = "缩放 " + Math.round(ED.zoom * 100) + "%" + (ED.zoomFit ? "（Fit）" : "");
  });
})();
</script>
</body>
</html>
`;
}
