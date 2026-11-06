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

  var ICON = { image: "I", text: "T", richtext: "R", inputtext: "N", graph: "G", group: "U", list: "L", loader: "D", component: "C", jta: "J" };

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
      '<span class="icon">' + (ICON[n.type] || "·") + '</span>' +
      '<span class="lbl" title="' + esc(key) + '">' + esc(n.type) + (ident ? ' <span class="id">' + esc(ident) + '</span>' : '') + '</span>';
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
