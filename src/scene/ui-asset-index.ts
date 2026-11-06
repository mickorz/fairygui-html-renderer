import path from "node:path";
import { listPackages } from "./workspace.js";
import { loadPackage, type Resource, type FairyPackage } from "../parser/package-parser.js";
import { getComponent } from "./scene-builder.js";
import { buildGlobalIndex, parseUiUrl, type GlobalIndex } from "./global-index.js";
import type { ParsedNode } from "../parser/component-parser.js";

// UI 资产索引（沿袭 egret 项目 P2-A ui-asset-index，适配 FairyGUI 包/资源模型）
// 全工程组件元数据 + 引用关系提取（引用是理解层，不是渲染层）：
//   buildUiAssetIndex(root)
//     └─> 逐包 loadPackage -> 逐组件 getComponent(fresh)
//           └─> 单趟遍历 displayList 原始节点（不含构建期展开子树——那属于被引用组件自身的索引）
//                 ├─> basic     文件身份与规模（包/资源 id/尺寸/节点数/控制器数）
//                 ├─> refs      引用边（src 同包资源 / loader url / list defaultItem，ui:// 跨包解析）
//                 └─> resources 图片资源引用计数
// 解析失败不静默：计入 parseFailures 并给诊断，成功率可统计

export interface UiAssetRef {
  /** 引用目标：pkgId.resId（悬空 ui:// 引用保留原文） */
  to: string;
  /** 引用目标资源类型 */
  kind: "component" | "image" | "movieclip" | "font" | "other";
  /** 引用边类型：src（同包资源 id）/ url（loader ui://）/ defaultItem（list 模板） */
  edge: "src" | "url" | "defaultItem";
  /** 发起引用的节点 id */
  nodeId: string;
}

export interface UiAssetEntry {
  /** 工程根相对路径（/ 分隔，如 Basics/components/Button3.xml） */
  file: string;
  packageId: string;
  /** 包目录名 */
  package: string;
  resourceId: string;
  name: string;
  exported: boolean;
  size: [number, number] | null;
  /** displayList 原始节点数（不含展开子树） */
  nodeCount: number;
  controllerCount: number;
  /** 引用边（组件/图片/动画/字体资源） */
  refs: UiAssetRef[];
  /** 图片资源引用数 */
  imageRefCount: number;
}

export interface UiAssetIndexResult {
  entries: UiAssetEntry[];
  parseFailures: { file: string; error: string }[];
  stats: { entryCount: number; parseFailureCount: number; buildMs: number };
}

function refKind(kind: Resource["kind"], type?: string | undefined): UiAssetRef["kind"] {
  if (kind === "component") return "component";
  if (kind === "image") return "image";
  if (type === "movieclip" || type === "jta") return "movieclip";
  if (type === "font" || type === "bitmapfont") return "font";
  return "other";
}

function collectRefs(nodes: ParsedNode[], pkg: FairyPackage, ctx: { index: GlobalIndex; dirToId: Map<string, string> }): UiAssetRef[] {
  const out: UiAssetRef[] = [];
  const to = (pkgDir: string, r: Resource) => `${ctx.dirToId.get(path.normalize(pkgDir)) ?? "?"}.${r.id}`;
  for (const n of nodes) {
    // src：同包资源 id（image/component/jta 等节点）
    if (n.src) {
      const r = pkg.byId(n.src);
      if (r) out.push({ to: `${pkg.id}.${r.id}`, kind: refKind(r.kind, r.kind === "other" ? (r as { type?: string }).type : undefined), edge: "src", nodeId: n.id });
    }
    // loader url / list defaultItem：ui:// 跨包解析（悬空引用保留原文如实上报）
    for (const attr of ["url", "defaultItem"] as const) {
      const v = n.attrs?.[attr];
      if (typeof v === "string" && v.startsWith("ui://")) {
        const hit = parseUiUrl(v, ctx.index);
        if (hit) out.push({ to: to(hit.pkgDir, hit.resource), kind: refKind(hit.resource.kind, hit.resource.kind === "other" ? (hit.resource as { type?: string }).type : undefined), edge: attr, nodeId: n.id });
        else out.push({ to: v, kind: "other", edge: attr, nodeId: n.id });
      }
    }
  }
  return out;
}

/** 全工程 UI 资产索引（每请求 fresh 构建，不做缓存；21 包规模实测毫秒级） */
export function buildUiAssetIndex(root: string): UiAssetIndexResult {
  const t0 = Date.now();
  const entries: UiAssetEntry[] = [];
  const parseFailures: { file: string; error: string }[] = [];
  const index = buildGlobalIndex(root);
  const dirToId = new Map<string, string>();
  const ctx = { index, dirToId };
  for (const p of listPackages(root)) {
    const pkgDir = path.join(root, "assets", p.name);
    const pkg = loadPackage(pkgDir);
    dirToId.set(path.normalize(pkgDir), pkg.id);
    for (const r of pkg.resources) {
      if (r.kind !== "component") continue;
      const file = `${p.name}${r.path}${r.name}`;
      try {
        const comp = getComponent(r.file, { fresh: true });
        const refs = collectRefs(comp.nodes, pkg, ctx);
        entries.push({
          file,
          packageId: pkg.id,
          package: p.name,
          resourceId: r.id,
          name: r.name,
          exported: r.exported === true,
          size: comp.size ?? null,
          nodeCount: comp.nodes.length,
          controllerCount: comp.controllers.length,
          refs,
          imageRefCount: refs.filter((x) => x.kind === "image").length,
        });
      } catch (e) {
        parseFailures.push({ file, error: String((e as Error)?.message ?? e) });
      }
    }
  }
  return {
    entries,
    parseFailures,
    stats: { entryCount: entries.length, parseFailureCount: parseFailures.length, buildMs: Date.now() - t0 },
  };
}

/** 索引检索（文件路径 / 组件名 / 包名 / pkgId.resId 子串，不区分大小写） */
export function searchUiAssets(idx: UiAssetIndexResult, q: string): UiAssetEntry[] {
  const v = q.trim().toLowerCase();
  if (!v) return idx.entries;
  return idx.entries.filter((e) =>
    (e.file + " " + e.name + " " + e.package + " " + `${e.packageId}.${e.resourceId}`).toLowerCase().includes(v),
  );
}

/** 反向引用查询：谁引用了这个组件（pkgId.resId 或工程相对路径二选一） */
export function findComponentUsages(idx: UiAssetIndexResult, target: { id?: string; file?: string }): { target: UiAssetEntry | null; usedBy: { file: string; packageId: string; resourceId: string; edge: UiAssetRef["edge"]; nodeId: string }[] } {
  const entry = target.id
    ? idx.entries.find((e) => `${e.packageId}.${e.resourceId}` === target.id)
    : target.file
      ? idx.entries.find((e) => e.file === target.file)
      : null;
  if (!entry) return { target: null, usedBy: [] };
  const id = `${entry.packageId}.${entry.resourceId}`;
  const usedBy = idx.entries
    .flatMap((e) => e.refs.filter((r) => r.to === id).map((r) => ({ file: e.file, packageId: e.packageId, resourceId: e.resourceId, edge: r.edge, nodeId: r.nodeId })));
  return { target: entry, usedBy };
}
