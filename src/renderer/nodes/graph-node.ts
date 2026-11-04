import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs, toCssColor } from "../utils.js";

// graph 节点渲染：形状（ellipse/矩形）+ 填充色；gearColor 默认页覆盖填充
// R02：旧编辑器拼写 eclipse 归一；未支持的形状类型与属性显式上报，不再静默错形

export function renderGraphNode(input: NodeRenderInput): string {
  const { node, comp, geo, gearStyle, colorOverride, unsupported } = input;
  const attrs = dataAttrs(node, comp.file);
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  // 旧编辑器拼写 eclipse -> ellipse（对齐 OpenFairy FairyXml 归一行为）
  const gtype = (node.attrs.type ?? "none").replace("eclipse", "ellipse");
  if (gtype === "ellipse") style.push("border-radius:50%");
  else if (gtype !== "rect" && gtype !== "none") {
    unsupported.push({ nodeId: node.id, reason: `graph 形状 type=${gtype} 未实现` });
  }
  style.push(`background:${colorOverride ?? toCssColor(node.attrs.fillColor, "transparent")}`);
  // 未消费属性显式上报（消除静默错形）：圆角/多边形/星形/斜切/描边
  for (const k of ["corner", "points", "sides", "startAngle", "distances", "skew"]) {
    if (node.attrs[k] !== undefined && node.attrs[k] !== "") {
      unsupported.push({ nodeId: node.id, reason: `graph ${k}=${node.attrs[k]} 未实现` });
    }
  }
  if (node.attrs.lineSize !== undefined && node.attrs.lineSize !== "0") {
    unsupported.push({ nodeId: node.id, reason: "graph 描边 lineSize 未实现" });
  }
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}"></div>`;
}
