import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadPackage } from "../parser/package-parser.js";
import { getComponent, buildScene } from "../scene/scene-builder.js";
import { renderHtml } from "../renderer/html-renderer.js";

// POC 渲染入口：npx tsx src/poc/render.ts <组件.xml> [输出目录]

const [, , xmlArg, outArg = "demo"] = process.argv;
if (!xmlArg) {
  console.error("用法: npm run render -- <组件.xml路径> [输出目录，默认 demo]");
  process.exit(1);
}

const xmlFile = path.resolve(xmlArg);
// 原版格式：组件 XML 与 package.xml 同目录
const pkg = loadPackage(path.dirname(xmlFile));
const comp = getComponent(xmlFile);
// 每次构建生成全新场景树（缓存内原始解析结果不可变，A2）
const scene = buildScene(comp, {
  pkg,
  onCycle: (f, stack) => console.error(`[警告] 检测到循环引用: ${f} <- ${stack.join(" <- ")}`),
});

const outDir = path.resolve(outArg);
const html = renderHtml(scene, {
  pkg,
  toAssetUrl: (abs) => path.relative(outDir, abs).split(path.sep).join("/"),
});

mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, path.basename(xmlFile, ".xml") + ".html");
writeFileSync(outFile, html, "utf8");
console.log(`已生成: ${outFile}`);
