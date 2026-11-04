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
  // R10：圆角 corner（顺序 tl,tr,bl,br，与 FairyGUI 一致；1 值扩展 4 角对齐 OpenFairy radii[min(i,len-1)]）
  const corner = node.attrs.corner;
  if (corner !== undefined && gtype === "rect") {
    const radii = corner.split(",").map(Number);
    if (radii.length && radii.every((r) => Number.isFinite(r))) {
      const [tl, tr, bl, br] = [0, 1, 2, 3].map((i) => radii[Math.min(i, radii.length - 1)]);
      style.push(
        `border-top-left-radius:${tl}px`,
        `border-top-right-radius:${tr}px`,
        `border-bottom-left-radius:${bl}px`,
        `border-bottom-right-radius:${br}px`,
      );
    }
  } else if (corner !== undefined && corner !== "" && gtype !== "rect") {
    unsupported.push({ nodeId: node.id, reason: `graph corner=${corner} 仅 rect 支持` });
  }
  // R10：描边（rect/ellipse 已实现，box-sizing:border-box 保证描边不扩外；其他形状仍上报）
  const lineSize = Number(node.attrs.lineSize ?? 0);
  if (lineSize > 0) {
    if (gtype === "rect" || gtype === "ellipse") {
      style.push(`border:${lineSize}px solid ${toCssColor(node.attrs.lineColor, "#000000")}`);
    } else {
      unsupported.push({ nodeId: node.id, reason: "graph 描边 lineSize 仅 rect/ellipse 支持" });
    }
  }
  // 未消费属性显式上报（消除静默错形）：多边形/星形/斜切
  for (const k of ["points", "sides", "startAngle", "distances", "skew"]) {
    if (node.attrs[k] !== undefined && node.attrs[k] !== "") {
      unsupported.push({ nodeId: node.id, reason: `graph ${k}=${node.attrs[k]} 未实现` });
    }
  }
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}"></div>`;
}
