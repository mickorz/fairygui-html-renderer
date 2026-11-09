import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { loadPackage } from "../parser/package-parser.js";
import { getComponent, buildScene, clearCache } from "../scene/scene-builder.js";
import { listPackages, searchWorkspace, listComponents } from "../scene/workspace.js";
import { toSceneJson } from "../scene/scene-json.js";
import { buildUiAssetIndex, searchUiAssets, findComponentUsages } from "../scene/ui-asset-index.js";
import { buildComponentGraph, classNeighborhood, graphIdOf } from "../scene/component-graph.js";
import { diffScenes } from "../scene/scene-diff.js";
import { writeComponentXml } from "../writer/xml-writer.js";
import { renderHtml } from "../renderer/html-renderer.js";
import { editorPageHtml } from "../editor/editor-page.js";
import { multiProjectWorkspace, singleProjectWorkspace, type Workspace } from "./projects.js";

// 只读工作区服务（阶段 B）：工程导航 + Scene Tree JSON + 资源与渲染视图
// 多工程切换（P0-A）：工程是请求上下文不是服务状态——每请求按 ?project= 白名单解析工程根。
// 安全边界：所有路径参数经统一守卫 safeResolve，解析结果必须仍落在所选工程根内；全程只读。

export interface AppOptions {
  /** 多工程模式：工程注册目录（每个含 assets 的子目录是一个工程）。优先于 rootDir */
  projectsDir?: string;
  /** 单工程模式：工程根目录（其下应有 assets/ 包目录）——现状形态，零行为变化 */
  rootDir?: string;
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 16 * 1024 * 1024) {
        reject(new Error("请求体过大（>16MB）"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function text(res: http.ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

export function findPackageDir(componentFileDir: string, assetsRoot: string): string {
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
  const ws: Workspace = opts.projectsDir
    ? multiProjectWorkspace(opts.projectsDir)
    : singleProjectWorkspace(opts.rootDir ?? process.cwd());

  return http.createServer((req, res) => {
    route(req, res, ws).catch((err) => {
      text(res, 500, `服务内部错误: ${String((err as Error)?.message ?? err)}`, "text/plain; charset=utf-8");
    });
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, ws: Workspace): Promise<void> {
  const u = new URL(req.url ?? "/", "http://localhost");
  const p = u.pathname;
  // 场景 B 安全前提：默认只读；POST 仅限 /api/xml-write（接收 HTML 返回 XML 文本，不落盘）
  if (req.method !== "GET" && req.method !== "HEAD" && !(req.method === "POST" && p === "/api/xml-write")) {
    return text(res, 405, "只读服务，仅支持 GET（POST 仅 /api/xml-write，不写文件）", "text/plain; charset=utf-8");
  }

  if (p === "/") return text(res, 200, editorPageHtml());

  // 工程注册清单（P0-A）：无需工程上下文，先于工程解析，供顶栏切换器
  if (p === "/api/projects") {
    return json(res, 200, {
      mode: ws.mode,
      defaultProject: ws.defaultProject,
      projects: ws.projects.map(({ name, packageCount }) => ({ name, packageCount })),
    });
  }

  // 工程解析（P0-A）：白名单 Map 查找；null -> 默认工程；multi 未知名 -> 404（不静默回退）
  const projectName = u.searchParams.get("project");
  const pj = ws.resolve(projectName);
  if (!pj) return json(res, 404, { error: `未知工程: ${projectName}` });
  const root = pj.root;
  const assetsRoot = pj.assetsRoot;

  // 工程信息 + 包列表（响应带工程名标识）
  if (p === "/api/project") {
    return json(res, 200, { root: path.basename(root), project: pj.name, packages: listPackages(root) });
  }

  // 全工程搜索（阶段 C）：节点 name / id / 可读路径
  if (p === "/api/search") {
    const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return json(res, 200, { query: q, total: 0, truncated: false, results: [] });
    return json(res, 200, searchWorkspace(root, q));
  }

  // 语义 HTML -> 组件 XML 写出（S5）：合并写出（属性覆盖 -> 序列化），只返回文本不写文件系统
  if (p === "/api/xml-write" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: { component?: string; html?: string };
    try {
      parsed = JSON.parse(body) as { component?: string; html?: string };
    } catch (e) {
      return json(res, 400, { error: `请求体不是合法 JSON: ${(e as Error).message}` });
    }
    const comp = parsed.component ?? "";
    const html = parsed.html ?? "";
    if (!comp || !html) return json(res, 400, { error: "缺少 component 或 html 参数" });
    const abs = safeResolve(assetsRoot, comp);
    if (!abs || !abs.endsWith(".xml") || !fs.existsSync(abs)) {
      return json(res, 404, { error: `组件不存在或路径越界: ${comp}` });
    }
    const pkg = loadPackage(findPackageDir(path.dirname(abs), assetsRoot));
    const scene = getComponent(abs, { fresh: true });
    const result = writeComponentXml(scene, html);
    return json(res, 200, result);
  }

  // 场景结构 diff（S4）：两份组件的结构差异（新增/删除/移动/属性变化，stableKey 定位）
  if (p === "/api/scene-diff") {
    const a = u.searchParams.get("a") ?? "";
    const b = u.searchParams.get("b") ?? "";
    if (!a || !b) return json(res, 400, { error: "缺少 a 或 b 参数" });
    const absA = safeResolve(assetsRoot, a);
    const absB = safeResolve(assetsRoot, b);
    if (!absA || !absB || !absA.endsWith(".xml") || !absB.endsWith(".xml") || !fs.existsSync(absA) || !fs.existsSync(absB)) {
      return json(res, 404, { error: `组件不存在或路径越界: ${a} / ${b}` });
    }
    const pkgA = loadPackage(findPackageDir(path.dirname(absA), assetsRoot));
    const pkgB = loadPackage(findPackageDir(path.dirname(absB), assetsRoot));
    const sceneA = buildScene(getComponent(absA, { fresh: true }), { pkg: pkgA, root });
    const sceneB = buildScene(getComponent(absB, { fresh: true }), { pkg: pkgB, root });
    return json(res, 200, diffScenes(sceneA, sceneB));
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
        // 资源 URL 必须携带工程上下文（P0-1）：iframe 加载了正确工程，内部图片/字体/动画请求也必须落到同一工程
        toAssetUrl: (assetAbs) =>
          `/api/assets/${path.relative(assetsRoot, assetAbs).split(path.sep).join("/")}?project=${encodeURIComponent(pj.name)}`,
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
