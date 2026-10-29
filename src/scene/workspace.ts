import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { loadPackage, type FairyPackage } from "../parser/package-parser.js";
import { buildGlobalIndex, parseUiUrl, type GlobalIndex } from "./global-index.js";
import { getComponent, buildScene } from "./scene-builder.js";
import type { ParsedNode } from "../parser/component-parser.js";

// 工程级操作（阶段 D 抽取）：包枚举 + 组件清单 + 全工程搜索
// HTTP 服务（src/server）与 MCP server（src/mcp）共用，保证行为一致。

export interface PackageInfo {
  name: string;
  id: string;
  dir: string;
}

export function listPackages(root: string): PackageInfo[] {
  const assetsDir = path.join(root, "assets");
  const out: PackageInfo[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(assetsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of dirs) {
    if (!existsSync(path.join(assetsDir, name, "package.xml"))) continue;
    const pkg = loadPackage(path.join(assetsDir, name));
    out.push({ name, id: pkg.id, dir: `assets/${name}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ComponentListing {
  id: string;
  name: string;
  exported: boolean;
  /** 组件相对 assets 的路径（scene/view/render 接口的 component 参数值） */
  component: string;
}

/** 包内组件清单；包不存在返回 null */
export function listComponents(root: string, pkgName: string): { packageId: string; components: ComponentListing[] } | null {
  const pkgDir = path.join(root, "assets", pkgName);
  if (!existsSync(path.join(pkgDir, "package.xml"))) return null;
  const pkg: FairyPackage = loadPackage(pkgDir);
  return {
    packageId: pkg.id,
    components: pkg.resources
      .filter((r) => r.kind === "component")
      .map((r) => ({
        id: r.id,
        name: r.name,
        exported: r.kind === "component" ? r.exported : false,
        component: `${pkgName}/${r.name}`,
      })),
  };
}

export interface SearchHit {
  component: string;
  type: string;
  id: string;
  name: string;
  path: string;
  key: string;
  unsupported?: string;
}

const SEARCH_LIMIT = 50;

/** 递归收集匹配节点：name / id / 可读路径不区分大小写子串匹配 */
function collectMatches(nodes: ParsedNode[], q: string, component: string, out: SearchHit[]): void {
  for (const n of nodes) {
    if (out.length >= SEARCH_LIMIT) return;
    const hit =
      n.name.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      (n.instancePath ?? "").toLowerCase().includes(q);
    if (hit) {
      out.push({
        component,
        type: n.type,
        id: n.id,
        name: n.name,
        path: n.instancePath ?? "",
        key: n.stableKey ?? "",
        unsupported: n.unsupported,
      });
    }
    if (n.childComp) collectMatches(n.childComp.comp.nodes, q, component, out);
  }
}

/** 全工程实时搜索（每次请求扫描全部包组件；本地工程量级下毫秒级，变慢再引入缓存） */
export function searchWorkspace(root: string, q: string): { query: string; total: number; truncated: boolean; results: SearchHit[] } {
  const results: SearchHit[] = [];
  for (const pkgs of listPackages(root)) {
    if (results.length >= SEARCH_LIMIT) break;
    const pkg = loadPackage(path.join(root, pkgs.dir));
    for (const r of pkg.resources) {
      if (results.length >= SEARCH_LIMIT) break;
      if (r.kind !== "component") continue;
      const component = `${pkgs.name}/${r.name}`;
      // fresh：搜索应反映磁盘最新内容
      const scene = buildScene(getComponent(r.file, { fresh: true }), { pkg, root });
      collectMatches(scene.nodes, q, component, results);
    }
  }
  return { query: q, total: results.length, truncated: results.length >= SEARCH_LIMIT, results };
}

export { buildGlobalIndex, parseUiUrl };
export type { GlobalIndex };
