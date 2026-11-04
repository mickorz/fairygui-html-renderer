import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { findChrome } from "../src/mcp/chrome.js";

// Task 1.5 Adapter 基础能力断言（无 UI）：
// 1 导入诊断  2 节点 id 分配/保留/唯一  3 导出后处理（剥离 gjs 属性与文档壳）  4 资源路径规整
// 运行：npm run check:adapter

let pass = 0;
let fail = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    pass++;
    console.log("[通过] " + label);
  } else {
    fail++;
    console.log("[失败] " + label);
  }
}

interface AdapterRunResult {
  imported: boolean;
  importDiagnostics: { level: string; code: string; target?: string }[];
  output: {
    html: string;
    css: string;
    assets: string[];
    diagnostics: { level: string; code: string }[];
    projectDataIsObject: boolean;
  } | null;
}

async function runAdapter(page: import("@playwright/test").Page, html: string, css: string): Promise<AdapterRunResult> {
  return page.evaluate(
    ([h, c]) =>
      (window as unknown as { __adapterRun: (h: string, c: string) => Promise<AdapterRunResult> }).__adapterRun(h, c),
    [html, css] as [string, string],
  );
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

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.goto("http://localhost:5199/");
    await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);

    // ---------- 用例 1：正常样本（sample-final-item 内容） ----------
    const goodHtml = `<div id="canvas"><div class="panel"><img class="item-icon" src="assets/pic.png"><div class="item-name">霜寒之刃</div><div class="confirm-btn">确 认</div></div></div>`;
    const goodCss = `#canvas { position: relative; width: 750px; height: 1334px; } .panel { position: absolute; left: 75px; top: 367px; width: 600px; height: 600px; } .item-icon { position: absolute; left: 40px; top: 40px; width: 120px; height: 120px; }`;
    const r1 = await runAdapter(page, goodHtml, goodCss);
    ok(r1.imported, "用例1 正常样本导入成功");
    ok(r1.importDiagnostics.every((d) => d.level !== "error"), "用例1 导入无 error 诊断");
    const html1 = r1.output?.html ?? "";
    const idMatches = html1.match(/data-fgui-node-id="node_\d{3}"/g) ?? [];
    ok(idMatches.length === 5, "用例1 五个元素（含 #canvas）全部分配节点 id（实际 " + idMatches.length + "）");
    ok(new Set(idMatches).size === 5, "用例1 节点 id 全部唯一");
    ok(!html1.includes("data-gjs-"), "用例1 导出无 data-gjs-* 辅助属性");
    ok(!html1.includes("<body"), "用例1 导出无 body 文档壳");
    ok(JSON.stringify(r1.output?.assets) === JSON.stringify(["assets/pic.png"]), "用例1 资源清单 = assets/pic.png（实际 " + JSON.stringify(r1.output?.assets) + "）");
    ok(r1.output?.projectDataIsObject === true, "用例1 projectData 为对象");
    ok(/src="assets\/pic\.png"/.test(html1), "用例1 图片 src 原样保留");

    // ---------- 用例 2：已有 id 保留，新生成不冲突 ----------
    const keepHtml = `<div id="canvas"><div data-fgui-node-id="node_005" class="a">保留</div><div class="b">新1</div><img src="images/pic.png"><div class="c">新2</div></div>`;
    const r2 = await runAdapter(page, keepHtml, "");
    const html2 = r2.output?.html ?? "";
    ok(r2.imported && html2.includes('data-fgui-node-id="node_005"'), "用例2 已有 node_005 保留");
    const ids2 = html2.match(/node_\d{3}/g) ?? [];
    ok(new Set(ids2).size === ids2.length, "用例2 全部节点 id 唯一（" + ids2.join(",") + "）");
    ok(ids2.filter((i) => i === "node_005").length === 1, "用例2 node_005 恰好出现一次");
    ok((html2.match(/node_006/g) ?? []).length >= 1, "用例2 新分配从 max+1（node_006）起步");

    // ---------- 用例 3：重复节点 id 阻断 ----------
    const dupHtml = `<div id="canvas"><div data-fgui-node-id="node_001">甲</div><div data-fgui-node-id="node_001">乙</div></div>`;
    const r3 = await runAdapter(page, dupHtml, "");
    ok(!r3.imported, "用例3 重复 id 阻断导入");
    ok(r3.importDiagnostics.some((d) => d.code === "DUPLICATE_NODE_ID"), "用例3 诊断含 DUPLICATE_NODE_ID");

    // ---------- 用例 4：资源路径规整与阻断 ----------
    const badHtml = `<div id="canvas"><img src="../out.png"><img src="/abs.png"><img src="https://cdn.example.com/x.png"><img src="./assets/a.png"></div>`;
    const r4 = await runAdapter(page, badHtml, "");
    ok(!r4.imported, "用例4 越界/绝对/外链阻断导入");
    const codes4 = r4.importDiagnostics.map((d) => d.code);
    ok(codes4.includes("PATH_ESCAPE"), "用例4 含 PATH_ESCAPE（../ 与 /abs）");
    ok(codes4.includes("EXTERNAL_ASSET"), "用例4 含 EXTERNAL_ASSET（外链）");

    const dotHtml = `<div id="canvas"><img src="./assets/a.png"></div>`;
    const r4b = await runAdapter(page, dotHtml, "");
    ok(JSON.stringify(r4b.output?.assets) === JSON.stringify(["assets/a.png"]), "用例4b ./assets/a.png 规整为 assets/a.png");

    // ---------- 用例 5：CSS 背景图 warning（不阻断） ----------
    const bgHtml = `<div id="canvas"><div class="banner">横幅</div></div>`;
    const bgCss = `#canvas { position: relative; } .banner { background: url(assets/bg.png); position: absolute; left: 0; top: 0; width: 100px; height: 50px; }`;
    const r5 = await runAdapter(page, bgHtml, bgCss);
    ok(r5.imported, "用例5 背景图 warning 不阻断");
    ok(r5.importDiagnostics.some((d) => d.code === "BG_IMAGE_NO_RESOURCE"), "用例5 诊断含 BG_IMAGE_NO_RESOURCE");

    // ---------- 用例 6：缺 #canvas 阻断 ----------
    const r6 = await runAdapter(page, `<div class="no-canvas">没有画布根</div>`, "");
    ok(!r6.imported, "用例6 缺 #canvas 阻断导入");
    ok(r6.importDiagnostics.some((d) => d.code === "CANVAS_MISSING"), "用例6 诊断含 CANVAS_MISSING");
  } finally {
    await browser.close();
    await vite.close();
  }

  console.log(`Adapter 断言：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
