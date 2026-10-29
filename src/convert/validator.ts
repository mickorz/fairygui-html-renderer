import type { ExtractData } from "./extractor.js";
import type { ParsedComponent } from "../parser/component-parser.js";

// validator（阶段 G）：转换产物回读后与提取 JSON 逐节点对照（±1px 容差）

export interface ValidateRow {
  name: string;
  extract: { x: number; y: number };
  scene: { x: number; y: number };
  dx: number;
  dy: number;
}

export interface ValidateResult {
  ok: boolean;
  maxDx: number;
  maxDy: number;
  matched: number;
  missing: string[];
  rows: ValidateRow[];
}

/** 顶层节点对照：提取节点按 name 在回读场景中查找，比较设计坐标 */
export function validateScene(scene: ParsedComponent, data: ExtractData, tolerance = 1): ValidateResult {
  const rows: ValidateRow[] = [];
  const missing: string[] = [];
  let maxDx = 0;
  let maxDy = 0;
  for (const en of data.nodes) {
    const sn = scene.nodes.find((s) => s.name === en.id);
    if (!sn) {
      missing.push(en.id);
      continue;
    }
    const dx = Math.abs(sn.xy[0] - en.x);
    const dy = Math.abs(sn.xy[1] - en.y);
    maxDx = Math.max(maxDx, dx);
    maxDy = Math.max(maxDy, dy);
    rows.push({ name: en.id, extract: { x: en.x, y: en.y }, scene: { x: sn.xy[0], y: sn.xy[1] }, dx, dy });
  }
  return { ok: missing.length === 0 && maxDx <= tolerance && maxDy <= tolerance, maxDx, maxDy, matched: rows.length, missing, rows };
}
