import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { loadPackage } from "../parser/package-parser.js";
import { getComponent, buildScene, clearCache } from "../scene/scene-builder.js";
import { listPackages, searchWorkspace, listComponents } from "../scene/workspace.js";
import { toSceneJson } from "../scene/scene-json.js";
import { buildUiAssetIndex, searchUiAssets, findComponentUsages } from "../scene/ui-asset-index.js";
import { buildComponentGraph, classNeighborhood, graphIdOf } from "../scene/component-graph.js";
import { renderHtml } from "../renderer/html-renderer.js";
import { editorPageHtml } from "../editor/editor-page.js";

// 只读工作区服务（阶段 B）：工程导航 + Scene Tree JSON + 资源与渲染视图
// 安全边界：所有路径参数经统一守卫 safeResolve，解析结果必须仍落在工程根内；全程只读。

export interface AppOptions {
  /** 工程根目录（其下应有 assets/ 包目录） */
  rootDir: string;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ttf": "font/ttf",
  ".fnt": "text/plain; charset=utf-8",
  ".xml": "text/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * 统一路径守卫：rel 先解码再 resolve，结果必须严格落在 root 内（含子目录）。
 * 返回绝对路径；越界返回 null。root 本身也不放行（只允许访问文件）。
 * 符号链接穿透防护（沿袭 egret 项目 safe-path）：真实路径也必须落回 root 内
 * （root 与目标都取 realpath，同步规避盘符大小写差异）；不存在/不可达返回 null。
 */
export function safeResolve(root: string, rel: string): string | null {
  const rootNorm = path.normalize(root);
  const resolved = path.normalize(path.resolve(rootNorm, rel));
  if (resolved === rootNorm || !resolved.startsWith(rootNorm + path.sep)) return null;
  try {
    const realRoot = path.normalize(fs.realpathSync(rootNorm));
    const real = path.normalize(fs.realpathSync(resolved));
    if (real === realRoot || !real.startsWith(realRoot + path.sep)) return null;
  } catch {
    return null; // 不存在或不可达（调用方自行给 404）
  }
  return resolved;
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function text(res: http.ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function findPackageDir(componentFileDir: string, assetsRoot: string): string {
  let dir = path.normalize(componentFileDir);
  const stop = path.normalize(assetsRoot);
  while (dir.startsWith(stop)) {
    if (fs.existsSync(path.join(dir, "package.xml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return componentFileDir;
}

export function createApp(opts: AppOptions): http.Server {
  const root = path.resolve(opts.rootDir);
  const assetsRoot = path.join(root, "assets");

  return http.createServer((req, res) => {
    route(req, res, root, assetsRoot).catch((err) => {
      text(res, 500, `服务内部错误: ${String((err as Error)?.message ?? err)}`, "text/plain; charset=utf-8");
    });
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, root: string, assetsRoot: string): Promise<void> {
  const u = new URL(req.url ?? "/", "http://localhost");
  const p = u.pathname;
  // 场景 B 安全前提：默认只读
  if (req.method !== "GET" && req.method !== "HEAD") {
    return text(res, 405, "只读服务，仅支持 GET", "text/plain; charset=utf-8");
  }

  if (p === "/") return text(res, 200, editorPageHtml());

  // 工程信息 + 包列表
  if (p === "/api/project") {
    return json(res, 200, { root: path.basename(root), packages: listPackages(root) });
  }

  // 全工程搜索（阶段 C）：节点 name / id / 可读路径
  if (p === "/api/search") {
    const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return json(res, 200, { query: q, total: 0, truncated: false, results: [] });
    return json(res, 200, searchWorkspace(root, q));
  }

  // UI 资产索引检索（S2）：q = 文件路径 / 组件名 / 包名 / pkgId.resId
  if (p === "/api/ui-assets") {
    const q = u.searchParams.get("q") ?? "";
    const idx = buildUiAssetIndex(root);
    return json(res, 200, { query: q, entries: searchUiAssets(idx, q), stats: idx.stats, parseFailures: idx.parseFailures });
  }

  // 反向引用查询（S2）：谁引用了这个组件
  if (p === "/api/ui-assets/usage") {
    const id = u.searchParams.get("id") ?? "";
    const file = u.searchParams.get("file") ?? "";
    if (!id && !file) return json(res, 400, { error: "缺少 id 或 file 参数" });
    const idx = buildUiAssetIndex(root);
    return json(res, 200, findComponentUsages(idx, { id: id || undefined, file: file || undefined }));
  }

  // 组件关系图谱（S3）：不传 key 返回全图，传 key 返回单组件邻域
  if (p === "/api/component-graph") {
    const key = u.searchParams.get("key") ?? "";
    const graph = buildComponentGraph(buildUiAssetIndex(root));
    if (!key) return json(res, 200, graph);
    const id = graphIdOf(graph, key);
    if (!id) return json(res, 404, { error: `组件不存在: ${key}` });
    return json(res, 200, classNeighborhood(graph, id));
  }

  // 包内组件清单
  const pkgCompMatch = p.match(/^\/api\/packages\/([^/]+)\/components$/);
  if (pkgCompMatch) {
    const pkgName = decodeURIComponent(pkgCompMatch[1]);
    const pkgDir = safeResolve(assetsRoot, pkgName);
    if (!pkgDir || !fs.existsSync(path.join(pkgDir, "package.xml"))) {
      return json(res, 404, { error: `包不存在: ${pkgName}` });
    }
    // 共用 workspace.listComponents（含包内子目录 path 拼接）
    const listing = listComponents(root, pkgName);
    if (!listing) return json(res, 404, { error: `包不存在: ${pkgName}` });
    return json(res, 200, { package: pkgName, packageId: listing.packageId, components: listing.components });
  }

  // Scene Tree JSON（AI 与前端共用的核心数据模型）
  if (p === "/api/scene") {
    const comp = u.searchParams.get("component") ?? "";
    const abs = safeResolve(assetsRoot, comp);
    if (!abs || !abs.endsWith(".xml") || !fs.existsSync(abs)) {
      return json(res, 404, { error: `组件不存在或路径越界: ${comp}` });
    }
    const pkg = loadPackage(findPackageDir(path.dirname(abs), assetsRoot));
    // 每请求重解析（fresh），保证修改 XML 后刷新即生效
    const scene = buildScene(getComponent(abs, { fresh: true }), { pkg, root });
    return json(res, 200, toSceneJson(scene, pkg, { relativize: (a) => path.relative(root, a).split(path.sep).join("/") }));
  }

  // 渲染视图（完整 HTML，含选择器脚本，供 iframe 消费）
  if (p === "/view") {
    const comp = u.searchParams.get("component") ?? "";
    const abs = safeResolve(assetsRoot, comp);
    if (!abs || !abs.endsWith(".xml") || !fs.existsSync(abs)) {
      return text(res, 404, `组件不存在或路径越界: ${comp}`, "text/plain; charset=utf-8");
    }
    const pkg = loadPackage(findPackageDir(path.dirname(abs), assetsRoot));
    const scene = buildScene(getComponent(abs, { fresh: true }), { pkg, root });
    const html = renderHtml(
      scene,
      {
        pkg,
        toAssetUrl: (assetAbs) => `/api/assets/${path.relative(assetsRoot, assetAbs).split(path.sep).join("/")}`,
      },
      { bare: u.searchParams.get("bare") === "1", editor: u.searchParams.get("docid") !== null },
    );
    return text(res, 200, html);
  }

  // 资源静态服务
  if (p.startsWith("/api/assets/")) {
    const rel = decodeURIComponent(p.slice("/api/assets/".length));
    const abs = safeResolve(assetsRoot, rel);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return text(res, 404, "资源不存在或路径越界", "text/plain; charset=utf-8");
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  return text(res, 404, "未找到", "text/plain; charset=utf-8");
}

// 供测试或显式失效使用（A4 接口在服务态的暴露点）
export { clearCache };
