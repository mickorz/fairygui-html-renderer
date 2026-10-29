// 组件选择器：生成内联到产物 HTML 的交互脚本（点击返回组件信息 + 外发光高亮）
// 零依赖 vanilla JS，产物仍是单文件静态 HTML

/** 产物 HTML 内联的选择器脚本 */
export function selectorScript(): string {
  return `
(function () {
  var info = document.getElementById("fgui-info");
  var selected = null;

  function clearSelection() {
    if (selected) {
      selected.classList.remove("fgui-selected");
      selected = null;
    }
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest(".fgui-node") : null;
    clearSelection();
    if (!el) {
      if (info) info.textContent = "点击画布中的组件查看定位信息";
      return;
    }
    el.classList.add("fgui-selected");
    selected = el;
    var data = {
      id: el.dataset.fguiId,
      name: el.dataset.fguiName,
      type: el.dataset.fguiType,
      path: el.dataset.fguiPath,
      source: el.dataset.fguiSrc
    };
    if (info) info.textContent = "选中: " + JSON.stringify(data);
    console.log("[fgui-select]", data);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      clearSelection();
      if (info) info.textContent = "已取消选择";
    }
  });

  // 深度定位：/view?component=X&focus=<stableKey>，加载即高亮目标节点并滚动到可视区
  var focusKey = new URLSearchParams(location.search).get("focus");
  if (focusKey) {
    var el = document.querySelector('[data-fgui-key="' + focusKey + '"]');
    if (el) {
      el.classList.add("fgui-selected");
      selected = el;
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
