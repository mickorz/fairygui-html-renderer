import type { ParsedComponent, ParsedNode } from "../parser/component-parser.js";
import type { FairyPackage } from "../parser/package-parser.js";

// 渲染器共享类型：各节点渲染文件（nodes/*.ts）与入口（html-renderer.ts）共用

export interface RenderContext {
  pkg: FairyPackage;
  /** 把资源绝对路径转换为产物 HTML 中的 URL */
  toAssetUrl: (absFile: string) => string;
}

export interface UnsupportedItem {
  nodeId: string;
  reason: string;
}

/** gear 解析后的几何（gearXY/gearSize 默认页覆盖后的最终位置） */
export interface Geo {
  xy: [number, number];
  size?: [number, number];
}

/** 单个节点的渲染输入：分发层（html-renderer）组装后传给各节点渲染文件 */
export interface NodeRenderInput {
  node: ParsedNode;
  /** 节点所在场景 */
  comp: ParsedComponent;
  ctx: RenderContext;
  geo: Geo;
  /** gearDisplay 判定的隐藏样式前缀（"" 表示可见） */
  gearStyle: string;
  /** gearColor 默认页覆盖色（未命中为 undefined） */
  colorOverride?: string;
  stack: string[];
  unsupported: UnsupportedItem[];
  /** image 染色收集（renderHtml 末尾生成 SVG defs） */
  tints: Set<string>;
  /** 递归渲染子场景（component/list 用） */
  renderChildren: (comp: ParsedComponent, ctx: RenderContext, stack: string[]) => string;
}

export type NodeRenderer = (input: NodeRenderInput) => string;
