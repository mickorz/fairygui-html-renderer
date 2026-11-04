// Adapter 自测钩子（tests/adapter-check.ts 用；常驻无副作用）
// 验证四件事：导入诊断、节点 id 分配/保留/唯一、导出后处理、资源路径规整

import { getEditor } from "../grapes/editor-instance";
import { importIntoEditor } from "../adapter/import";
import { exportFromEditor } from "../adapter/export";
import type { ImportDiagnostic } from "../adapter/types.js";

export interface AdapterRunResult {
  imported: boolean;
  importDiagnostics: ImportDiagnostic[];
  output: {
    html: string;
    css: string;
    assets: string[];
    diagnostics: ImportDiagnostic[];
    projectDataIsObject: boolean;
  } | null;
}

export function installAdapterHooks(): void {
  (window as unknown as { __adapterRun?: unknown }).__adapterRun = async (
    html: string,
    css: string,
  ): Promise<AdapterRunResult> => {
    const editor = getEditor();
    const imp = await importIntoEditor(editor, {
      html,
      css,
      assets: [],
      canvas: { width: 750, height: 1334 },
    });
    if (!imp.imported) {
      return { imported: false, importDiagnostics: imp.diagnostics, output: null };
    }
    const out = exportFromEditor(editor, { sourceRevision: "r1" });
    return {
      imported: true,
      importDiagnostics: imp.diagnostics,
      output: {
        html: out.html,
        css: out.css,
        assets: out.assets,
        diagnostics: out.diagnostics,
        projectDataIsObject: typeof out.projectData === "object" && out.projectData !== null,
      },
    };
  };
}
