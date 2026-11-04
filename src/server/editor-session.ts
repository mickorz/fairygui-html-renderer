// 编辑器会话服务（Task 5，执行计划第六节）：
// /api/editor/* 路由：会话创建/读取/保存（乐观锁）/project/export/asset
// 安全边界：id 校验 + safeResolve 限定会话目录内 + 请求体 10MB 上限；写盘走 .tmp+rename 原子替换
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { safeResolve } from "./server.js";
import type { GameCanvasConfig } from "../editor/adapter/types.js";

// 会话目录布局（editor-workspaces/<id>/）：
//   meta.json            { name, canvas, sourceRevision, updatedAt, createdAt }
//   source/index.html    AI 原稿（POST 后只读）
//   source/styles.css    AI 原稿
//   editor/index.html    当前编辑态导出（初始 = 原稿副本）
//   editor/styles.css    当前编辑态导出
//   editor/project.json  { sourceRevision, updatedAt, projectData, assets, diagnostics }
//   assets/**            会话资源（外部放置，P0 无上传路由）
//   output/**            转换产物（Task 6）

export interface EditorApiOptions {
  /** 会话根目录（默认仓库根 editor-workspaces/，FGUI_EDITOR_WORKSPACE 可覆盖） */
  workspaceDir?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BODY_LIMIT = 10 * 1024 * 1024;
const DEFAULT_CANVAS: GameCanvasConfig = { width: 750, height: 1334, backgroundColor: "#808080" };

interface Meta {
  name: string;
  canvas: GameCanvasConfig;
  sourceRevision: string;
  updatedAt: string;
  createdAt: string;
}

interface ProjectFile {
  sourceRevision: string;
  updatedAt: string;
  nodeIdentityVersion: number;
  projectData: object | null;
  assets: string[];
  diagnostics: unknown[];
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function errJson(res: http.ServerResponse, status: number, code: string, message: string, detail?: unknown): void {
  json(res, status, { error: { code, message, ...(detail !== undefined ? { detail } : {}) } });
}

function readBody(req: http.IncomingMessage, limit = BODY_LIMIT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        // 超限：停止缓冲但继续排空（不能 destroy 连接，否则 413 响应发不出去）
        overLimit = true;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (overLimit) reject(new BodyTooLargeError());
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

class BodyTooLargeError extends Error {
  constructor() {
    super("请求体超过上限");
  }
}

/** 原子写盘：.tmp 临时文件 + rename 替换 */
function atomicWrite(file: string, content: string): void {
  const tmp = file + ".tmp";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function sessionDir(workspace: string, id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const dir = path.join(workspace, id);
  if (!fs.existsSync(path.join(dir, "meta.json"))) return null;
  return dir;
}

/** 会话 assets 目录下的相对资源清单（排除目录） */
function listAssets(dir: string): string[] {
  const assetsRoot = path.join(dir, "assets");
  if (!fs.existsSync(assetsRoot)) return [];
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(assetsRoot, rel);
    for (const name of fs.readdirSync(abs)) {
      const childRel = rel ? rel + "/" + name : name;
      const childAbs = path.join(abs, name);
      if (fs.statSync(childAbs).isDirectory()) walk(childRel);
      else out.push("assets/" + childRel);
    }
  };
  walk("");
  return out.sort();
}

interface PutBody {
  html: string;
  css: string;
  projectData: object;
  assets?: string[];
  diagnostics?: unknown[];
  sourceRevision: string;
}

/** 处理 /api/editor/* 请求；非本前缀由调用方继续处理 */
export async function handleEditorApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, opts: EditorApiOptions = {}): Promise<void> {
  const workspace = path.resolve(opts.workspaceDir ?? process.env.FGUI_EDITOR_WORKSPACE ?? "editor-workspaces");

  try {
    // POST /api/editor/session —— 创建会话
    if (req.method === "POST" && pathname === "/api/editor/session") {
      const raw = await readBody(req);
      let body: { name?: string; html?: string; css?: string; assets?: string[]; canvas?: GameCanvasConfig };
      try {
        body = JSON.parse(raw.toString("utf-8"));
      } catch {
        return errJson(res, 400, "BAD_JSON", "请求体不是合法 JSON");
      }
      const name = body.name ?? "";
      if (!ID_RE.test(name)) return errJson(res, 400, "BAD_NAME", "会话名必须匹配 ^[A-Za-z0-9_-]{1,64}$");
      const dir = path.join(workspace, name);
      if (fs.existsSync(path.join(dir, "meta.json"))) return errJson(res, 409, "SESSION_EXISTS", "会话已存在：" + name);
      if (typeof body.html !== "string" || typeof body.css !== "string") {
        return errJson(res, 400, "BAD_BODY", "html/css 必须为字符串");
      }
      const now = new Date().toISOString();
      const canvas = { ...DEFAULT_CANVAS, ...(body.canvas ?? {}) };
      // AI 原稿（此后只读）+ 编辑态初始副本
      atomicWrite(path.join(dir, "source", "index.html"), body.html);
      atomicWrite(path.join(dir, "source", "styles.css"), body.css);
      atomicWrite(path.join(dir, "editor", "index.html"), body.html);
      atomicWrite(path.join(dir, "editor", "styles.css"), body.css);
      const project: ProjectFile = {
        sourceRevision: "r1",
        updatedAt: now,
        nodeIdentityVersion: 1,
        projectData: null, // 浏览器首次导入后由 PUT 回填
        assets: body.assets ?? [],
        diagnostics: [],
      };
      atomicWrite(path.join(dir, "editor", "project.json"), JSON.stringify(project, null, 2));
      const meta: Meta = { name, canvas, sourceRevision: "r1", updatedAt: now, createdAt: now };
      atomicWrite(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
      return json(res, 200, { id: name, dir, sourceRevision: "r1", diagnostics: [] });
    }

    // 其余路由均形如 /api/editor/session/:id/...
    const m = pathname.match(/^\/api\/editor\/session\/([^/]+)(?:\/(.*))?$/);
    if (!m) return errJson(res, 404, "NOT_FOUND", "未知编辑器路由：" + pathname);
    const id = decodeURIComponent(m[1]);
    const rest = m[2] ?? "";
    const dir = sessionDir(workspace, id);
    if (!dir) return errJson(res, 404, "SESSION_NOT_FOUND", "会话不存在：" + id);

    // GET /api/editor/session/:id —— 读取会话（编辑态 + projectData）
    if (req.method === "GET" && rest === "") {
      const meta = JSON.parse(readText(path.join(dir, "meta.json"))!) as Meta;
      const project = JSON.parse(readText(path.join(dir, "editor", "project.json"))!) as ProjectFile;
      return json(res, 200, {
        id,
        sourceRevision: meta.sourceRevision,
        html: readText(path.join(dir, "editor", "index.html")) ?? "",
        css: readText(path.join(dir, "editor", "styles.css")) ?? "",
        assets: listAssets(dir),
        canvas: meta.canvas,
        projectData: project.projectData,
        updatedAt: meta.updatedAt,
      });
    }

    // PUT /api/editor/session/:id —— 保存（乐观锁 sourceRevision）
    if (req.method === "PUT" && rest === "") {
      const raw = await readBody(req);
      let body: PutBody;
      try {
        body = JSON.parse(raw.toString("utf-8"));
      } catch {
        return errJson(res, 400, "BAD_JSON", "请求体不是合法 JSON");
      }
      const meta = JSON.parse(readText(path.join(dir, "meta.json"))!) as Meta;
      if (body.sourceRevision !== meta.sourceRevision) {
        return errJson(res, 409, "REVISION_CONFLICT", "版本冲突，请刷新会话后重试", {
          expected: body.sourceRevision,
          actual: meta.sourceRevision,
        });
      }
      if (typeof body.html !== "string" || typeof body.css !== "string" || typeof body.projectData !== "object" || body.projectData === null) {
        return errJson(res, 400, "BAD_BODY", "html/css/projectData 必填且类型正确");
      }
      const next = "r" + (parseInt(meta.sourceRevision.slice(1), 10) + 1);
      const now = new Date().toISOString();
      atomicWrite(path.join(dir, "editor", "index.html"), body.html);
      atomicWrite(path.join(dir, "editor", "styles.css"), body.css);
      const project: ProjectFile = {
        sourceRevision: next,
        updatedAt: now,
        nodeIdentityVersion: 1,
        projectData: body.projectData,
        assets: body.assets ?? [],
        diagnostics: body.diagnostics ?? [],
      };
      atomicWrite(path.join(dir, "editor", "project.json"), JSON.stringify(project, null, 2));
      atomicWrite(path.join(dir, "meta.json"), JSON.stringify({ ...meta, sourceRevision: next, updatedAt: now }, null, 2));
      return json(res, 200, { sourceRevision: next, updatedAt: now });
    }

    // GET /api/editor/session/:id/project —— project.json 原文
    if (req.method === "GET" && rest === "project") {
      const text = readText(path.join(dir, "editor", "project.json"));
      if (text === null) return errJson(res, 404, "PROJECT_NOT_FOUND", "project.json 不存在");
      return json(res, 200, JSON.parse(text));
    }

    // POST /api/editor/session/:id/export —— 当前保存态导出（html/css/assets/diagnostics）
    // 说明：服务端无 DOM 环境，诊断以 PUT 时浏览器 exportFromEditor 的结果为准（存于 project.json）
    if (req.method === "POST" && rest === "export") {
      await readBody(req); // 请求体允许携带 projectData（校验用，P0 以保存态为准）
      const project = JSON.parse(readText(path.join(dir, "editor", "project.json"))!) as ProjectFile;
      return json(res, 200, {
        html: readText(path.join(dir, "editor", "index.html")) ?? "",
        css: readText(path.join(dir, "editor", "styles.css")) ?? "",
        assets: listAssets(dir),
        diagnostics: project.diagnostics,
      });
    }

    // GET /api/editor/session/:id/asset/* —— 会话资源文件流
    // 安全：拒绝 ../ 跨目录、/ 绝对路径、协议前缀，并经 safeResolve 双重限定在会话目录内
    if (req.method === "GET" && rest.startsWith("asset/")) {
      const rel = decodeURIComponent(rest.slice("asset/".length));
      const rawUnsafe = rel.includes("..") || rel.startsWith("/") || /^[a-z]+:/i.test(rel);
      const abs = rawUnsafe ? null : safeResolve(dir, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return errJson(res, 404, "ASSET_NOT_FOUND", "资源不存在或路径越界：" + rel);
      }
      const mime: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".gif": "image/gif", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
      };
      res.writeHead(200, { "Content-Type": mime[path.extname(abs).toLowerCase()] ?? "application/octet-stream" });
      fs.createReadStream(abs).pipe(res);
      return;
    }

    return errJson(res, 404, "NOT_FOUND", "未知编辑器路由：" + pathname);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return errJson(res, 413, "PAYLOAD_TOO_LARGE", "请求体超过 10MB 上限");
    throw e;
  }
}

/** 是否为编辑器 API 前缀（server.ts route() 分发用） */
export function isEditorApi(pathname: string): boolean {
  return pathname === "/api/editor" || pathname.startsWith("/api/editor/");
}
