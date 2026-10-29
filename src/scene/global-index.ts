import path from "node:path";
import { listPackages } from "./workspace.js";
import { loadPackage, type Resource } from "../parser/package-parser.js";

// 工程级资源索引（阶段 E4）：ui://<pkgId><resId> 全局寻址
// 独立模块以避免 workspace <-> scene-builder 循环依赖

// ===== ui:// 跨包引用（阶段 E4） =====

export interface GlobalIndex {
  /** 所有包 id（ui:// URL 无分隔符，靠前缀消歧） */
  pkgIds: string[];
  /** pkgId+resId -> 资源及其所在包目录 */
  resolve: (pkgId: string, resId: string) => { pkgDir: string; resource: Resource } | null;
}

/** 构建工程级资源索引（跨包 ui:// 引用与 list defaultItem 解析用） */
export function buildGlobalIndex(root: string): GlobalIndex {
  const pkgIds: string[] = [];
  const map = new Map<string, { pkgDir: string; resource: Resource }>();
  for (const p of listPackages(root)) {
    const pkgDir = path.join(root, p.dir);
    const pkg = loadPackage(pkgDir);
    pkgIds.push(pkg.id);
    for (const r of pkg.resources) map.set(`${pkg.id}:${r.id}`, { pkgDir, resource: r });
  }
  // 最长前缀优先，避免包 id 互为前缀时误匹配
  pkgIds.sort((a, b) => b.length - a.length);
  return { pkgIds, resolve: (pid, rid) => map.get(`${pid}:${rid}`) ?? null };
}

/** 解析 ui://<pkgId><resId> URL（pkgId 前缀消歧）；无法解析返回 null */
export function parseUiUrl(url: string, index: GlobalIndex): { pkgDir: string; resource: Resource } | null {
  if (!url.startsWith("ui://")) return null;
  const rest = url.slice(5);
  for (const pid of index.pkgIds) {
    if (rest.startsWith(pid)) {
      const hit = index.resolve(pid, rest.slice(pid.length));
      if (hit) return hit;
    }
  }
  return null;
}
