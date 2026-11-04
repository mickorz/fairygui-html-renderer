import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { findChrome } from "../src/mcp/chrome.js";
import type { FidelityDiff, GeoItem } from "../src/editor/dev/fidelity-hooks.js";

// Task 1 保真度门禁：导入 → 零操作 → 导出 → 回读对比
// 机器判定：semantic/geometry/asset 全零放行，css-format 仅记录（评审二轮分级）
// 运行：npm run check:grapes；报告落盘 editor-workspaces/fidelity/<sample>-noop-report.json

interface SampleDef {
  name: string;
  dir: string;
  file?: string; // 默认 index.html
}

const SAMPLES: SampleDef[] = [
  { name: "sample-a-popup", dir: "tests/fixtures/editor/sample-a-popup" },
  { name: "sample-final-item", dir: "tests/fixtures/editor/sample-final-item" },
  { name: "convert-hello", dir: "tests/fixtures/convert", file: "hello.html" },
  { name: "convert-nested", dir: "tests/fixtures/convert", file: "nested.html" },
  { name: "convert-flexgrid", dir: "tests/fixtures/convert", file: "flex-grid.html" },
];

const MIMES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

interface PreparedSample {
  name: string;
  bodyHtml: string;
  css: string;
  cssRaw: string;
  assetMap: Record<string, string>;
}

/** 读样本：提取 body 内容 + 内联 style + styles.css + 资源引用 -> data URL 映射 */
function prepareSample(s: SampleDef): PreparedSample {
  const htmlPath = path.join(s.dir, s.file ?? "index.html");
  const raw = fs.readFileSync(htmlPath, "utf8");
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error(`${htmlPath} 缺少 <body>`);
  const cssParts: string[] = [];
  for (const m of raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) cssParts.push(m[1]);
  const cssFile = path.join(s.dir, "styles.css");
  if (fs.existsSync(cssFile)) cssParts.push(fs.readFileSync(cssFile, "utf8"));

  // 收集会话相对资源引用（assets/ 或 images/ 开头）
  const refs = new Set<string>();
  const scan = (text: string) => {
    for (const m of text.matchAll(/(?:src="|href="|url\()["']?([^"')\s]+)/g)) {
      if (/^(assets|images)\//.test(m[1])) refs.add(m[1]);
    }
  };
  scan(raw);
  scan(cssParts.join("\n"));
  const assetMap: Record<string, string> = {};
  for (const ref of refs) {
    const file = path.join(s.dir, ref);
    if (!fs.existsSync(file)) continue; // 缺失资源留原样，由结构对比暴露
    const ext = path.extname(file).toLowerCase();
    const mime = MIMES[ext];
    if (!mime) continue;
    assetMap[ref] = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  }
  const css = cssParts.join("\n");
  return { name: s.name, bodyHtml: bodyMatch[1], css, cssRaw: css, assetMap };
}

/** 几何快照对比（Node 侧纯数据 diff） */
function diffGeometry(before: GeoItem[], after: GeoItem[]): FidelityDiff[] {
  const diffs: FidelityDiff[] = [];
  const map = new Map(before.map((i) => [i.path, i]));
  const seen = new Set<string>();
  for (const b of after) {
    const a = map.get(b.path);
    if (!a) {
      diffs.push({ kind: "semantic", severity: "blocker", selector: b.path, property: "node", before: "缺失", after: "多出" });
      continue;
    }
    seen.add(b.path);
    for (const k of ["x", "y", "w", "h"] as const) {
      if (Math.abs(a[k] - b[k]) > 1) {
        diffs.push({ kind: "geometry", severity: "blocker", selector: b.path, property: k, before: String(a[k]), after: String(b[k]) });
      }
    }
    for (const k of ["display", "position", "opacity", "bg", "color", "fontSize", "fontWeight", "textAlign", "lineHeight", "radius", "border", "transform", "text"] as const) {
      if (a[k] !== b[k]) {
        diffs.push({ kind: "semantic", severity: "blocker", selector: b.path, property: k, before: a[k], after: b[k] });
      }
    }
  }
  for (const a of before) {
    if (!seen.has(a.path)) {
      diffs.push({ kind: "semantic", severity: "blocker", selector: a.path, property: "node", before: "存在", after: "缺失" });
    }
  }
  return diffs;
}

async function main(): Promise<void> {
  const vite: ViteDevServer = await createViteServer({
    root: path.resolve("src/editor"),
    configFile: path.resolve("src/editor/vite.config.ts"),
    server: { port: 5199, strictPort: true },
    logLevel: "error",
  });
  await vite.listen();

  const chromePath = findChrome();
  if (!chromePath) throw new Error("未找到 Chrome（findChrome）");
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });

  const outDir = path.resolve("editor-workspaces/fidelity");
  fs.mkdirSync(outDir, { recursive: true });

  let allPass = true;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.goto("http://localhost:5199/");
    await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);

    for (const def of SAMPLES) {
      const s = prepareSample(def);
      const diffs: FidelityDiff[] = [];
      let totalNodes = 0;

      try {
        // 1. 载入
        await page.evaluate(async ([bodyHtml, css]) => {
          await (window as unknown as { __editorLoad: (h: string, c: string) => Promise<boolean> }).__editorLoad(bodyHtml, css);
        }, [s.bodyHtml, s.css]);

        // 2. 零操作导出
        const exported = await page.evaluate(() =>
          (window as unknown as { __editorExport: () => { html: string; css: string } }).__editorExport(),
        );

        // 3. 结构对比（原始 vs 导出）
        const structDiffs = await page.evaluate(([a, b]) =>
          (window as unknown as { __structureDiff: (o: string, e: string) => FidelityDiff[] }).__structureDiff(a, b),
        [s.bodyHtml, exported.html]);
        diffs.push(...structDiffs);

        // 4. 几何对比（原始渲染 vs 导出渲染，干净 iframe 各取快照）
        const geoBefore = await page.evaluate(
          ([h, c, m]: [string, string, Record<string, string>]) =>
            (window as unknown as { __geometrySnapshot: (h: string, c: string, m: Record<string, string>) => Promise<GeoItem[]> }).__geometrySnapshot(h, c, m),
          [s.bodyHtml, s.css, s.assetMap] as [string, string, Record<string, string>],
        );
        const geoAfter = await page.evaluate(
          ([h, c, m]: [string, string, Record<string, string>]) =>
            (window as unknown as { __geometrySnapshot: (h: string, c: string, m: Record<string, string>) => Promise<GeoItem[]> }).__geometrySnapshot(h, c, m),
          [exported.html, exported.css, s.assetMap] as [string, string, Record<string, string>],
        );
        totalNodes = geoBefore.length;
        diffs.push(...diffGeometry(geoBefore, geoAfter));

        // 5. CSS 规则级对比（css-format 来源）
        const cssDiffs = await page.evaluate(([a, b]) =>
          (window as unknown as { __cssDiff: (o: string, e: string) => FidelityDiff[] }).__cssDiff(a, b),
        [s.css, exported.css]);
        diffs.push(...cssDiffs);
      } catch (err) {
        diffs.push({
          kind: "semantic",
          severity: "blocker",
          selector: "<pipeline>",
          property: "error",
          before: "-",
          after: err instanceof Error ? err.message : String(err),
        });
      }

      const count = (kind: FidelityDiff["kind"]) => diffs.filter((d) => d.kind === kind).length;
      const semantic = count("semantic");
      const geometry = count("geometry");
      const asset = count("asset");
      const cssFormat = count("css-format");
      const pass = semantic === 0 && geometry === 0 && asset === 0;
      if (!pass) allPass = false;

      const report = {
        sample: s.name,
        summary: { totalNodes, semanticDiffs: semantic, geometryDiffs: geometry, assetDiffs: asset, cssFormatDiffs: cssFormat },
        pass,
        differences: diffs,
      };
      const outFile = path.join(outDir, `${s.name}-noop-report.json`);
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
      console.log(
        `${pass ? "[通过]" : "[未过]"} ${s.name}: 节点 ${totalNodes} | semantic ${semantic} / geometry ${geometry} / asset ${asset} / css-format ${cssFormat} -> ${path.basename(outFile)}`,
      );
    }
  } finally {
    await browser.close();
    await vite.close();
  }

  if (!allPass) {
    console.log("门禁未通过：存在 semantic/geometry/asset 差异，按 Task 1 门禁流程定位 GrapesJS 源码后上报");
    process.exitCode = 1;
  } else {
    console.log("保真度门禁通过（semantic/geometry/asset 全零）");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
