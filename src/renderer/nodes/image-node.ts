import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs, esc, nineSliceStyle, tintStyle } from "../utils.js";

// image 节点渲染：普通图 <img>；九宫格 -> div + border-image（拉伸不变形）；染色 -> feColorMatrix filter

export function renderImageNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, colorOverride, unsupported, tints } = input;
  const attrs = dataAttrs(node, comp.file);
  const res = ctx.pkg.byId(node.src ?? "");
  if (!res || res.kind !== "image") {
    unsupported.push({ nodeId: node.id, reason: `image 引用资源 ${node.src ?? "?"} 未找到` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
  }
  const nine = nineSliceStyle(res, ctx);
  // gearColor 默认页覆盖 > 属性染色
  const tintSrc = colorOverride ?? node.attrs.color;
  const tint = tintStyle(tintSrc, tints);
  if (tintSrc && !tint) unsupported.push({ nodeId: node.id, reason: `image 染色 color=${tintSrc} 无法解析` });
  const filter = [tint, node.attrs.grayed === "true" ? "grayscale(1)" : ""].filter(Boolean).join(" ");
  if (nine) {
    // 九宫格：div + border-image（拉伸不变形）
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};${nine};${filter ? `filter:${filter};` : ""}"></div>`;
  }
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  if (!geo.size && res.width) style.push(`width:${res.width}px`, `height:${res.height}px`);
  if (filter) style.push(`filter:${filter}`);
  return `<img ${attrs} src="${esc(ctx.toAssetUrl(res.file))}" class="fgui-node" style="${style.join(";")}" alt="">`;
}
