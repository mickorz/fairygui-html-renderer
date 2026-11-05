import path from "node:path";
import type { ImageResource } from "../parser/package-parser.js";
import type { ParsedNode } from "../parser/component-parser.js";
import type { Geo, RenderContext } from "./types.js";

// 渲染共享工具：转义 / 颜色 / 通用样式 / data 属性 / 九宫格 / 染色

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** FairyGUI 颜色 #AARRGGBB 或 #RRGGBB -> CSS color */
export function toCssColor(s: string | undefined, fallback: string): string {
  if (!s || s[0] !== "#") return fallback;
  const hex = s.slice(1);
  if (hex.length === 8) {
    const a = parseInt(hex.slice(0, 2), 16) / 255;
    const r = parseInt(hex.slice(2, 4), 16);
    const g = parseInt(hex.slice(4, 6), 16);
    const b = parseInt(hex.slice(6, 8), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (hex.length === 6) return `#${hex}`;
  return fallback;
}

/** 通用几何/视觉样式：位置尺寸 + 旋转/翻转 + 透明度 + 旋转基点（R25） */
export function baseStyle(geo: Geo, node: ParsedNode): string {
  const parts = [`left:${geo.xy[0]}px`, `top:${geo.xy[1]}px`];
  if (geo.size) parts.push(`width:${geo.size[0]}px`, `height:${geo.size[1]}px`);
  // R25：pivot 旋转基点（0-1 归一化）-> transform-origin 百分比
  if (node.attrs.pivot) {
    const [px, py] = node.attrs.pivot.split(",").map(Number);
    if (Number.isFinite(px) && Number.isFinite(py)) parts.push(`transform-origin:${px * 100}% ${py * 100}%`);
  }
  const t: string[] = [];
  if (node.attrs.rotation) t.push(`rotate(${node.attrs.rotation}deg)`);
  const flip = node.attrs.flip;
  if (flip === "hz") t.push("scaleX(-1)");
  else if (flip === "vt") t.push("scaleY(-1)");
  else if (flip === "both") t.push("scale(-1,-1)");
  if (t.length) parts.push(`transform:${t.join(" ")}`);
  if (node.attrs.alpha !== undefined) parts.push(`opacity:${node.attrs.alpha}`);
  return parts.join(";");
}

/** 节点溯源 data 属性（instancePath/stableKey 由 buildScene 构建时填充） */
export function dataAttrs(node: ParsedNode, file: string): string {
  const src = file.split(path.sep).join("/");
  return `data-fgui-id="${esc(node.id)}" data-fgui-name="${esc(node.name)}" data-fgui-src="${esc(src)}" data-fgui-type="${esc(node.type)}" data-fgui-path="${esc(node.instancePath ?? "")}" data-fgui-key="${esc(node.stableKey ?? "")}"`;
}

/** image 染色 filter 片段（登记到 tints 集合，renderHtml 末尾生成 SVG defs）；返回裸 url 引用，由调用方拼 filter 属性 */
export function tintStyle(color: string | undefined, tints: Set<string>): string {
  if (!color || !color.startsWith("#")) return "";
  const hex = color.slice(1).padStart(6, "0").slice(-6);
  tints.add(hex);
  return `url(#tint-${hex})`;
}

/** 染色色的 alpha 分量（#AARRGGBB），无 alpha 返回 null（R22） */
export function tintAlpha(color: string | undefined): number | null {
  if (!color || !color.startsWith("#")) return null;
  const hex = color.slice(1);
  if (hex.length !== 8) return null;
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  return Number.isFinite(a) ? a : null;
}

/** 染色 SVG filter 定义（feColorMatrix 对角矩阵 = 乘法染色） */
export function tintFilterDef(color: string): string {
  const hex = color.slice(1).padStart(6, "0").slice(-6);
  const r = (parseInt(hex.slice(0, 2), 16) / 255).toFixed(3);
  const g = (parseInt(hex.slice(2, 4), 16) / 255).toFixed(3);
  const b = (parseInt(hex.slice(4, 6), 16) / 255).toFixed(3);
  return `<filter id="tint-${hex}"><feColorMatrix type="matrix" values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0"/></filter>`;
}

/** 九宫格样式：仅 scale=9grid/tile 启用（对齐 FairyGUI 语义：保留 scale9grid 但未启用按整图）；scale9grid "x,y,w,h" -> border-image */
export function nineSliceStyle(res: ImageResource, ctx: RenderContext): string | null {
  if (!res.scale9grid || !res.width || !res.height) return null;
  if (res.scale !== "9grid" && res.scale !== "tile") return null;
  const [x, y, w, h] = res.scale9grid.split(",").map(Number);
  // 9grid 区域可能超出小图边界（如 2px 分隔线），clamp 到 0 避免 CSS slice 无效
  const right = Math.max(0, res.width - x - w);
  const bottom = Math.max(0, res.height - y - h);
  const repeat = res.scale === "tile" ? "repeat" : "stretch";
  return [
    // 单引号：style 属性由双引号包裹，CSS url 内用单引号避免截断 HTML 属性（老 bug：workspace 下九宫格图全失效）
    `border-image-source:url('${ctx.toAssetUrl(res.file)}')`,
    // fill 关键字：CSS border-image 默认不画中心，FairyGUI 九宫格画中心（中心拉伸）——漏 fill 会镂空露出 stage 底色
    `border-image-slice:${y} ${right} ${bottom} ${x} fill`,
    `border-image-width:${y}px ${right}px ${bottom}px ${x}px`,
    `border-image-repeat:${repeat}`,
  ].join(";");
}
