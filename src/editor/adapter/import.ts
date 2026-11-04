// 导入 Adapter：校验 + 诊断 + 节点身份 + 加载进 GrapesJS
// 规则：error 级诊断阻断导入（不允许「看起来成功」）；warning 级继续

import type { Editor } from "grapesjs";
import type { GameCanvasConfig, ImportDiagnostic } from "./types.js";
import { hasErrors } from "./types.js";
import { assignNodeIds } from "./node-id.js";
import { scanAssetRefs } from "./normalize.js";
import { waitForCanvas } from "../grapes/load-html.js";

export interface ImportArgs {
  html: string;
  css: string;
  assets: string[];
  canvas: GameCanvasConfig;
}

export interface ImportResult {
  diagnostics: ImportDiagnostic[];
  imported: boolean; // false = 被 error 阻断
}

export async function importIntoEditor(editor: Editor, args: ImportArgs): Promise<ImportResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const doc = new DOMParser().parseFromString(args.html, "text/html");

  // 1. 画布根检查
  const canvasEl = doc.querySelector("#canvas");
  if (!canvasEl) {
    diagnostics.push({ level: "error", code: "CANVAS_MISSING", target: "#canvas", message: "HTML 缺少 #canvas 画布根" });
    return { diagnostics, imported: false };
  }

  // 2. 资源引用检查（HTML src + CSS url()）
  const scan = scanAssetRefs(doc.body, args.css);
  diagnostics.push(...scan.diagnostics);

  // 3. 节点身份：已有保留、缺失分配、重复报错
  const { duplicates } = assignNodeIds(canvasEl);
  for (const id of duplicates) {
    diagnostics.push({ level: "error", code: "DUPLICATE_NODE_ID", target: id, message: "重复节点 id：" + id });
  }

  // 4. error 阻断导入
  if (hasErrors(diagnostics)) return { diagnostics, imported: false };

  // 5. 加载（canvas 元素带新分配的节点 id，取 body 全文加载，与 fidelity 验证路径一致）
  editor.setComponents(doc.body.innerHTML);
  editor.setStyle(args.css);
  await waitForCanvas(editor);
  return { diagnostics, imported: true };
}
