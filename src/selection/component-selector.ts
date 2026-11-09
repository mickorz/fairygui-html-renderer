// 组件选择器：生成内联到产物 HTML 的交互脚本（点击选中 + 高亮 + postMessage 双向同步）
// 零依赖 vanilla JS，产物仍是单文件静态 HTML
//
// 两种运行形态：
//   独立打开 /view（window.parent === window）：本地信息条 + focus 定位（行为不变）
//   工作台 iframe（?docid= 存在）：走 postMessage 协议（沿袭 egret 项目 P3-A）
//     点击 -> NODE_SELECTED（documentId + key）；点空白 -> NODE_DESELECTED
//     父发 SELECT_NODE/DESELECT_NODE -> 本地高亮/取消；找不到 -> NODE_NOT_FOUND
// 点击判定 closest(".fgui-node")；工作台模式不加信息条（Editor 的 Inspector 承担展示）

export function selectorScript(): string {
  return `
(function () {
  var info = document.getElementById("fgui-info");
  var selected = null;
  var docId = new URLSearchParams(location.search).get("docid") || "";
  var hasParent = !!(window.parent && window.parent !== window);

  function postToParent(m) {
    if (!hasParent) return;
    m.documentId = docId;
    window.parent.postMessage(m, location.origin);
  }

  function clearSelection() {
    if (selected) {
      selected.classList.remove("fgui-selected");
      selected = null;
    }
  }

  function applySelection(el, notify) {
    clearSelection();
    el.classList.add("fgui-selected");
    selected = el;
    if (notify) postToParent({ type: "NODE_SELECTED", key: el.dataset.fguiKey || "" });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest(".fgui-node") : null;
    if (!el) {
      clearSelection();
      if (info) info.textContent = "点击画布中的组件查看定位信息";
      if (hasParent) postToParent({ type: "NODE_DESELECTED" });
      return;
    }
    applySelection(el, true);
    var data = {
      id: el.dataset.fguiId,
      name: el.dataset.fguiName,
      type: el.dataset.fguiType,
      path: el.dataset.fguiPath,
      key: el.dataset.fguiKey,
      source: el.dataset.fguiSrc
    };
    if (info) info.textContent = "选中: " + JSON.stringify(data);
    console.log("[fgui-select]", data);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      clearSelection();
      if (info) info.textContent = "已取消选择";
      if (hasParent) postToParent({ type: "NODE_DESELECTED" });
    }
  });

  // 工作台 -> 画布：SELECT_NODE / DESELECT_NODE（校验 origin + documentId）
  if (hasParent) {
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      var m = e.data;
      if (!m || typeof m !== "object" || m.documentId !== docId) return;
      if (m.type === "SELECT_NODE") {
        if (typeof m.key !== "string" || !m.key) return;
        var el = document.querySelector('[data-fgui-key="' + m.key + '"]');
        if (el) applySelection(el, false);
        else postToParent({ type: "NODE_NOT_FOUND", key: m.key });
      } else if (m.type === "DESELECT_NODE") {
        clearSelection();
      }
    });
    // 文档内容尺寸（含 clip=0 溢出内容）：父工作台据此自适应 iframe 尺寸（永远完整显示不滚，L8）
    var de = document.documentElement;
    postToParent({ type: "CANVAS_READY", docSize: [Math.ceil(de.scrollWidth), Math.ceil(de.scrollHeight)] });
  }

  // 深度定位：/view?component=X&focus=<stableKey>，加载即高亮目标节点并滚动到可视区
  var focusKey = new URLSearchParams(location.search).get("focus");
  if (focusKey) {
    var el = document.querySelector('[data-fgui-key="' + focusKey + '"]');
    if (el) {
      applySelection(el, false);
      el.scrollIntoView({ block: "center" });
      var fd = {
        id: el.dataset.fguiId,
        name: el.dataset.fguiName,
        type: el.dataset.fguiType,
        path: el.dataset.fguiPath,
        key: el.dataset.fguiKey,
        source: el.dataset.fguiSrc
      };
      if (info) info.textContent = "定位: " + JSON.stringify(fd);
      console.log("[fgui-focus]", fd);
    } else if (info) {
      info.textContent = "未找到 focus 节点: " + focusKey;
    }
  }
})();
`;
}
