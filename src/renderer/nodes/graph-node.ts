import type { NodeRenderInput } from "./types.js";
import { baseStyle, dataAttrs, toCssColor } from "./utils.js";

// graph 节点渲染：形状（ellipse/矩形）+ 填充色；gearColor 默认页覆盖填充

export function renderGraphNode(input: NodeRenderInput): string {
  const { node, comp, geo, gearStyle, colorOverride, unsupported } = input;
  const attrs = dataAttrs(node, comp.file);
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  const gtype = node.attrs.type ?? "none";
  if (gtype === "ellipse") style.push("border-radius:50%");
  style.push(`background:${colorOverride ?? toCssColor(node.attrs.fillColor, "transparent")}`);
  if (node.attrs.lineSize !== undefined && node.attrs.lineSize !== "0") {
    unsupported.push({ nodeId: node.id, reason: "graph 描边 lineSize 未实现" });
  }
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}"></div>`;
}
