import type { NodeRenderInput } from "./types.js";
import { baseStyle, dataAttrs } from "./utils.js";

// list（GList）节点渲染：按 buildScene 展开的 item 实例，SDK 词表布局（flow_hz/pagination 网格、row/column 流式）
// item 内容运行时从 defaultItem 建项（SDK ListSource 语义），静态包只登记数量

export function renderListNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, stack, unsupported, renderChildren } = input;
  const attrs = dataAttrs(node, comp.file);
  if (!node.listItems?.length) {
    unsupported.push({ nodeId: node.id, reason: "list 无可展开 item（缺 root 或 defaultItem 未解析）" });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f;background:rgba(255,77,79,.08)"></div>`;
  }
  const layout = node.attrs.layout ?? "";
  const colGap = node.attrs.colGap ? `${node.attrs.colGap}px` : "0";
  const lineGap = node.attrs.lineGap ? `${node.attrs.lineGap}px` : "0";
  // SDK 词表：column/row/flow_hz/flow_vt/pagination；flow_hz 用 grid 按 lineItemCount 换列
  const lineItems = node.attrs.lineItemCount ? Number(node.attrs.lineItemCount) : 0;
  const isGrid = layout === "flow_hz" || layout === "pagination";
  const itemSize = node.defaultItemSize;
  const items = node.listItems
    .map((item) => {
      const inner = renderChildren(item.scene, { pkg: item.pkg, toAssetUrl: ctx.toAssetUrl }, [...stack, `${node.stableKey}#${item.index}`]);
      // wrapper 需显式尺寸：子节点全部 absolute 脱离文档流，否则 grid/flex 内不可见
      const sizeStyle = itemSize ? `width:${itemSize.w}px;height:${itemSize.h}px;` : "";
      return `<div class="fgui-node" style="position:relative;flex:none;${sizeStyle}">${inner}</div>`;
    })
    .join("");
  let layoutStyle: string;
  if (isGrid && lineItems > 0) {
    layoutStyle = `display:grid;grid-template-columns:repeat(${lineItems},max-content);gap:${lineGap} ${colGap};`;
  } else if (layout === "row") {
    layoutStyle = `display:flex;flex-direction:row;gap:0 ${colGap};`;
  } else {
    layoutStyle = `display:flex;flex-direction:column;gap:${lineGap} 0;`;
  }
  return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};${layoutStyle}overflow:hidden">${items}</div>`;
}
