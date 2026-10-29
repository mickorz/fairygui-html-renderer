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
