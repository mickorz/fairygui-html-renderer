// 工作区前端页面（零构建 vanilla，服务端内嵌返回）
// 三级导航：工程 -> 包 -> 组件；组件渲染在 iframe 中（复用 /view 的选择器与高亮）

export const indexHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>FairyGUI 工作区 - fairygui-html-renderer</title>
<style>
* { box-sizing: border-box; }
body { margin:0; font-family:sans-serif; background:#222; color:#ddd; display:flex; height:100vh; }
#side { width:260px; min-width:260px; background:#2b2b2b; border-right:1px solid #444; overflow:auto; padding:10px; }
#side h1 { font-size:14px; color:#8ee6ff; margin:4px 0 10px; }
#search { width:100%; background:#1e1e1e; color:#ddd; border:1px solid #444; border-radius:4px; padding:6px 8px; font-size:12px; margin-bottom:6px; }
#results { border-bottom:1px solid #444; margin-bottom:8px; max-height:40vh; overflow:auto; }
#results button { display:block; width:100%; text-align:left; background:transparent; color:#bbb; border:none; border-bottom:1px solid #333; padding:4px 6px; cursor:pointer; font-size:11px; }
#results button:hover, #results button.active { color:#ffd666; background:#2f2f2f; }
#results .r-path { color:#ddd; }
#results .r-meta { color:#888; font-size:10px; }
#results .empty { color:#777; font-size:11px; padding:4px 6px; }
.pkg { margin:2px 0; }
.pkg > button { width:100%; text-align:left; background:#333; color:#ddd; border:1px solid #444; border-radius:4px; padding:6px 8px; cursor:pointer; }
.pkg > button:hover { background:#3a3a3a; }
.comps { display:none; margin:2px 0 6px 12px; }
.comps.open { display:block; }
.comps button { display:block; width:100%; text-align:left; background:transparent; color:#bbb; border:none; border-bottom:1px solid #333; padding:4px 6px; cursor:pointer; font-size:12px; }
.comps button:hover, .comps button.active { color:#ffd666; }
#main { flex:1; display:flex; flex-direction:column; }
#crumb { padding:6px 12px; font-size:12px; color:#999; background:#2b2b2b; border-bottom:1px solid #444; }
#frame { flex:1; border:none; background:#1e1e1e; }
</style>
</head>
<body>
<div id="side">
  <h1>FairyGUI 工作区</h1>
  <input id="search" placeholder="搜索组件名 / ID / 路径..." autocomplete="off">
  <div id="results"></div>
  <div id="pkgs">加载中...</div>
</div>
<div id="main">
  <div id="crumb">选择左侧组件查看渲染结果</div>
  <iframe id="frame"></iframe>
</div>
<script>
var pkgsEl = document.getElementById("pkgs");
var crumb = document.getElementById("crumb");
var frame = document.getElementById("frame");
var searchEl = document.getElementById("search");
var resultsEl = document.getElementById("results");

// ===== 搜索（阶段 C）：输入防抖后调 /api/search，结果点击 -> /view&focus= 深度定位 =====
var searchTimer = null;
searchEl.addEventListener("input", function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 300);
});

function doSearch() {
  var q = searchEl.value.trim();
  if (!q) { resultsEl.innerHTML = ""; return; }
  fetch("/api/search?q=" + encodeURIComponent(q))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      resultsEl.innerHTML = "";
      if (!data.results.length) {
        var e = document.createElement("div");
        e.className = "empty";
        e.textContent = "无匹配";
        resultsEl.appendChild(e);
        return;
      }
      data.results.forEach(function (hit) {
        var b = document.createElement("button");
        b.innerHTML = '<span class="r-path"></span><br><span class="r-meta"></span>';
        b.querySelector(".r-path").textContent = hit.path;
        b.querySelector(".r-meta").textContent = hit.type + " | " + hit.component + (hit.unsupported ? " | " + hit.unsupported : "");
        b.onclick = function () {
          resultsEl.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          crumb.textContent = "定位: " + hit.path + "  |  " + hit.component;
          frame.src = "/view?component=" + encodeURIComponent(hit.component) + "&focus=" + encodeURIComponent(hit.key);
        };
        resultsEl.appendChild(b);
      });
      if (data.truncated) {
        var t = document.createElement("div");
        t.className = "empty";
        t.textContent = "结果已截断（50 条上限）";
        resultsEl.appendChild(t);
      }
    });
}

function renderProject(data) {
  pkgsEl.innerHTML = "";
  data.packages.forEach(function (p) {
    var wrap = document.createElement("div");
    wrap.className = "pkg";
    var btn = document.createElement("button");
    btn.textContent = p.name + " (" + p.id + ")";
    var list = document.createElement("div");
    list.className = "comps";
    btn.onclick = function () {
      var open = list.classList.toggle("open");
      if (open && !list.dataset.loaded) loadComponents(p.name, list);
    };
    wrap.appendChild(btn);
    wrap.appendChild(list);
    pkgsEl.appendChild(wrap);
  });
}

function loadComponents(pkgName, list) {
  fetch("/api/packages/" + encodeURIComponent(pkgName) + "/components")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      list.dataset.loaded = "1";
      list.innerHTML = "";
      data.components.forEach(function (c) {
        var b = document.createElement("button");
        b.textContent = c.name.replace(/\\.xml$/, "") + (c.exported ? "" : " (未导出)");
        b.onclick = function () {
          list.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          crumb.textContent = "组件: " + c.component + "  |  资源ID: " + c.id + (c.exported ? "" : "  (未导出)");
          frame.src = "/view?component=" + encodeURIComponent(c.component);
        };
        list.appendChild(b);
      });
    });
}

fetch("/api/project").then(function (r) { return r.json(); }).then(renderProject);
</script>
</body>
</html>
`;
