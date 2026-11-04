import type { NodeRenderInput } from "../types.js";
import { renderComponentNode } from "./component-node.js";
import { baseStyle, dataAttrs, esc, tintStyle } from "../utils.js";

// loader 节点渲染：url 指向包内 image 时渲染图片内容（scene-builder 已解析为 loaderRes）；
// url 指向包内 component 时（childComp，R12）复用 component 渲染；fill 五种填充按 FairyGUI FillType 语义映射；
// 无内容时灰底占位（不计入未支持清单）

/** FairyGUI FillType -> 图片尺寸样式（等比/单轴/拉伸/裁剪） */
function fillStyle(fill: string): string {
  switch (fill) {
    case "scale": return "max-width:100%;max-height:100%"; // 等比完整装入
    case "scaleFree": return "width:100%;height:100%"; // 不等比拉伸填满
    case "scaleNoBorder": return "width:100%;height:100%;object-fit:cover"; // 等比填满裁剪
    case "scaleMatchHeight": return "height:100%;width:auto"; // 高度匹配
    case "scaleMatchWidth": return "width:100%;height:auto"; // 宽度匹配
    default: return ""; // none：原尺寸，由容器对齐摆放
  }
}

export function renderLoaderNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, colorOverride, unsupported, tints } = input;
  // R12：url 指向包内组件（childComp）—— 复用 component 递归渲染；
  // ponytail: loader 的 fill/autoSize 对组件内容未实现，需要时再按 GLoader 语义补
  if (node.childComp) return renderComponentNode(input);
  const attrs = dataAttrs(node, comp.file);
  const res = node.loaderRes;
  if (!res) {
    const style = [`${gearStyle}${baseStyle(geo, node)}`];
    style.push("background:rgba(255,255,255,.08);border:1px solid #666");
    style.push("display:flex;align-items:center;justify-content:center;color:#999;font-size:11px");
    if (node.attrs.url) {
      const url = node.attrs.url;
      const reason = url.startsWith("ui://")
        ? `loader url=${url} 指向非图片资源（组件或动画）或无法解析`
        : `loader url=${url} 非 ui:// 包内资源`;
      unsupported.push({ nodeId: node.id, reason });
    }
    return `<div ${attrs} class="fgui-node" style="${style.join(";")}">Loader</div>`;
  }
  // 有内容：容器 flex 对齐（fill=none 时对齐生效，fill 类填满时对齐无效果，样式无害）
  const align = { left: "flex-start", center: "center", right: "flex-end" }[node.attrs.align ?? "left"] ?? "flex-start";
  const vAlign = { top: "flex-start", middle: "center", bottom: "flex-end" }[node.attrs.vAlign ?? "top"] ?? "flex-start";
  const wrap = [`${gearStyle}${baseStyle(geo, node)}`, `display:flex;justify-content:${align};align-items:${vAlign};overflow:hidden`];
  // 染色与灰化（复用 image 的 feColorMatrix 染色链路）
  const tintSrc = colorOverride ?? node.attrs.color;
  const tint = tintStyle(tintSrc, tints);
  const filter = [tint.replace(/;$/, ""), node.attrs.grayed === "true" ? "grayscale(1)" : ""].filter(Boolean).join(" ");
  const imgStyle = [fillStyle(node.attrs.fill ?? "none"), filter ? `filter:${filter}` : ""].filter(Boolean).join(";");
  return `<div ${attrs} class="fgui-node" style="${wrap.join(";")}"><img src="${esc(ctx.toAssetUrl(res.file))}" style="${imgStyle}" alt=""></div>`;
}
