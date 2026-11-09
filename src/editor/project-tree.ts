// 工程组件树（沿袭 egret 项目 P3-A project-tree，适配 FairyGUI 包/组件两级模型）
// 数据源：/api/project（包列表）+ /api/packages/{name}/components（包内组件，懒加载 + 客户端缓存）
// 搜索：客户端过滤（组件名 / 资源 id / 路径 / 包名），未加载的包按需补拉后合并过滤
// 多工程（P0-B）：包列表/组件缓存挂工程——检测 ED.project 变化即清空重拉；慢回包按工程代际丢弃

export function projectTreeScript(): string {
  return `
// ---- 工程组件树（project-tree） ----
(function () {
  var treeEl = document.getElementById("proj-tree");
  var qEl = document.getElementById("pt-q");
  var infoEl = document.getElementById("pt-info");
  var locateBtn = document.getElementById("pt-locate");
  var packages = [];            // [{name}]（/api/project，挂当前工程）
  var compCache = {};           // 包名 -> 组件列表 [{id,name,exported,component}]（懒加载缓存，挂当前工程）
  var searchSeq = 0;
  var SEARCH_LIMIT = 300;
  var curProject = null;        // 本模块已加载的工程（检测切换 -> 清缓存重拉）

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pkgRow(pkg) {
    var el = document.createElement("div");
    var expanded = !!ED.ptExpanded[pkg.name];
    el.className = "row dir" + (expanded ? " open" : "");
    el.dataset.pkg = pkg.name;
    el.style.paddingLeft = "8px";
    var count = compCache[pkg.name] ? compCache[pkg.name].length : "";
    el.innerHTML = '<span class="caret">' + (expanded ? "-" : "+") + '</span>' +
      '<span class="icon">P</span>' +
      '<span class="lbl" title="' + esc(pkg.name) + '">' + esc(pkg.name) + '</span>' +
      (count !== "" ? '<span class="badge cnt">' + count + '</span>' : '<span class="badge cnt">…</span>');
    el.onclick = function () {
      ED.ptExpanded[pkg.name] = !ED.ptExpanded[pkg.name];
      if (ED.ptExpanded[pkg.name] && !compCache[pkg.name]) {
        loadPkg(pkg.name).then(render);
      } else render();
    };
    return el;
  }

  function compRow(pkgName, c) {
    var el = document.createElement("div");
    var file = c.component; // 含包内子目录的相对路径（如 Basics/components/Button3.xml）
    el.className = "row file" + (ED.file === file ? " sel" : "");
    el.dataset.file = file;
    el.style.paddingLeft = "28px";
    el.innerHTML = '<span class="caret"></span>' +
      '<span class="icon">C</span>' +
      '<span class="lbl" title="' + esc(file) + '">' + esc(c.name) + (c.exported ? "" : ' <span class="id">内部</span>') + '</span>' +
      '<span class="badge cnt">' + esc(c.id) + '</span>';
    el.onclick = function () { edOpenComponent(file); };
    return el;
  }

  function render() {
    treeEl.innerHTML = "";
    if (!packages.length) { treeEl.innerHTML = '<div class="empty">无包</div>'; return; }
    packages.forEach(function (pkg) {
      treeEl.appendChild(pkgRow(pkg));
      if (ED.ptExpanded[pkg.name] && compCache[pkg.name]) {
        var list = compCache[pkg.name].slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        list.forEach(function (c) { treeEl.appendChild(compRow(pkg.name, c)); });
      }
    });
  }

  function loadPkg(name) {
    if (compCache[name]) return Promise.resolve(compCache[name]);
    var gen = ED.projectGen;
    return edApi("/api/packages/" + encodeURIComponent(name) + "/components").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (gen !== ED.projectGen) return []; // 旧工程慢回包丢弃（abort 逃逸双保险）
      compCache[name] = d.components || [];
      return compCache[name];
    });
  }

  // 搜索：补拉全部包 -> 客户端过滤（组件名 / 资源 id / 路径 / 包名）
  function doSearch() {
    var v = qEl.value.trim().toLowerCase();
    var seq = ++searchSeq;
    if (!v) { searchResults = null; infoEl.textContent = packages.length + " 个包"; render(); return; }
    infoEl.textContent = "搜索中...";
    Promise.all(packages.map(function (p) { return loadPkg(p.name).catch(function () { return []; }); })).then(function () {
      if (seq !== searchSeq) return; // 过期响应丢弃
      var hits = [];
      packages.forEach(function (p) {
        (compCache[p.name] || []).forEach(function (c) {
          var hay = (c.name + " " + c.id + " " + c.component + " " + p.name).toLowerCase();
          if (hay.indexOf(v) >= 0) hits.push({ pkg: p.name, c: c });
        });
      });
      searchResults = hits;
      infoEl.textContent = "命中 " + hits.length + " 组件";
      renderSearch();
    });
  }
  var searchResults = null; // null = 包树模式；数组 = 搜索结果模式
  function renderSearch() {
    treeEl.innerHTML = "";
    if (!searchResults) { render(); return; }
    if (!searchResults.length) { treeEl.innerHTML = '<div class="empty">无命中结果</div>'; return; }
    searchResults.slice(0, SEARCH_LIMIT).forEach(function (h) { treeEl.appendChild(compRow(h.pkg, h.c)); });
    if (searchResults.length > SEARCH_LIMIT) {
      var more = document.createElement("div");
      more.className = "empty";
      more.textContent = "仅显示前 " + SEARCH_LIMIT + " 条（共 " + searchResults.length + "）";
      treeEl.appendChild(more);
    }
  }
  qEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });

  // 定位当前打开组件：展开所在包 + 滚动 + 闪烁
  locateBtn.onclick = function () {
    if (!ED.file) { infoEl.textContent = "尚未打开组件"; return; }
    searchResults = null;
    if (qEl.value) { qEl.value = ""; }
    var pkg = ED.file.split("/")[0];
    ED.ptExpanded[pkg] = true;
    var done = function () {
      render();
      var rows = treeEl.querySelectorAll(".row.file");
      var row = null;
      for (var i = 0; i < rows.length; i++) { if (rows[i].dataset.file === ED.file) { row = rows[i]; break; } }
      if (row) {
        row.scrollIntoView({ block: "center" });
        row.style.background = "#4a6a8a";
        setTimeout(function () { row.style.background = ""; }, 800);
      }
    };
    if (compCache[pkg]) done(); else loadPkg(pkg).then(done).catch(done);
  };

  // 状态订阅：文档变化刷新当前文件高亮；工程切换 -> 清缓存重拉包列表
  edSubscribe(function () {
    if (ED.project && ED.project !== curProject) {
      curProject = ED.project;
      packages = []; compCache = {}; searchResults = null;
      qEl.value = "";
      loadProject();
      return;
    }
    if (packages.length) { if (!qEl.value.trim()) render(); else renderSearch(); }
  });

  // 包列表加载（挂当前工程，代际校验）
  function loadProject() {
    var gen = ED.projectGen;
    treeEl.innerHTML = '<div class="empty">加载中...</div>';
    edApi("/api/project").then(function (r) { return r.json(); }).then(function (d) {
      if (gen !== ED.projectGen) return; // 旧工程慢回包丢弃
      packages = d.packages || [];
      if (packages.length) {
        ED.ptExpanded[packages[0].name] = true;
        loadPkg(packages[0].name).then(render);
      }
      infoEl.textContent = packages.length + " 个包";
    }).catch(function (err) {
      if (gen !== ED.projectGen) return;
      treeEl.innerHTML = '<div class="err">包列表加载失败: ' + esc(String(err)) + '</div>';
    });
  }
})();
`;
}
