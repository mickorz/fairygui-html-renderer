import type { UiAssetIndexResult, UiAssetEntry } from "./ui-asset-index.js";

// 组件关系图谱（沿袭 egret 项目 P2-B component-graph，适配 FairyGUI 资源模型）
// 数据流：
//   buildUiAssetIndex()（资产索引，含 refs 引用边）
//     └─> buildComponentGraph()
//           ├─> 边收集：refs 中 kind=component 的引用边（src / url / defaultItem）
//           ├─> 节点登记：全部组件（含无人引用的入口组件）
//           ├─> Tarjan SCC：图级环检测（区别于场景级展开环：跨分支环不是场景环，但图上存在）
//           └─> 统计：出入度 / 枢纽排行 / 未被引用清单
//
// 节点身份：pkgId.resId（与 ui:// 寻址一致）；边只收集组件引用（图片/字体引用在索引层）

export interface GraphEdge {
  /** 引用方 pkgId.resId */
  from: string;
  /** 被引用方 pkgId.resId */
  to: string;
  /** 引用边类型 */
  edge: "src" | "url" | "defaultItem";
  /** 引用发生的文件（工程相对路径） */
  file: string;
  /** 发起引用的节点 id */
  nodeId: string;
}

export interface GraphNode {
  /** pkgId.resId */
  id: string;
  file: string;
  package: string;
  name: string;
  exported: boolean;
  /** 入度（被多少组件引用，含多边） */
  inDegree: number;
  /** 出度（引用多少组件，含多边） */
  outDegree: number;
}

export interface ComponentGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Tarjan 强连通分量（尺寸 >1 或自环）成员集合 */
  cycles: string[][];
  /** 被引用最多的组件排行（枢纽，降序） */
  hubs: GraphNode[];
  /** 无人引用的组件（入口组件是正常形态，非错误） */
  unreferenced: GraphNode[];
}

/** Tarjan 强连通分量（迭代式，避免深递归栈溢出） */
function tarjanScc(ids: string[], adj: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;
  for (const start of ids) {
    if (index.has(start)) continue;
    // 迭代版：显式栈帧 {v, 子迭代位置}
    const frames: { v: string; i: number }[] = [{ v: start, i: 0 }];
    while (frames.length) {
      const f = frames[frames.length - 1];
      if (f.i === 0) {
        index.set(f.v, counter);
        low.set(f.v, counter);
        counter++;
        stack.push(f.v);
        onStack.add(f.v);
      }
      const neighbors = adj.get(f.v) ?? [];
      if (f.i < neighbors.length) {
        const w = neighbors[f.i++];
        if (!index.has(w)) {
          frames.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(f.v, Math.min(low.get(f.v)!, index.get(w)!));
        }
      } else {
        frames.pop();
        if (frames.length) {
          const parent = frames[frames.length - 1];
          low.set(parent.v, Math.min(low.get(parent.v)!, low.get(f.v)!));
        }
        if (low.get(f.v) === index.get(f.v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== f.v);
          sccs.push(scc);
        }
      }
    }
  }
  return sccs;
}

export function buildComponentGraph(idx: UiAssetIndexResult): ComponentGraph {
  const nodes = new Map<string, GraphNode>();
  for (const e of idx.entries) {
    const id = `${e.packageId}.${e.resourceId}`;
    nodes.set(id, { id, file: e.file, package: e.package, name: e.name, exported: e.exported, inDegree: 0, outDegree: 0 });
  }
  const edges: GraphEdge[] = [];
  const adj = new Map<string, string[]>();
  for (const e of idx.entries) {
    const from = `${e.packageId}.${e.resourceId}`;
    for (const r of e.refs) {
      if (r.kind !== "component" || !nodes.has(r.to)) continue; // 组件引用且目标在索引内（悬空引用跳过，索引层已如实保留）
      edges.push({ from, to: r.to, edge: r.edge, file: e.file, nodeId: r.nodeId });
      adj.set(from, [...(adj.get(from) ?? []), r.to]);
      nodes.get(from)!.outDegree++;
      nodes.get(r.to)!.inDegree++;
    }
  }
  const sccs = tarjanScc([...nodes.keys()], adj);
  // 环：尺寸 >1 的分量 + 自环（自己引用自己）
  const cycles = sccs.filter((s) => s.length > 1).map((s) => s.slice().sort());
  for (const [id, list] of adj) {
    if (list.includes(id) && !cycles.some((c) => c.includes(id))) cycles.push([id]);
  }
  const all = [...nodes.values()];
  const hubs = all.filter((n) => n.inDegree > 0).sort((a, b) => b.inDegree - a.inDegree).slice(0, 20);
  const unreferenced = all.filter((n) => n.inDegree === 0);
  return { nodes: all, edges, cycles, hubs, unreferenced };
}

/** 单组件邻域（工作台 rel-bar / MCP get_component_graph 用）：引用了 + 被引用 + 环成员 */
export interface NamedEdge extends GraphEdge {
  /** 对方组件名（uses -> 被引用方；usedBy -> 引用方） */
  otherName: string;
  /** 对方组件文件（跳转目标） */
  otherFile: string;
}

export function classNeighborhood(graph: ComponentGraph, id: string): {
  node: GraphNode | null;
  /** 引用了（出边；other = 被引用方） */
  uses: NamedEdge[];
  /** 被引用（入边；other = 引用方） */
  usedBy: NamedEdge[];
  /** 该组件所在图级环（无环为空数组） */
  inCycle: string[];
} {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(id) ?? null;
  const named = (e: GraphEdge, otherId: string): NamedEdge => {
    const o = byId.get(otherId);
    return { ...e, otherName: o?.name ?? otherId, otherFile: o?.file ?? "" };
  };
  return {
    node,
    uses: graph.edges.filter((e) => e.from === id).map((e) => named(e, e.to)),
    usedBy: graph.edges.filter((e) => e.to === id).map((e) => named(e, e.from)),
    inCycle: graph.cycles.find((c) => c.includes(id)) ?? [],
  };
}

/** 按 pkgId.resId 或工程相对路径找节点 id */
export function graphIdOf(graph: ComponentGraph, key: string): string | null {
  if (graph.nodes.some((n) => n.id === key)) return key;
  const byFile = graph.nodes.find((n) => n.file === key);
  return byFile?.id ?? null;
}

export type { UiAssetEntry };
