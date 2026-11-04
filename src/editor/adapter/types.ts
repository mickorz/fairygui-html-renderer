// 编辑器 Adapter 数据结构（执行计划第五节）

export interface GameCanvasConfig {
  width: number; // 默认 750
  height: number; // 默认 1334
  backgroundColor?: string; // 默认 #808080
  zoom?: number; // 显示缩放，不影响导出坐标
}

export interface ImportDiagnostic {
  level: "error" | "warning" | "info";
  code: string; // 如 CANVAS_MISSING、DUPLICATE_NODE_ID、PATH_ESCAPE、EXTERNAL_ASSET、BG_IMAGE_NO_RESOURCE
  target?: string; // 节点 id / 选择器 / 资源引用
  message: string;
}

export interface EditorInput {
  html: string; // AI 生成 HTML（body 片段或整文档均可）
  css: string;
  assets: string[]; // 相对会话目录路径，如 "assets/icon.png"
  canvas: GameCanvasConfig;
  sourceRevision: string; // 服务端会话版本号，形如 "r1"
}

export interface EditorOutput {
  html: string; // 后处理后的 body 内容（不含文档壳）
  css: string;
  projectData: object; // editor.getProject() 原样
  assets: string[]; // 导出内容中实际引用的资源清单（会话相对路径）
  sourceRevision: string;
  nodeIdentityVersion: number; // P0 固定 1
  diagnostics: ImportDiagnostic[];
}

export function hasErrors(diagnostics: ImportDiagnostic[]): boolean {
  return diagnostics.some((d) => d.level === "error");
}
