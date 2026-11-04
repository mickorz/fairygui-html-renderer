import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs, esc, toCssColor } from "../utils.js";

// text 节点渲染：字号/颜色/描边/自动尺寸/对齐；gearColor 默认页覆盖属性色
// R03：vAlign 垂直对齐 flex 实现；行距按 FairyGUI 公式 round(fontSize*1.25)+leading-1 换算

export function renderTextNode(input: NodeRenderInput): string {
  const { node, comp, geo, gearStyle, colorOverride, unsupported } = input;
  const attrs = dataAttrs(node, comp.file);
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  const autoSize = node.attrs.autoSize ?? "none";
  if (autoSize === "height" && geo.size) style.push("height:auto"); // 高度随内容自适应
  const fontSize = Number(node.attrs.fontSize ?? 12);
  style.push(`font-size:${fontSize}px`);
  // 行高：对齐 FairyGUI 排版公式（缺省 leading=3）
  const leading = Number(node.attrs.leading ?? 3);
  style.push(`line-height:${Math.round(fontSize * 1.25) + leading - 1}px`);
  if (node.attrs.letterSpacing !== undefined) style.push(`letter-spacing:${node.attrs.letterSpacing}px`);
  // gearColor 默认页覆盖 > 属性色
  style.push(`color:${colorOverride ?? toCssColor(node.attrs.color, "#000000")}`);
  // 描边（近似：FairyGUI 描边向外，CSS text-stroke 居中，视觉略细）
  if (node.attrs.strokeColor) {
    const size = node.attrs.strokeSize ? Number(node.attrs.strokeSize) : 2;
    style.push(`-webkit-text-stroke:${size}px ${toCssColor(node.attrs.strokeColor, "#000000")}`);
  }
  style.push("white-space:pre-wrap;overflow:hidden");
  if (node.attrs.align) style.push(`text-align:${node.attrs.align}`);
  // 垂直对齐：flex 列容器实现 top/middle/bottom
  if (node.attrs.vAlign) {
    const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[node.attrs.vAlign as "top" | "middle" | "bottom"];
    if (justify) {
      style.push("display:flex", "flex-direction:column", `justify-content:${justify}`);
    } else {
      unsupported.push({ nodeId: node.id, reason: `text vAlign=${node.attrs.vAlign} 无法识别` });
    }
  }
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}">${esc(node.attrs.text ?? "")}</div>`;
}
