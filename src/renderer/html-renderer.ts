import path from "node:path";
import type { ParsedComponent, ParsedNode } from "../parser/component-parser.js";
import { selectorScript } from "../selection/component-selector.js";
import { resolveGear } from "./nodes/gear.js";
import { renderImageNode } from "./nodes/image-node.js";
import { renderTextNode } from "./nodes/text-node.js";
import { renderGraphNode } from "./nodes/graph-node.js";
import { renderComponentNode } from "./nodes/component-node.js";
import { renderListNode } from "./nodes/list-node.js";
import { renderLoaderNode } from "./nodes/loader-node.js";
import type { NodeRenderer, RenderContext, UnsupportedItem } from "./nodes/types.js";
import { baseStyle, dataAttrs, esc, tintFilterDef } from "./nodes/utils.js";

// 场景树 -> 静态 HTML 渲染器（入口）
// 每种 FairyGUI 节点类型的映射规则在 nodes/<类型>-node.ts，本文件只做：
//   gear 解析（resolveGear）-> 按类型分发到对应节点渲染文件 -> 整页编排（SVG defs / 未支持清单 / 选择器）

export type { RenderContext, UnsupportedItem } from "./nodes/types.js";

export interface RenderOptions {
  /** 纯净模式：无信息栏/选择器脚本/内边距，专供截图对比与 MCP 截图 */
  bare?: boolean;
}

/** 节点类型 -> 渲染器注册表（新增类型：在 nodes/ 加文件并在此注册） */
const RENDERERS: Record<string, NodeRenderer> = {
  image: renderImageNode,
  text: renderTextNode,
  graph: renderGraphNode,
  component: renderComponentNode,
  list: renderListNode,
  loader: renderLoaderNode,
};

/** 创建持有本次渲染累积状态（未支持清单/染色集合）的渲染闭包 */
function createRenderChildren(unsupported: UnsupportedItem[], tints: Set<string>) {
  function renderNode(
    node: ParsedNode,
    comp: ParsedComponent,
    ctx: RenderContext,
    stack: string[],
    renderChildren: (comp: ParsedComponent, ctx: RenderContext, stack: string[]) => string,
  ): string {
    const { hidden, geo, colorOverride } = resolveGear(node, comp);
    const gearStyle = hidden ? "visibility:hidden;" : "";

    if (node.unsupported || !RENDERERS[node.type]) {
      const reason = node.unsupported ?? `节点类型 ${node.type} 未支持`;
      unsupported.push({ nodeId: node.id, reason });
      const attrs = dataAttrs(node, comp.file);
      return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f;background:rgba(255,77,79,.08)"></div>`;
    }
    return RENDERERS[node.type]({ node, comp, ctx, geo, gearStyle, colorOverride, stack, unsupported, tints, renderChildren });
  }
  function renderChildren(
    comp: ParsedComponent,
    ctx: RenderContext,
    stack: string[],
  ): string {
    return comp.nodes
      .map((n) => renderNode(n, comp, ctx, stack, renderChildren))
      .join("\n    ");
  }
  return renderChildren;
}

/** 渲染组件为完整静态 HTML（先经 scene-builder 构建子组件树） */
export function renderHtml(
  comp: ParsedComponent,
  ctx: RenderContext,
  options: { bare?: boolean } = {},
): string {
  const unsupported: UnsupportedItem[] = [];
  const tints = new Set<string>();
  const renderChildrenFn = createRenderChildren(unsupported, tints);
  const inner = renderChildrenFn(comp, ctx, [path.normalize(comp.file)]);

  const bare = options.bare === true;
  const listHtml = bare
    ? ""
    : unsupported.length
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
body { background:#2b2b2b; margin:0; padding:${bare ? 0 : 16}px; font-family:sans-serif; }
.fgui-stage { position:relative; background:#5a5a5a; overflow:hidden; }
.fgui-node { position:absolute; box-sizing:border-box; }
.fgui-selected { outline:2px solid #ffd666 !important; box-shadow:0 0 10px #ffd666 !important; z-index:9999; }
#fgui-info { position:fixed; left:0; top:0; right:0; background:rgba(0,0,0,.78); color:#8ee6ff; padding:6px 12px; font-size:12px; z-index:10000; }
.unsupported-list { position:fixed; left:0; bottom:0; right:0; background:rgba(0,0,0,.78); color:#ffd666; padding:6px 12px; font-size:12px; max-height:120px; overflow:auto; }
</style>
</head>
<body>
${defs}
${bare ? "" : '<div id="fgui-info">点击画布中的组件查看定位信息</div>'}
${listHtml}
<div class="fgui-stage" style="width:${comp.size[0]}px;height:${comp.size[1]}px">
    ${inner}
</div>
${bare ? "" : `<script>${selectorScript()}</script>`}
</body>
</html>
`;
}
