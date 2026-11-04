// 导出 Adapter：后处理 + 校验 + 组装 EditorOutput
// 后处理：剥离 <body> 文档壳与 data-gjs-* 辅助属性；校验节点 id 唯一性与资源引用

import type { Editor } from "grapesjs";
import type { EditorOutput, ImportDiagnostic } from "./types.js";
import { hasErrors } from "./types.js";
import { collectIds, NODE_ID_ATTR } from "./node-id.js";
import { scanAssetRefs } from "./normalize.js";

export interface ExportArgs {
  sourceRevision: string;
  nodeIdentityVersion?: number;
}

/** 剥离 data-gjs-* 辅助属性 */
function stripGjsAttrs(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of [doc.body, ...Array.from(doc.body.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-gjs-")) el.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}

export function exportFromEditor(editor: Editor, args: ExportArgs): EditorOutput {
  const diagnostics: ImportDiagnostic[] = [];

  // 1. 取原始导出并剥离辅助属性/文档壳
  const inner = stripGjsAttrs(editor.getHtml());

  // 2. 解析后校验节点 id 唯一性
  const doc = new DOMParser().parseFromString(inner, "text/html");
  const body = doc.body;
  const { duplicates } = collectIds(body);
  for (const id of duplicates) {
    diagnostics.push({ level: "error", code: "DUPLICATE_NODE_ID", target: id, message: "导出中重复节点 id：" + id });
  }
  const idCount = body.querySelectorAll("[" + NODE_ID_ATTR + "]").length + (body.hasAttribute(NODE_ID_ATTR) ? 1 : 0);
  if (idCount === 0) {
    diagnostics.push({ level: "error", code: "NODE_IDS_MISSING", target: "#canvas", message: "导出内容没有任何节点 id" });
  }

  // 3. 资源引用校验 + 清单
  const css = editor.getCss() ?? "";
  const scan = scanAssetRefs(body, css);
  diagnostics.push(...scan.diagnostics);

  return {
    html: inner,
    css,
    projectData: editor.getProjectData(),
    assets: scan.assets,
    sourceRevision: args.sourceRevision,
    nodeIdentityVersion: args.nodeIdentityVersion ?? 1,
    diagnostics,
  };
}

export function exportOk(output: EditorOutput): boolean {
  return !hasErrors(output.diagnostics);
}
