import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs } from "../utils.js";

// loader 节点渲染：无 url 时由运行时填充，静态渲染给灰底占位（不计入未支持清单）

export function renderLoaderNode(input: NodeRenderInput): string {
  const { node, comp, geo, gearStyle, unsupported } = input;
  const attrs = dataAttrs(node, comp.file);
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  style.push("background:rgba(255,255,255,.08);border:1px solid #666");
  style.push("display:flex;align-items:center;justify-content:center;color:#999;font-size:11px");
  if (node.attrs.url) unsupported.push({ nodeId: node.id, reason: `loader url=${node.attrs.url} 渲染未实现` });
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}">Loader</div>`;
}
