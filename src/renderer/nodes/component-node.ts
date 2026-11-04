import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs } from "../utils.js";
import { renderButtonNode } from "./button-node.js";

// component 节点渲染：容器 <div> 递归渲染子场景（子节点 absolute 定位相对本容器）
// 扩展层分发：extention="Button" 的组件走 GButton 独立分支（button-node，语义包装/按钮特化集中地）

export function renderComponentNode(input: NodeRenderInput): string {
  // 扩展层分发：extention="Button" 的组件走 GButton 独立分支
  if (input.node.childComp?.comp.extension === "Button") {
    return renderButtonNode(input);
  }
  return renderComponentCore(input);
}

/** 组件递归渲染主体（button-node 分支复用，避免再走分发死循环） */
export function renderComponentCore(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, stack, unsupported, renderChildren } = input;
  const attrs = dataAttrs(node, comp.file);
  if (!node.childComp) {
    unsupported.push({ nodeId: node.id, reason: "component 子场景未构建" });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
  }
  const child = node.childComp.comp;
  // 尺寸：节点未指定时用子组件自身设计尺寸
  if (!geo.size) geo.size = child.size;
  // 组件级 overflow（hidden/scroll）：裁剪子内容，scroll 按首屏观感同样裁剪（R01）
  const clip = child.overflow && child.overflow !== "visible" ? ";overflow:hidden" : "";
  // 嵌套容器：子节点 absolute 定位相对本容器（path/key 已由 buildScene 填充）
  const inner = renderChildren(child, ctx, [...stack, node.childComp.file]);
  return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}${clip}">${inner}</div>`;
}
