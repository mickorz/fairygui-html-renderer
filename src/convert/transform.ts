import fs from "node:fs";
import path from "node:path";
import { extractFromHtml } from "./extractor.js";
import { mapExtract } from "./style-mapper.js";
import { writePackage } from "./fairy-writer.js";
import { validateScene } from "./validator.js";
import { loadPackage } from "../parser/package-parser.js";
import { getComponent, buildScene } from "../scene/scene-builder.js";

// 转换流水线（阶段 G）：extract -> map -> write -> validate
// 输入样本 HTML，输出目标工程隔离新包 + 转换报告

export interface PipelineOptions {
  /** 样本 HTML（须含 #canvas 画布根） */
  htmlFile: string;
  /** 输出包目录（目标工程 assets/ 下；已存在时需 force） */
  outPkgDir: string;
  pkgName?: string;
  rootComponentName?: string;
  width?: number;
  height?: number;
  /** 删除已存在的输出目录后重建 */
  force?: boolean;
}

export interface PipelineResult {
  report: ReturnType<typeof mapExtract>["report"];
  validation: ReturnType<typeof validateScene>;
  files: string[];
  pkgId: string;
}

export function runPipeline(opts: PipelineOptions): PipelineResult {
  const htmlFile = path.resolve(opts.htmlFile);
  const outPkgDir = path.resolve(opts.outPkgDir);
  if (opts.force && fs.existsSync(outPkgDir)) fs.rmSync(outPkgDir, { recursive: true, force: true });

  // 1. extract：浏览器渲染后提取（Flex/Grid 自动为最终位置）
  const data = extractFromHtml(htmlFile, { width: opts.width ?? 800, height: opts.height ?? 600 });
  // 2. map：DOM -> FGNode 树
  const { nodes, report } = mapExtract(data);
  // 3. write：确定性 id 写入隔离新包
  const written = writePackage(outPkgDir, opts.pkgName ?? path.basename(outPkgDir), {
    rootNodes: nodes,
    canvas: data.canvas,
    htmlDir: path.dirname(htmlFile),
    rootComponentName: opts.rootComponentName,
  });
  // 4. validate：回读对照
  const pkg = loadPackage(outPkgDir);
  const scene = buildScene(getComponent(path.join(outPkgDir, opts.rootComponentName ?? "Root.xml"), { fresh: true }), { pkg });
  const validation = validateScene(scene, data);

  return { report, validation, files: written.files, pkgId: written.pkgId };
}

// CLI：npx tsx src/convert/transform.ts <sample.html> <outPkgDir> [--force]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace(/^file:\/\/\//, "").replace(/\//g, path.sep))) {
  const [, , htmlArg, outArg, forceArg] = process.argv;
  if (!htmlArg || !outArg) {
    console.error("用法: npx tsx src/convert/transform.ts <sample.html> <outPkgDir> [--force]");
    process.exit(1);
  }
  try {
    const r = runPipeline({ htmlFile: htmlArg, outPkgDir: outArg, force: forceArg === "--force" });
    console.log(`包 ${r.pkgId} 已生成: ${r.files.join(", ")}`);
    console.log(`转换报告: 总节点 ${r.report.total}, byKind=${JSON.stringify(r.report.byKind)}, 跳过 ${r.report.skipped.length}`);
    console.log(`回读对照: ${r.validation.matched} 节点匹配, 最大偏差 dx=${r.validation.maxDx} dy=${r.validation.maxDy}`);
    if (r.report.skipped.length) console.log(`跳过: ${r.report.skipped.map((s) => `${s.id}(${s.reason})`).join("; ")}`);
  } catch (err) {
    console.error(`转换失败: ${(err as Error).message}`);
    process.exit(1);
  }
}
