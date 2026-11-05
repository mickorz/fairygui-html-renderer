import type { NodeRenderInput } from "../types.js";
import { renderComponentCore } from "./component-node.js";

// GTree 独立分支（挂在扩展层：extention="Tree" 的组件，GTree 继承 GList）
// 边界（源码核实，见 dev-docs/research/2026-11-04-原版UI类覆盖与不做边界分析.md）：
//   XML 只有组件骨架（UIPackage: component extension -> ObjectType.Tree）；
//   TreeNode 树数据纯运行时 API 构建（GTree.treeView），发布 XML 不含树结构
//   -> 静态可做的部分：骨架正常渲染（内部 list 按既有逻辑展开）+ 语义包装；树数据无输入来源，如实上报

export function renderTreeNode(input: NodeRenderInput): string {
  const { node, unsupported } = input;
  unsupported.push({ nodeId: node.id, reason: "树数据无 XML 通道（运行时 TreeNode API 构建），仅渲染骨架" });
  const html = renderComponentCore(input);
  return html.replace("<div ", '<div data-fgui-ext="Tree" role="tree" ');
}
