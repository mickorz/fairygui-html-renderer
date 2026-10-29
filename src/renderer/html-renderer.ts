import path from "node:path";
import type { ParsedComponent, ParsedNode, Gear } from "../parser/component-parser.js";
import type { FairyPackage, ImageResource } from "../parser/package-parser.js";
import { getComponent } from "../scene/scene-builder.js";

// 场景树 -> 静态 HTML 渲染器
// P1：嵌套组件递归、九宫格 border-image、color 染色 SVG filter、gearXY/gearSize 默认页取值

export interface RenderContext {
  pkg: FairyPackage;
  /** 把资源绝对路径转换为产物 HTML 中的 URL */
  toAssetUrl: (absFile: string) => string;
}

export interface UnsupportedItem {
  nodeId: string;
  reason: string;
}

interface Geo {
  xy: [number, number];
  size?: [number, number];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** FairyGUI 颜色 #AARRGGBB 或 #RRGGBB -> CSS color */
function toCssColor(s: string | undefined, fallback: string): string {
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

/**
 * gear 默认页取值：selected 页在 pages 中且有值（非 "-"）时用页值，否则用 default。
 * 返回 null 表示 gear 对几何无影响。
 */
function applyGear(gear: Gear, comp: ParsedComponent, geo: Geo): void {
  const ctrl = comp.controllers.find((c) => c.name === gear.controller);
  if (!ctrl) return;
  const idx = ctrl.pageIds.indexOf(ctrl.selected);
  let value = gear.default;
  if (idx >= 0 && gear.values && gear.values[idx] && gear.values[idx] !== "-") {
    value = gear.values[idx];
  }
  if (!value || value === "-") return;
  const pair = value.split(",").map(Number);
  if (gear.kind === "xy") geo.xy = [pair[0] ?? geo.xy[0], pair[1] ?? geo.xy[1]];
  else if (gear.kind === "size" && pair.length === 2 && !Number.isNaN(pair[0])) geo.size = [pair[0], pair[1]];
}

/** 计算 gearDisplay 可见性与 gearXY/gearSize 几何 */
function resolveGear(node: ParsedNode, comp: ParsedComponent): { hidden: boolean; geo: Geo } {
  const geo: Geo = { xy: node.xy, size: node.size };
  let hidden = false;
  for (const gear of node.gears) {
    const ctrl = comp.controllers.find((c) => c.name === gear.controller);
    if (gear.kind === "display") {
      if (ctrl && !gear.pages.includes(ctrl.selected)) hidden = true;
    } else {
      applyGear(gear, comp, geo);
    }
  }
  return { hidden, geo };
}

function baseStyle(geo: Geo, node: ParsedNode): string {
  const parts = [`left:${geo.xy[0]}px`, `top:${geo.xy[1]}px`];
  if (geo.size) parts.push(`width:${geo.size[0]}px`, `height:${geo.size[1]}px`);
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

function dataAttrs(node: ParsedNode, file: string): string {
  const src = file.split(path.sep).join("/");
  return `data-fgui-id="${esc(node.id)}" data-fgui-name="${esc(node.name)}" data-fgui-src="${esc(src)}" data-fgui-type="${esc(node.type)}"`;
}

/** 收集 image 染色需要的 SVG filter 定义（乘法染色） */
function tintFilterDef(color: string): string {
  const hex = color.slice(1).padStart(6, "0").slice(-6);
  const r = (parseInt(hex.slice(0, 2), 16) / 255).toFixed(3);
  const g = (parseInt(hex.slice(2, 4), 16) / 255).toFixed(3);
  const b = (parseInt(hex.slice(4, 6), 16) / 255).toFixed(3);
  return `<filter id="tint-${hex}"><feColorMatrix type="matrix" values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0"/></filter>`;
}

/** 九宫格样式：scale9grid "x,y,w,h" -> border-image（slice 四边换算） */
function nineSliceStyle(res: ImageResource, ctx: RenderContext): string | null {
  if (!res.scale9grid || !res.width || !res.height) return null;
  const [x, y, w, h] = res.scale9grid.split(",").map(Number);
  // 9grid 区域可能超出小图边界（如 2px 分隔线），clamp 到 0 避免 CSS slice 无效
  const right = Math.max(0, res.width - x - w);
  const bottom = Math.max(0, res.height - y - h);
  const repeat = res.scale === "tile" ? "repeat" : "stretch";
  return [
    `border-image-source:url("${ctx.toAssetUrl(res.file)}")`,
    `border-image-slice:${y} ${right} ${bottom} ${x}`,
    `border-image-width:${y}px ${right}px ${bottom}px ${x}px`,
    `border-image-repeat:${repeat}`,
  ].join(";");
}

function renderNode(
  node: ParsedNode,
  comp: ParsedComponent,
  ctx: RenderContext,
  stack: string[],
  unsupported: UnsupportedItem[],
  tints: Set<string>,
): string {
  const { hidden, geo } = resolveGear(node, comp);
  const gearStyle = hidden ? "visibility:hidden;" : "";

  const tintStyle = (attr: string | undefined): string => {
    if (!attr || !attr.startsWith("#")) return "";
    const hex = attr.slice(1).padStart(6, "0").slice(-6);
    tints.add(hex);
    return `filter:url(#tint-${hex});`;
  };

  // 未支持类型：虚线占位 + 上报
  if (node.unsupported) {
    unsupported.push({ nodeId: node.id, reason: node.unsupported });
    return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f;background:rgba(255,77,79,.08)"></div>`;
  }

  switch (node.type) {
    case "component": {
      if (!node.childComp) {
        unsupported.push({ nodeId: node.id, reason: "component 子场景未构建" });
        return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
      }
      const child = node.childComp.comp;
      // 尺寸：节点未指定时用子组件自身设计尺寸
      if (!geo.size) geo.size = child.size;
      // 嵌套容器：子节点 absolute 定位相对本容器
      const inner = renderChildren(child, ctx, [...stack, node.childComp.file], unsupported, tints);
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}">${inner}</div>`;
    }
    case "image": {
      const res = ctx.pkg.byId(node.src ?? "");
      if (!res || res.kind !== "image") {
        unsupported.push({ nodeId: node.id, reason: `image 引用资源 ${node.src ?? "?"} 未找到` });
        return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
      }
      const nine = nineSliceStyle(res, ctx);
      const tint = tintStyle(node.attrs.color);
      if (node.attrs.color && !tint) unsupported.push({ nodeId: node.id, reason: `image 染色 color=${node.attrs.color} 无法解析` });
      const filter = [tint, node.attrs.grayed === "true" ? "grayscale(1)" : ""].filter(Boolean).join(" ");
      if (nine) {
        // 九宫格：div + border-image（拉伸不变形）
        return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};${nine};${filter ? `filter:${filter};` : ""}"></div>`;
      }
      const style = [`${gearStyle}${baseStyle(geo, node)}`];
      if (!geo.size && res.width) style.push(`width:${res.width}px`, `height:${res.height}px`);
      if (filter) style.push(`filter:${filter}`);
      return `<img ${dataAttrs(node, comp.file)} src="${esc(ctx.toAssetUrl(res.file))}" class="fgui-node" style="${style.join(";")}" alt="">`;
    }
    case "text": {
      const style = [`${gearStyle}${baseStyle(geo, node)}`];
      const autoSize = node.attrs.autoSize ?? "none";
      if (autoSize === "height" && geo.size) style.push("height:auto"); // 高度随内容自适应
      style.push(`font-size:${node.attrs.fontSize ?? 12}px`);
      style.push(`color:${toCssColor(node.attrs.color, "#000000")}`);
      style.push("line-height:1.2;white-space:pre-wrap;overflow:hidden");
      if (node.attrs.align) style.push(`text-align:${node.attrs.align}`);
      if (node.attrs.valign) unsupported.push({ nodeId: node.id, reason: "text valign 未实现" });
      if (node.attrs.strokeColor) unsupported.push({ nodeId: node.id, reason: "text 描边 strokeColor 未实现" });
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${style.join(";")}">${esc(node.attrs.text ?? "")}</div>`;
    }
    case "graph": {
      const style = [`${gearStyle}${baseStyle(geo, node)}`];
      const gtype = node.attrs.type ?? "none";
      if (gtype === "ellipse") style.push("border-radius:50%");
      style.push(`background:${toCssColor(node.attrs.fillColor, "transparent")}`);
      if (node.attrs.lineSize !== undefined && node.attrs.lineSize !== "0") {
        unsupported.push({ nodeId: node.id, reason: "graph 描边 lineSize 未实现" });
      }
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${style.join(";")}"></div>`;
    }
    default: {
      unsupported.push({ nodeId: node.id, reason: `节点类型 ${node.type} 未支持` });
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f;background:rgba(255,77,79,.08)"></div>`;
    }
  }
}

function renderChildren(
  comp: ParsedComponent,
  ctx: RenderContext,
  stack: string[],
  unsupported: UnsupportedItem[],
  tints: Set<string>,
): string {
  return comp.nodes.map((n) => renderNode(n, comp, ctx, stack, unsupported, tints)).join("\n    ");
}

/** 渲染组件为完整静态 HTML（先经 scene-builder 构建子组件树） */
export function renderHtml(comp: ParsedComponent, ctx: RenderContext): string {
  const unsupported: UnsupportedItem[] = [];
  const tints = new Set<string>();
  const inner = renderChildren(comp, ctx, [path.normalize(comp.file)], unsupported, tints);

  const listHtml = unsupported.length
    ? `<div class="unsupported-list">未支持 ${unsupported.length} 项: ${unsupported
        .map((u) => `${esc(u.nodeId)}(${esc(u.reason)})`)
        .join("; ")}</div>`
    : "";

  const defs = tints.size ? `<svg width="0" height="0" style="position:absolute"><defs>${[...tints].map(tintFilterDef).join("")}</defs></svg>` : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(path.basename(comp.file))} - fairygui-html-renderer</title>
<style>
body { background:#2b2b2b; margin:0; padding:16px; font-family:sans-serif; }
.fgui-stage { position:relative; background:#5a5a5a; overflow:hidden; }
.fgui-node { position:absolute; box-sizing:border-box; }
.unsupported-list { position:fixed; left:0; bottom:0; right:0; background:rgba(0,0,0,.78); color:#ffd666; padding:6px 12px; font-size:12px; max-height:120px; overflow:auto; }
</style>
</head>
<body>
${defs}
${listHtml}
<div class="fgui-stage" style="width:${comp.size[0]}px;height:${comp.size[1]}px">
    ${inner}
</div>
</body>
</html>
`;
}
