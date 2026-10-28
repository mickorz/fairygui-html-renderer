import path from "node:path";
import type { ParsedComponent, ParsedNode } from "../parser/component-parser.js";
import type { FairyPackage, ImageResource } from "../parser/package-parser.js";

// Scene Tree -> 静态 HTML 渲染器（P0：image / text / graph，absolute 定位）

export interface RenderContext {
  pkg: FairyPackage;
  /** 把资源绝对路径转换为产物 HTML 中的 URL */
  toAssetUrl: (absFile: string) => string;
}

export interface UnsupportedItem {
  nodeId: string;
  reason: string;
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

function commonStyle(node: ParsedNode): string {
  const parts = [`left:${node.xy[0]}px`, `top:${node.xy[1]}px`];
  if (node.size) parts.push(`width:${node.size[0]}px`, `height:${node.size[1]}px`);
  const t: string[] = [];
  if (node.attrs.rotation) t.push(`rotate(${node.attrs.rotation}deg)`);
  const flip = node.attrs.flip;
  if (flip === "hz") t.push("scaleX(-1)");
  else if (flip === "vt") t.push("scaleY(-1)");
  else if (flip === "both") t.push("scale(-1,-1)");
  if (t.length) parts.push(`transform:${t.join(" ")}`);
  if (node.attrs.alpha !== undefined) parts.push(`opacity:${node.attrs.alpha}`);
  if (node.attrs.grayed === "true") parts.push("filter:grayscale(1)");
  return parts.join(";");
}

function dataAttrs(node: ParsedNode, file: string): string {
  const src = file.split(path.sep).join("/");
  return `data-fgui-id="${esc(node.id)}" data-fgui-name="${esc(node.name)}" data-fgui-src="${esc(src)}" data-fgui-type="${esc(node.type)}"`;
}

function renderNode(
  node: ParsedNode,
  comp: ParsedComponent,
  ctx: RenderContext,
  unsupported: UnsupportedItem[],
): string {
  // gearDisplay 可见性：当前 controller 页不在 pages 中则隐藏
  let gearStyle = "";
  if (node.gearDisplay) {
    const ctrl = comp.controllers.find((c) => c.name === node.gearDisplay!.controller);
    const visible = ctrl ? node.gearDisplay.pages.includes(ctrl.selected) : true;
    if (!visible) gearStyle = "visibility:hidden;";
  }

  if (node.unsupported) {
    unsupported.push({ nodeId: node.id, reason: node.unsupported });
    return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${commonStyle(node)};border:1px dashed #ff4d4f;background:rgba(255,77,79,.08)"></div>`;
  }

  switch (node.type) {
    case "image": {
      const res = ctx.pkg.byId(node.src ?? "");
      if (!res || res.kind !== "image") {
        unsupported.push({ nodeId: node.id, reason: `image 引用资源 ${node.src ?? "?"} 未找到` });
        return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${commonStyle(node)};border:1px dashed #ff4d4f"></div>`;
      }
      const style = [`${gearStyle}${commonStyle(node)}`];
      if (!node.size && res.width) style.push(`width:${res.width}px`, `height:${res.height}px`);
      if (node.attrs.color) unsupported.push({ nodeId: node.id, reason: `image 染色 color=${node.attrs.color} P0 未实现` });
      return `<img ${dataAttrs(node, comp.file)} src="${esc(ctx.toAssetUrl(res.file))}" class="fgui-node" style="${style.join(";")}" alt="">`;
    }
    case "text": {
      const style = [`${gearStyle}${commonStyle(node)}`];
      const autoSize = node.attrs.autoSize ?? "none";
      if (autoSize === "height" && node.size) {
        style.push("height:auto"); // 高度随内容自适应
      }
      style.push(`font-size:${node.attrs.fontSize ?? 12}px`);
      style.push(`color:${toCssColor(node.attrs.color, "#000000")}`);
      style.push("line-height:1.2;white-space:pre-wrap;overflow:hidden");
      if (node.attrs.align) style.push(`text-align:${node.attrs.align}`);
      if (node.attrs.valign) unsupported.push({ nodeId: node.id, reason: "text valign P0 未实现" });
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${style.join(";")}">${esc(node.attrs.text ?? "")}</div>`;
    }
    case "graph": {
      const style = [`${gearStyle}${commonStyle(node)}`];
      const fill = toCssColor(node.attrs.fillColor, "transparent");
      const gtype = node.attrs.type ?? "none";
      if (gtype === "ellipse") style.push("border-radius:50%");
      style.push(`background:${fill}`);
      if (node.attrs.lineSize !== undefined && node.attrs.lineSize !== "0") {
        unsupported.push({ nodeId: node.id, reason: "graph 描边 lineSize P0 未实现" });
      }
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${style.join(";")}"></div>`;
    }
    default: {
      unsupported.push({ nodeId: node.id, reason: `节点类型 ${node.type} 未支持` });
      return `<div ${dataAttrs(node, comp.file)} class="fgui-node" style="${gearStyle}${commonStyle(node)};border:1px dashed #ff4d4f;background:rgba(255,77,79,.08)"></div>`;
    }
  }
}

/** 渲染组件为完整静态 HTML */
export function renderHtml(comp: ParsedComponent, ctx: RenderContext): string {
  const unsupported: UnsupportedItem[] = [];
  const inner = comp.nodes.map((n) => renderNode(n, comp, ctx, unsupported)).join("\n    ");

  const listHtml = unsupported.length
    ? `<div class="unsupported-list">未支持 ${unsupported.length} 项: ${unsupported
        .map((u) => `${esc(u.nodeId)}(${esc(u.reason)})`)
        .join("; ")}</div>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(path.basename(comp.file))} - fairygui-html-renderer POC</title>
<style>
body { background:#2b2b2b; margin:0; padding:16px; font-family:sans-serif; }
.fgui-stage { position:relative; background:#5a5a5a; overflow:hidden; }
.fgui-node { position:absolute; box-sizing:border-box; }
.unsupported-list { position:fixed; left:0; bottom:0; right:0; background:rgba(0,0,0,.78); color:#ffd666; padding:6px 12px; font-size:12px; }
</style>
</head>
<body>
${listHtml}
<div class="fgui-stage" style="width:${comp.size[0]}px;height:${comp.size[1]}px">
    ${inner}
</div>
</body>
</html>
`;
}
