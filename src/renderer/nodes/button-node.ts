import type { NodeRenderInput } from "../types.js";
import { renderComponentCore } from "./component-node.js";

// GButton 独立分支（挂在扩展层：extention="Button" 的组件，XML displayList 无 button 节点类型）
// 语义依据 OpenFairy Button/Migrate 源码：
//   - 状态页按页名映射（up/down/over/selectedOver/disabled/selectedDisabled），checked -> selectedOver 页
//     （页切换由 scene-builder injectButtonProps 在构建期改 button 控制器初始页，gearDisplay/gearLook 求值链自动生效）
//   - titleColor/titleFontSize 定义级属性注入 title 文本（同 title/icon，构建期）
// 渲染期职责：语义包装（data-fgui-ext / role / aria）+ 按钮渲染特化集中地

export function renderButtonNode(input: NodeRenderInput): string {
  return renderButtonLike(input, "Button", "button");
}

/** Button 族共用渲染（GComboBox 继承 GButton，见 combobox-node.ts） */
export function renderButtonLike(input: NodeRenderInput, ext: string, role: string): string {
  const { node } = input;
  const props = node.extensionProps?.[ext] ?? node.childComp?.comp.rootExtension?.[ext] ?? {};
  const checked = props.checked === "1" || props.checked === "true";
  // 组件渲染为主体，按钮语义以属性叠加（不改 DOM 结构，与 component 渲染完全兼容）
  const html = renderComponentCore(input);
  const semantics = [
    `data-fgui-ext="${ext}"`,
    `role="${role}"`,
    checked ? `aria-pressed="true"` : "",
    props.mode ? `data-fgui-mode="${props.mode}"` : "",
  ].filter(Boolean).join(" ");
  // 注入到根 div 的属性串（component 渲染产物首标签为 <div ...>）
  return html.replace("<div ", `<div ${semantics} `);
}
