import fs from "node:fs";
import type { ExtractData, ExtractNode } from "./extractor.js";

// style-mapper（阶段 G）：提取 JSON -> FairyGUI 节点树
// 容器 div -> component（递归成组件文件）；纯色背景容器先铺 graph 背景；
// Flex/Grid 等布局无需关心——提取发生在浏览器渲染后，坐标即最终位置。

export type FGKind = "image" | "text" | "graph" | "component";

export interface FGNode {
  kind: FGKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string;
  text?: string;
  fontSize?: number;
  color?: string;
  strokeColor?: string;
  strokeSize?: number;
  fillColor?: string;
  alpha?: number;
  rotation?: number;
  children?: FGNode[];
}

export interface SkippedItem {
  id: string;
  reason: string;
}

export interface MapReport {
  total: number;
  byKind: Record<string, number>;
  skipped: SkippedItem[];
}

export interface MapResult {
  nodes: FGNode[];
  report: MapReport;
}

/** css rgb(r,g,b) 或 #hex -> #rrggbb */
export function toHexColor(css: string | undefined): string | null {
  if (!css) return null;
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  }
  if (css.startsWith("#")) {
    const hex = css.slice(1);
    return `#${hex.padStart(6, "0").slice(-6)}`;
  }
  return null;
}

/** 读 PNG IHDR 取原始尺寸（package.xml 登记需要）；非 PNG 返回 null */
export function readPngSize(file: string): { width: number; height: number } | null {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function mapExtract(data: ExtractData): MapResult {
  const report: MapReport = { total: 0, byKind: {}, skipped: [] };
  const nodes = mapNodes(data.nodes, report);
  return { nodes, report };
}

export function mapNodes(nodes: ExtractNode[], report: MapReport): FGNode[] {
  const out: FGNode[] = [];
  for (const n of nodes) {
    out.push(...mapNode(n, report));
  }
  return out;
}

function bump(report: MapReport, kind: string): void {
  report.total++;
  report.byKind[kind] = (report.byKind[kind] ?? 0) + 1;
}

function mapNode(n: ExtractNode, report: MapReport): FGNode[] {
  const base: { name: string; x: number; y: number; w: number; h: number; alpha?: number; rotation?: number } = {
    name: n.id,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
  };
  if (n.rotation !== undefined) base.rotation = n.rotation;
  if (n.opacity !== undefined) base.alpha = n.opacity;

  switch (n.kind) {
    case "image": {
      bump(report, "image");
      return [{ ...base, kind: "image", src: n.src }];
    }
    case "text": {
      // 带背景色的文字：FairyGUI text 无背景语义，先铺同尺寸 graph 再叠文字
      const bgNodes: FGNode[] = [];
      if (n.bgColor) {
        bgNodes.push({ kind: "graph", name: `${n.id}_bg`, x: n.x, y: n.y, w: n.w, h: n.h, fillColor: toHexColor(n.bgColor) ?? "#808080" });
        bump(report, "graph");
      }
      bump(report, "text");
      const node: FGNode = {
        ...base,
        kind: "text",
        text: n.text ?? "",
        fontSize: n.fontSize ?? 12,
        color: toHexColor(n.color) ?? "#000000",
      };
      if (n.strokeColor) {
        node.strokeColor = toHexColor(n.strokeColor) ?? "#000000";
        node.strokeSize = n.strokeSize ?? 2;
      }
      return [...bgNodes, node];
    }
    case "graph": {
      bump(report, "graph");
      return [{ ...base, kind: "graph", fillColor: toHexColor(n.fillColor) ?? "#808080" }];
    }
    case "container": {
      bump(report, "component");
      const children: FGNode[] = [];
      // 容器背景 -> 先铺一块同尺寸 graph（FairyGUI component 无背景语义）
      const bg = (n as ExtractNode & { fillColor?: string }).fillColor;
      if (bg) {
        children.push({
          kind: "graph",
          name: `${n.id}_bg`,
          x: 0,
          y: 0,
          w: n.w,
          h: n.h,
          fillColor: toHexColor(bg) ?? "#808080",
        });
        bump(report, "graph");
      }
      if (n.children) children.push(...mapNodes(n.children, report));
      return [{ ...base, kind: "component", children }];
    }
    default: {
      report.skipped.push({ id: n.id, reason: `未知节点类型 ${(n as ExtractNode).kind}` });
      return [];
    }
  }
}
