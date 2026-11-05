import type { NodeRenderInput } from "../types.js";

// group 节点（GGroup）：无视觉的分组容器（R21）
// 成员节点靠 group 属性引用分组名、由各自渲染器定位渲染，group 本身不产生 DOM
export function renderGroupNode(_input: NodeRenderInput): string {
  return "";
}
