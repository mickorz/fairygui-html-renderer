import type { NodeRenderInput } from "../types.js";
import type { ParsedNode } from "../../parser/component-parser.js";
import { baseStyle, dataAttrs, esc, nineSliceStyle, tintAlpha, tintStyle } from "../utils.js";

// image 节点渲染：普通图 <img>；九宫格 -> div + border-image（拉伸不变形）；染色 -> feColorMatrix filter
// R14：fillMethod 填充（进度/冷却类）：hz/vt 用 clip-path，radial360 用 conic mask（对齐 uGUI FillMethod 语义）

/** fillMethod 填充样式；amount>=100 或无 fillMethod 时返回 null（完整显示） */
function fillMethodStyle(node: ParsedNode): string | null {
  const m = node.attrs.fillMethod;
  if (!m) return null;
  const amount = node.attrs.fillAmount !== undefined ? Number(node.attrs.fillAmount) : 100;
  if (!Number.isFinite(amount) || amount < 0 || amount >= 100) return null;
  const origin = node.attrs.fillOrigin !== undefined ? Number(node.attrs.fillOrigin) : 0;
  if (m === "hz") {
    // uGUI Horizontal：origin 0=左起 1=右起
    return origin === 1 ? `clip-path:inset(0 0 0 ${100 - amount}%)` : `clip-path:inset(0 ${100 - amount}% 0 0)`;
  }
  if (m === "vt") {
    // uGUI Vertical：origin 0=下起 1=上起
    return origin === 1 ? `clip-path:inset(0 0 ${100 - amount}% 0)` : `clip-path:inset(${100 - amount}% 0 0 0)`;
  }
  if (m === "radial360") {
    // uGUI Radial360：origin 0=下 1=右 2=上 3=左；CSS conic 0deg=上、顺时针
    const start = [180, 90, 0, 270][Math.min(Math.max(origin, 0), 3)];
    const deg = amount * 3.6;
    const cw = node.attrs.fillClockwise !== "false"; // 缺省顺时针
    const grad = cw
      ? `conic-gradient(from ${start}deg, #000 0deg ${deg}deg, transparent ${deg}deg)`
      : `conic-gradient(from ${start}deg, transparent 0deg ${360 - deg}deg, #000 ${360 - deg}deg)`;
    return `-webkit-mask-image:${grad};mask-image:${grad}`;
  }
  return null;
}

export function renderImageNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, colorOverride, unsupported, tints } = input;
  const attrs = dataAttrs(node, comp.file);
  const res = ctx.pkg.byId(node.src ?? "");
  if (!res || res.kind !== "image") {
    unsupported.push({ nodeId: node.id, reason: `image 引用资源 ${node.src ?? "?"} 未找到` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
  }
  const nine = nineSliceStyle(res, ctx);
  // R14：fillMethod 样式（radial90/180/270 等未支持的填充方式显式上报）
  const fillM = node.attrs.fillMethod;
  const fillClip = fillMethodStyle(node);
  if (fillM && !fillClip && fillM !== "hz" && fillM !== "vt" && fillM !== "radial360") {
    unsupported.push({ nodeId: node.id, reason: `image fillMethod=${fillM} 未实现` });
  }
  // gearColor 默认页覆盖 > 属性染色
  const tintSrc = colorOverride ?? node.attrs.color;
  const tint = tintStyle(tintSrc, tints);
  if (tintSrc && !tint) unsupported.push({ nodeId: node.id, reason: `image 染色 color=${tintSrc} 无法解析` });
  // R22：染色 8 位色的 alpha 分量与节点 alpha 复合（后置 opacity 覆盖 baseStyle 的同名项）
  const tintA = tintAlpha(tintSrc);
  const nodeA = node.attrs.alpha !== undefined ? Number(node.attrs.alpha) : 1;
  const alphaStyle = tintA !== null && tintA < 1
    ? `opacity:${(tintA * (Number.isFinite(nodeA) ? nodeA : 1)).toFixed(3)}`
    : "";
  const filter = [tint, node.attrs.grayed === "true" ? "grayscale(1)" : ""].filter(Boolean).join(" ");
  if (nine) {
    // 九宫格：div + border-image（拉伸不变形）；无 size 属性时用图原生尺寸（与普通分支同兑底，Button.xml n1 实测）
    const nineStyle = [`${gearStyle}${baseStyle(geo, node)}`];
    if (!geo.size && res.width) nineStyle.push(`width:${res.width}px`, `height:${res.height}px`);
    if (alphaStyle) nineStyle.push(alphaStyle);
    nineStyle.push(nine);
    if (fillClip) nineStyle.push(fillClip);
    if (filter) nineStyle.push(`filter:${filter}`);
    return `<div ${attrs} class="fgui-node" style="${nineStyle.join(";")}"></div>`;
  }
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  if (!geo.size && res.width) style.push(`width:${res.width}px`, `height:${res.height}px`);
  // R22：aspect 保持纵横比（尺寸已指定时等比装入，对齐 FairyGUI aspect 语义）
  if (node.attrs.aspect === "true" && geo.size) style.push("object-fit:contain");
  if (alphaStyle) style.push(alphaStyle);
  if (fillClip) style.push(fillClip);
  if (filter) style.push(`filter:${filter}`);
  return `<img ${attrs} src="${esc(ctx.toAssetUrl(res.file))}" class="fgui-node" style="${style.join(";")}" alt="">`;
}
