import grapesjs from "grapesjs";
import type { Editor } from "grapesjs";
import { DEFAULT_CANVAS, canvasFrameStyle } from "./canvas-config";

// GrapesJS 编辑器单例封装（Task 1 POC）
// 边界：React 只负责本容器外围 UI，画布内部 DOM 全归 GrapesJS 管
let editor: Editor | null = null;

export function createEditorInstance(container: HTMLElement): Editor {
  if (editor) return editor;
  void DEFAULT_CANVAS; // 画布框架样式见 canvasFrameStyle()，常量供界面与导出侧使用
  editor = grapesjs.init({
    container,
    height: "100%",
    width: "auto",
    plugins: [],
    storageManager: false,
    // 固定设计画布（Task 2）：框架样式走 frameStyle（覆盖 GrapesJS 默认 body 背景，防样本 CSS 干扰）
    canvas: { frameStyle: canvasFrameStyle(DEFAULT_CANVAS) },
    // 保真关键：0.23 默认 avoidInlineStyle=true 会删除内联 style（Component.getAttrToHTML），
    // 样式转存 #id 规则且解析管道不回写，导致导出 HTML 丢样式。必须关闭。
    avoidInlineStyle: false,
    // 保真关键：forceClass=true（默认）会在组件加载时把内联样式转为生成类规则（c752 之类）
    // 并清空内联，但规则并未正确落库，导出即丢样式。关闭后保持纯内联模式。
    forceClass: false,
    // 保真关键：默认 protectedCss 会注入 * { box-sizing: border-box } 并混入 getCss 导出，
    // 改变 content-box 元素的几何（border 计入宽高）。清空以保持原始渲染行为。
    protectedCss: "",
    // 各管理器不挂载 DOM：界面由 React 外壳实现（Task 4），避免两套 UI 混合
    blockManager: { appendTo: "" },
    styleManager: { appendTo: "" },
    layerManager: { appendTo: "" },
    traitManager: { appendTo: "" },
    selectorManager: { appendTo: "" },
    // 保持图片 src 原样，禁止转 base64（资源路径约定）
    assetManager: { embedAsBase64: false },
  });
  // 调试句柄：控制台/验证脚本直接访问编辑器实例
  (window as unknown as { __editorInstance?: Editor }).__editorInstance = editor;
  return editor;
}

export function getEditor(): Editor {
  if (!editor) throw new Error("编辑器尚未初始化");
  return editor;
}
