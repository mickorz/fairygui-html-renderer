import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { loadPackage } from "../parser/package-parser.js";
import { getComponent, buildScene, clearCache } from "../scene/scene-builder.js";
import { toSceneJson } from "../scene/scene-json.js";
import { renderHtml } from "../renderer/html-renderer.js";
import { indexHtml } from "./index-html.js";

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
 */
export function safeResolve(root: string, rel: string): string | null {
  const rootNorm = path.normalize(root);
  const resolved = path.normalize(path.resolve(rootNorm, rel));
  if (resolved === rootNorm || !resolved.startsWith(rootNorm + path.sep)) return null;
  return resolved;
}

function listPackages(root: string): { name: string; id: string; dir: string }[] {
  const assetsDir = path.join(root, "assets");
  const out: { name: string; id: string; dir: string }[] = [];
  for (const ent of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pkgFile = path.join(assetsDir, ent.name, "package.xml");
    if (!fs.existsSync(pkgFile)) continue;
    const pkg = loadPackage(path.join(assetsDir, ent.name));
    out.push({ name: ent.name, id: pkg.id, dir: `assets/${ent.name}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function text(res: http.ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
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

  if (p === "/") return text(res, 200, indexHtml);

  // 工程信息 + 包列表
  if (p === "/api/project") {
    return json(res, 200, { root: path.basename(root), packages: listPackages(root) });
  }

  // 包内组件清单
  const pkgCompMatch = p.match(/^\/api\/packages\/([^/]+)\/components$/);
  if (pkgCompMatch) {
    const pkgName = decodeURIComponent(pkgCompMatch[1]);
    const pkgDir = safeResolve(assetsRoot, pkgName);
    if (!pkgDir || !fs.existsSync(path.join(pkgDir, "package.xml"))) {
      return json(res, 404, { error: `包不存在: ${pkgName}` });
    }
    const pkg = loadPackage(pkgDir);
    const components = pkg.resources
      .filter((r) => r.kind === "component")
      .map((r) => ({
        id: r.id,
        name: r.name,
        exported: r.kind === "component" ? r.exported : false,
        // 组件相对 assets 的路径（scene/view 接口的 component 参数值）
        component: `${pkgName}/${r.name}`,
      }));
    return json(res, 200, { package: pkgName, packageId: pkg.id, components });
  }

  // Scene Tree JSON（AI 与前端共用的核心数据模型）
  if (p === "/api/scene") {
    const comp = u.searchParams.get("component") ?? "";
    const abs = safeResolve(assetsRoot, comp);
    if (!abs || !abs.endsWith(".xml") || !fs.existsSync(abs)) {
      return json(res, 404, { error: `组件不存在或路径越界: ${comp}` });
    }
    const pkg = loadPackage(path.dirname(abs));
    // 每请求重解析（fresh），保证修改 XML 后刷新即生效
    const scene = buildScene(getComponent(abs, { fresh: true }), { pkg });
    return json(res, 200, toSceneJson(scene, pkg, { relativize: (a) => path.relative(root, a).split(path.sep).join("/") }));
  }

  // 渲染视图（完整 HTML，含选择器脚本，供 iframe 消费）
  if (p === "/view") {
    const comp = u.searchParams.get("component") ?? "";
    const abs = safeResolve(assetsRoot, comp);
    if (!abs || !abs.endsWith(".xml") || !fs.existsSync(abs)) {
      return text(res, 404, `组件不存在或路径越界: ${comp}`, "text/plain; charset=utf-8");
    }
    const pkg = loadPackage(path.dirname(abs));
    const scene = buildScene(getComponent(abs, { fresh: true }), { pkg });
    const html = renderHtml(scene, {
      pkg,
      toAssetUrl: (assetAbs) => `/api/assets/${path.relative(assetsRoot, assetAbs).split(path.sep).join("/")}`,
    });
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
