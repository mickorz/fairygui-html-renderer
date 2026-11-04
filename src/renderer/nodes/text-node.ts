import type { NodeRenderInput } from "./types.js";
import { baseStyle, dataAttrs, esc, toCssColor } from "./utils.js";

// text 节点渲染：字号/颜色/描边/自动尺寸/对齐；gearColor 默认页覆盖属性色

export function renderTextNode(input: NodeRenderInput): string {
  const { node, comp, geo, gearStyle, colorOverride, unsupported } = input;
  const attrs = dataAttrs(node, comp.file);
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  const autoSize = node.attrs.autoSize ?? "none";
  if (autoSize === "height" && geo.size) style.push("height:auto"); // 高度随内容自适应
  style.push(`font-size:${node.attrs.fontSize ?? 12}px`);
  // gearColor 默认页覆盖 > 属性色
  style.push(`color:${colorOverride ?? toCssColor(node.attrs.color, "#000000")}`);
  // 描边（近似：FairyGUI 描边向外，CSS text-stroke 居中，视觉略细）
  if (node.attrs.strokeColor) {
    const size = node.attrs.strokeSize ? Number(node.attrs.strokeSize) : 2;
    style.push(`-webkit-text-stroke:${size}px ${toCssColor(node.attrs.strokeColor, "#000000")}`);
  }
  style.push("line-height:1.2;white-space:pre-wrap;overflow:hidden");
  if (node.attrs.align) style.push(`text-align:${node.attrs.align}`);
  if (node.attrs.valign) unsupported.push({ nodeId: node.id, reason: "text valign 未实现" });
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}">${esc(node.attrs.text ?? "")}</div>`;
}
