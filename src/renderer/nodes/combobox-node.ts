import type { NodeRenderInput } from "../types.js";
import { renderButtonLike } from "./button-node.js";

// GComboBox 独立分支（挂在扩展层：extention="ComboBox"）
// OpenFairy 语义：ComboBox 继承 Button（复用 up/down/over 视觉态 + checked/titleColor/titleFontSize 注入链）；
// 选项静态化在构建期（scene-builder：首项 title/icon 下发，selectedIndex 缺省 0），下拉弹层属运行时不渲染

export function renderComboBoxNode(input: NodeRenderInput): string {
  return renderButtonLike(input, "ComboBox", "combobox");
}
