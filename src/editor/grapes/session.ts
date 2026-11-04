// 编辑器会话客户端（Task 5）：与 /api/editor/* 的交互
// 流程：GET 会话 -> projectData 存在则 loadProjectData 恢复并做一致性对比，
// 否则 importIntoEditor 导入原稿；保存 = exportFromEditor -> PUT（乐观锁）
import type { Editor } from "grapesjs";
import type { GameCanvasConfig } from "../adapter/types.js";
import { importIntoEditor } from "../adapter/import.js";
import { exportFromEditor } from "../adapter/export.js";
import { waitForCanvas } from "./load-html.js";

export interface SessionInfo {
  id: string;
  sourceRevision: string;
  html: string;
  css: string;
  assets: string[];
  canvas: GameCanvasConfig;
  projectData: object | null;
  updatedAt: string;
}

export interface ConsistencyDiff {
  kind: "node-count" | "node-id-set" | "asset-list";
  detail: string;
}

export type LoadResult =
  | { status: "ok"; info: SessionInfo }
  | { status: "inconsistent"; info: SessionInfo; diffs: ConsistencyDiff[] };

export type SaveResult =
  | { status: "saved"; sourceRevision: string }
  | { status: "conflict"; expected: string; actual: string }
  | { status: "export-blocked"; reasons: string[] }
  | { status: "error"; message: string };

/** GET 会话 */
export async function fetchSession(id: string): Promise<SessionInfo | null> {
  const r = await fetch("/api/editor/session/" + encodeURIComponent(id));
  if (!r.ok) return null;
  return (await r.json()) as SessionInfo;
}

/** 解析 DOM 取节点 id 集合（data-fgui-node-id） */
function nodeIdSet(html: string): Set<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return new Set(
    Array.from(doc.body.querySelectorAll("[data-fgui-node-id]")).map((e) => e.getAttribute("data-fgui-node-id")!),
  );
}

/** 为画布 iframe 注入 <base>：相对资源路径（assets/...）命中会话 asset 路由 */
export function injectCanvasBase(editor: Editor, sessionId: string): void {
  const frameEl = (editor.Canvas as unknown as { getFrame?: () => { view?: { el?: HTMLIFrameElement } } }).getFrame?.()?.view?.el;
  const doc = frameEl?.contentDocument;
  if (!doc) return;
  if (doc.querySelector("base")) return;
  const base = doc.createElement("base");
  // 注意指向 asset 路由（.../asset/）：HTML src 与 CSS url() 的相对路径都命中资源流
  base.setAttribute("href", "/api/editor/session/" + encodeURIComponent(sessionId) + "/asset/");
  doc.head.appendChild(base);
}

/** 恢复态与磁盘导出文件一致性对比（节点数 / 节点 id 集合 / 资源清单） */
function consistencyCheck(restoredHtml: string, diskHtml: string, restoredAssets: string[], diskAssets: string[]): ConsistencyDiff[] {
  const diffs: ConsistencyDiff[] = [];
  const a = nodeIdSet(restoredHtml);
  const b = nodeIdSet(diskHtml);
  if (a.size !== b.size) diffs.push({ kind: "node-count", detail: `恢复态 ${a.size} 节点 vs 磁盘 ${b.size} 节点` });
  const missing = [...b].filter((id) => !a.has(id));
  const extra = [...a].filter((id) => !b.has(id));
  if (missing.length || extra.length) {
    diffs.push({ kind: "node-id-set", detail: `缺失 [${missing.join(",")}] 新增 [${extra.join(",")}]` });
  }
  // 资源一致性：恢复态引用的资源必须存在于会话 assets 目录（磁盘允许有未引用文件）
  const missingOnDisk = restoredAssets.filter((a) => !diskAssets.includes(a));
  if (missingOnDisk.length > 0) {
    diffs.push({ kind: "asset-list", detail: `恢复态引用的资源在磁盘缺失：[${missingOnDisk.join(",")}]` });
  }
  return diffs;
}

/** 载入会话到编辑器（projectData 优先，含一致性对比） */
export async function loadSessionIntoEditor(editor: Editor, id: string): Promise<LoadResult | { status: "not-found" }> {
  const info = await fetchSession(id);
  if (!info) return { status: "not-found" };

  // base 先注入：内容加载/样式表创建时相对路径（assets/...、url()）即命中 asset 路由；
  // 注入晚了图片按页面 URL 解析失败，onError 会换占位 SVG 且样式表 base URL 不再更新。
  // loadProjectData 会重建画布文档（实测 sameDoc=false），组件渲染前唯一钩子是
  // canvas:frame:load:head（FrameView.ts:296，head 渲染后 body/组件渲染前）——挂监听保证新文档也先有 base
  editor.on("canvas:frame:load:head", () => injectCanvasBase(editor, id));
  injectCanvasBase(editor, id);

  if (info.projectData) {
    editor.loadProjectData(info.projectData as never);
    await waitForCanvas(editor);
    // loadProjectData 可能重建画布文档：重注入再校验
    injectCanvasBase(editor, id);
    // 恢复后立即重新导出，与磁盘导出文件对比（禁止静默覆盖前的防线）
    const reExport = exportFromEditor(editor, { sourceRevision: info.sourceRevision });
    const diffs = consistencyCheck(reExport.html, info.html, reExport.assets, info.assets);
    if (diffs.length > 0) return { status: "inconsistent", info, diffs };
    return { status: "ok", info };
  }

  // 无 projectData：导入 AI 原稿
  const result = await importIntoEditor(editor, {
    html: info.html,
    css: info.css,
    assets: info.assets,
    canvas: info.canvas,
  });
  injectCanvasBase(editor, id);
  if (!result.imported) return { status: "not-found" };
  return { status: "ok", info };
}

/** 保存：导出（error 诊断阻断） -> PUT（乐观锁） */
export async function saveSession(editor: Editor, id: string, sourceRevision: string): Promise<SaveResult> {
  const output = exportFromEditor(editor, { sourceRevision });
  // error 级诊断阻断保存导出（不允许「看起来成功」）
  const errors = output.diagnostics.filter((d) => d.level === "error");
  if (errors.length > 0) {
    return { status: "export-blocked", reasons: errors.map((d) => d.code + ": " + d.message) };
  }
  const r = await fetch("/api/editor/session/" + encodeURIComponent(id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html: output.html,
      css: output.css,
      projectData: output.projectData,
      assets: output.assets,
      diagnostics: output.diagnostics,
      sourceRevision,
    }),
  });
  if (r.status === 409) {
    const body = (await r.json()) as { error: { detail: { expected: string; actual: string } } };
    return { status: "conflict", expected: body.error.detail.expected, actual: body.error.detail.actual };
  }
  if (!r.ok) return { status: "error", message: "保存失败 HTTP " + r.status };
  const body = (await r.json()) as { sourceRevision: string };
  return { status: "saved", sourceRevision: body.sourceRevision };
}
