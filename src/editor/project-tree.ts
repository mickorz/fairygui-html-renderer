// 工程资源库（L9 对齐原版 FairyGUI 编辑器资源库形态）
// 数据源：/api/project（包列表）+ /api/packages/{name}/components（包内全量资源清单，懒加载 + 客户端缓存）
// 树形：包 -> 资源文件夹（package.xml path 分层）-> 资源（组件/图片/字体/动画，类型图标区分）
// 交互：组件资源行点击=打开；图片/字体/动画资源行只展示（title 给文件路径）
// 搜索：客户端过滤（资源名 / 资源 id / 路径 / 包名），未加载的包按需补拉后合并过滤
// 多工程（P0-B）：包列表/资源缓存挂工程——检测 ED.project 变化即清空重拉；慢回包按工程代际丢弃

export function projectTreeScript(): string {
  return `
// ---- 工程资源库（project-tree） ----
(function () {
  var treeEl = document.getElementById("proj-tree");
  var qEl = document.getElementById("pt-q");
  var infoEl = document.getElementById("pt-info");
  var locateBtn = document.getElementById("pt-locate");
  var packages = [];            // [{name}]（/api/project，挂当前工程）
  var resCache = {};            // 包名 -> 资源列表 [{kind,id,name,path,exported,component}]（懒加载缓存，挂当前工程）
  var searchSeq = 0;
  var SEARCH_LIMIT = 300;
  var curProject = null;        // 本模块已加载的工程（检测切换 -> 清缓存重拉）

  // 资源类型图标（对齐原版资源库：组件/图片/字体/影片剪辑各有图标）
  var ICON = { component: "C", image: "I", font: "F", movieclip: "J", other: "·" };
  var KIND_NAME = { component: "组件", image: "图片", font: "字体", movieclip: "动画", other: "资源" };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pkgRow(pkg) {
    var el = document.createElement("div");
    var expanded = !!ED.ptExpanded[pkg.name];
    var count = resCache[pkg.name] ? resCache[pkg.name].length : "";
    el.className = "row dir" + (expanded ? " open" : "");
    el.dataset.pkg = pkg.name;
    el.style.paddingLeft = "8px";
    el.innerHTML = '<span class="caret">' + (expanded ? "-" : "+") + '</span>' +
      '<span class="icon pkg">P</span>' +
      '<span class="lbl" title="' + esc(pkg.name) + '">' + esc(pkg.name) + '</span>' +
      (count !== "" ? '<span class="badge cnt">' + count + '</span>' : '<span class="badge cnt">…</span>');
    el.onclick = function () {
      ED.ptExpanded[pkg.name] = !ED.ptExpanded[pkg.name];
      if (ED.ptExpanded[pkg.name] && !resCache[pkg.name]) {
        loadPkg(pkg.name).then(render);
      } else render();
    };
    return el;
  }

  // 资源文件夹树：按资源 path（"/component/"、"/atlas/"、"" 等含层级的路径段）聚合
  // 返回 [{seg, dir, res}]：dir 节点带子树，res 节点带资源行
  function buildPathTree(resources) {
    var root = { seg: "", dir: {}, res: [] };
    resources.forEach(function (r) {
      var segs = (r.path || "/").split("/").filter(Boolean);
      var node = root;
      segs.forEach(function (seg) {
        if (!node.dir[seg]) node.dir[seg] = { seg: seg, dir: {}, res: [] };
        node = node.dir[seg];
      });
      node.res.push(r);
    });
    return root;
  }

  function dirRow(pkgName, dirPath, seg, depth) {
    var key = pkgName + "|" + dirPath;
    var expanded = !!ED.ptExpanded[key];
    var el = document.createElement("div");
    el.className = "row dir" + (expanded ? " open" : "");
    el.style.paddingLeft = (8 + depth * 16) + "px";
    el.innerHTML = '<span class="caret">' + (expanded ? "-" : "+") + '</span>' +
      '<span class="icon folder">D</span>' +
      '<span class="lbl">' + esc(seg) + '</span>';
    el.onclick = function () { ED.ptExpanded[key] = !ED.ptExpanded[key]; render(); };
    return el;
  }

  function resRow(pkgName, r, depth) {
    var el = document.createElement("div");
    var isComp = r.kind === "component";
    var file = r.component || (pkgName + r.path + r.name);
    if (isComp) {
      el.className = "row file" + (ED.file === r.component ? " sel" : "");
      el.dataset.file = r.component;
    } else {
      el.className = "row res";
    }
    el.style.paddingLeft = (24 + depth * 16) + "px";
    el.innerHTML = '<span class="caret"></span>' +
      '<span class="icon" title="' + esc(KIND_NAME[r.kind] || r.kind) + '">' + (ICON[r.kind] || "·") + '</span>' +
      '<span class="lbl" title="' + esc(KIND_NAME[r.kind] + " " + file) + '">' + esc(r.name) + (isComp && !r.exported ? ' <span class="id">内部</span>' : '') + '</span>' +
      '<span class="badge cnt">' + esc(r.id) + '</span>';
    if (isComp) {
      el.onclick = function () { edOpenComponent(r.component); };
    } else {
      el.style.cursor = "default";
    }
    return el;
  }

  function renderDir(pkgName, node, dirPath, depth) {
    var frag = document.createDocumentFragment();
    Object.keys(node.dir).sort().forEach(function (seg) {
      var childPath = dirPath + seg + "/";
      frag.appendChild(dirRow(pkgName, childPath, seg, depth));
      if (ED.ptExpanded[pkgName + "|" + childPath]) {
        frag.appendChild(renderDir(pkgName, node.dir[seg], childPath, depth + 1));
      }
    });
    node.res.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (r) {
      frag.appendChild(resRow(pkgName, r, depth));
    });
    return frag;
  }

  function render() {
    treeEl.innerHTML = "";
    if (!packages.length) { treeEl.innerHTML = '<div class="empty">无包</div>'; return; }
    packages.forEach(function (pkg) {
      treeEl.appendChild(pkgRow(pkg));
      if (ED.ptExpanded[pkg.name] && resCache[pkg.name]) {
        treeEl.appendChild(renderDir(pkg.name, buildPathTree(resCache[pkg.name]), "", 1));
      }
    });
  }

  function loadPkg(name) {
    if (resCache[name]) return Promise.resolve(resCache[name]);
    var gen = ED.projectGen;
    return edApi("/api/packages/" + encodeURIComponent(name) + "/components").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (gen !== ED.projectGen) return []; // 旧工程慢回包丢弃（abort 逃逸双保险）
      resCache[name] = d.resources || d.components || [];
      return resCache[name];
    });
  }

  // 搜索：补拉全部包 -> 客户端过滤（资源名 / 资源 id / 路径 / 包名）
  function doSearch() {
    var v = qEl.value.trim().toLowerCase();
    var seq = ++searchSeq;
    if (!v) { searchResults = null; infoEl.textContent = packages.length + " 个包"; render(); return; }
    infoEl.textContent = "搜索中...";
    Promise.all(packages.map(function (p) { return loadPkg(p.name).catch(function () { return []; }); })).then(function () {
      if (seq !== searchSeq) return; // 过期响应丢弃
      var hits = [];
      packages.forEach(function (p) {
        (resCache[p.name] || []).forEach(function (r) {
          var hay = ((r.name || "") + " " + (r.id || "") + " " + (r.component || "") + " " + (r.kind || "") + " " + p.name).toLowerCase();
          if (hay.indexOf(v) >= 0) hits.push({ pkg: p.name, r: r });
        });
      });
      searchResults = hits;
      infoEl.textContent = "命中 " + hits.length + " 资源";
      renderSearch();
    });
  }
  var searchResults = null; // null = 包树模式；数组 = 搜索结果模式
  function renderSearch() {
    treeEl.innerHTML = "";
    if (!searchResults) { render(); return; }
    if (!searchResults.length) { treeEl.innerHTML = '<div class="empty">无命中结果</div>'; return; }
    searchResults.slice(0, SEARCH_LIMIT).forEach(function (h) { treeEl.appendChild(resRow(h.pkg, h.r, 1)); });
    if (searchResults.length > SEARCH_LIMIT) {
      var more = document.createElement("div");
      more.className = "empty";
      more.textContent = "仅显示前 " + SEARCH_LIMIT + " 条（共 " + searchResults.length + "）";
      treeEl.appendChild(more);
    }
  }
  qEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });

  // 定位当前打开组件：展开所在包（与文件夹链）+ 滚动 + 闪烁
  locateBtn.onclick = function () {
    if (!ED.file) { infoEl.textContent = "尚未打开组件"; return; }
    searchResults = null;
    if (qEl.value) { qEl.value = ""; }
    var pkg = ED.file.split("/")[0];
    var rest = ED.file.slice(pkg.length);
    ED.ptExpanded[pkg] = true;
    // 展开文件所在文件夹链（按 path 段逐层展开）
    var segs = rest.split("/").filter(Boolean);
    var acc = "";
    for (var i = 0; i < segs.length - 1; i++) {
      acc += segs[i] + "/";
      ED.ptExpanded[pkg + "|" + acc] = true;
    }
    var done = function () {
      render();
      var rows = treeEl.querySelectorAll(".row.file");
      var row = null;
      for (var j = 0; j < rows.length; j++) { if (rows[j].dataset.file === ED.file) { row = rows[j]; break; } }
      if (row) {
        row.scrollIntoView({ block: "center" });
        row.style.background = "#4a6a8a";
        setTimeout(function () { row.style.background = ""; }, 800);
      }
    };
    if (resCache[pkg]) done(); else loadPkg(pkg).then(done).catch(done);
  };

  // 状态订阅：文档变化刷新当前文件高亮；工程切换 -> 清缓存重拉包列表
  edSubscribe(function () {
    if (ED.project && ED.project !== curProject) {
      curProject = ED.project;
      packages = []; resCache = {}; searchResults = null;
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
