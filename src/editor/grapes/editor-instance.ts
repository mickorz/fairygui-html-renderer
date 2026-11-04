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
    // 画布 iframe 实际尺寸（Task 2 修复）：iframe 默认 300x150，不设置则设计内容被裁剪、点击命中失效
    deviceManager: {
      devices: [
        {
          id: "design-canvas",
          name: "Design",
          width: DEFAULT_CANVAS.width + "px",
          height: DEFAULT_CANVAS.height + "px",
          widthMedia: "",
        },
      ],
    },
    // 拖动模式 absolute（Task 3 按需提升的基础）：拖动更新目标节点 left/top；
    // 不设置时 dmode 为空，拖动事件触发但样式不会更新
    dragMode: "absolute",
    // 保真关键：0.23 默认 avoidInlineStyle=true 会删除内联 style（Component.getAttrToHTML），
    // 样式转存 #id 规则且解析管道不回写，导致导出 HTML 丢样式。必须关闭。
    avoidInlineStyle: false,
    // 缩放/样式编辑写入目标修复（Task 3）：默认 componentFirst=false 时 Resize 命令把
    // width/height 写入组件类规则，但导入的内联 style 优先级更高会覆盖类规则，视觉无变化；
    // componentFirst=true 让编辑直接写组件内联 style（源码 style_manager/index.ts:498 getModelToStyle）
    selectorManager: { componentFirst: true, appendTo: "" },
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
    // 保持图片 src 原样，禁止转 base64（资源路径约定）
    assetManager: { embedAsBase64: false },
  });
  // 缩放交互修复（Task 3）：image 默认 resizable={ratioDefault:1} 无方向键，
  // Resizer 不创建任何交互 handle（源码 Resizer.ts:376 opts[hdl] falsy 即 null），
  // 补全八方向键使缩放可用（P0 不做等比锁定）
  editor.DomComponents.addType("image", {
    model: {
      defaults: {
        resizable: { tl: true, tc: true, tr: true, cl: true, cr: true, bl: true, bc: true, br: true },
      },
    },
  });
  // 调试句柄：控制台/验证脚本直接访问编辑器实例
  (window as unknown as { __editorInstance?: Editor }).__editorInstance = editor;
  return editor;
}

export function getEditor(): Editor {
  if (!editor) throw new Error("编辑器尚未初始化");
  return editor;
}
