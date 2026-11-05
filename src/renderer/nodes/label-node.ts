import type { NodeRenderInput } from "../types.js";
import { renderComponentCore } from "./component-node.js";

// GLabel 独立分支（挂在扩展层：extention="Label"）
// OpenFairy 语义：Label 是 title/titleIcon 的组合展示（title/titleColor/titleFontSize 注入链构建期已覆盖，
// scene-builder injectButtonProps 对 Label 同样生效）；渲染期职责：语义包装
export function renderLabelNode(input: NodeRenderInput): string {
  const html = renderComponentCore(input);
  return html.replace("<div ", '<div data-fgui-ext="Label" role="label" ');
}
