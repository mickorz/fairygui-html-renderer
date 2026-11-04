// 资源路径规整与检查（执行计划第六节「资源路径约定」）：
// - 会话内资源统一会话相对路径（assets/...），./ 前缀规整化
// - ../ 跨目录、/ 绝对路径、http(s) 外链 → error（阻断保存导出）
// - CSS url()（背景图类）→ warning（现有 Converter 不产出该资源）

import type { ImportDiagnostic } from "./types.js";

export interface AssetRefCheck {
  raw: string;
  normalized: string | null; // null = 不合法，不参与资源清单
  level: "error" | "warning" | null;
  code?: string;
}

export function checkAssetRef(raw: string): AssetRefCheck {
  const ref = raw.trim().replace(/^['"]|["']$/g, "");
  if (!ref) return { raw, normalized: null, level: null };
  if (/^data:/i.test(ref)) return { raw, normalized: null, level: null }; // 内联资源，不入会话清单
  if (/^(https?:)?\/\//i.test(ref)) {
    return { raw, normalized: null, level: "error", code: "EXTERNAL_ASSET" };
  }
  if (ref.startsWith("/") || ref.includes("..")) {
    return { raw, normalized: null, level: "error", code: "PATH_ESCAPE" };
  }
  return { raw, normalized: ref.replace(/^\.\//, ""), level: null };
}

export interface ScanResult {
  checks: AssetRefCheck[];
  diagnostics: ImportDiagnostic[];
  assets: string[]; // 合法资源的规整清单（去重，文档顺序）
}

/** 扫描 DOM 中的 src/href 资源引用 + CSS url() */
export function scanAssetRefs(root: Element, css: string): ScanResult {
  const checks: AssetRefCheck[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  const assets: string[] = [];
  const seen = new Set<string>();

  const push = (check: AssetRefCheck, source: string) => {
    checks.push(check);
    if (check.level === "error") {
      diagnostics.push({
        level: "error",
        code: check.code!,
        target: check.raw,
        message: source + " 引用不合法：" + check.raw,
      });
    } else if (check.level === "warning") {
      diagnostics.push({
        level: "warning",
        code: check.code!,
        target: check.raw,
        message: source + " 引用需注意：" + check.raw,
      });
    } else if (check.normalized && !seen.has(check.normalized)) {
      seen.add(check.normalized);
      assets.push(check.normalized);
    }
  };

  // HTML 的 src 属性（img/source/video/script 等）
  for (const el of [root, ...Array.from(root.querySelectorAll("[src]"))]) {
    const src = el.getAttribute("src");
    if (src) push(checkAssetRef(src), el.tagName.toLowerCase() + "[src]");
  }

  // CSS url()：P0 约定样本图片一律 <img src>；背景图 url() 不产出资源，记 warning
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const check = checkAssetRef(m[1]);
    check.level = check.level ?? "warning";
    check.code = check.code ?? "BG_IMAGE_NO_RESOURCE";
    push(check, "css url()");
  }

  return { checks, diagnostics, assets };
}
