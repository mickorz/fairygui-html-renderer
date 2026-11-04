import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { findChrome } from "../src/mcp/chrome.js";

// Task 2 固定画布验收：
// 1. 画布 750x1334 背景正确
// 2. 样本元素 offsetLeft/offsetTop 等于设计坐标（#canvas .dialog left:95 top:307）
// 3. 画布 zoom（transform 显示缩放）不改变 offset 设计坐标
// 4. 浏览器窗口 resize 不改变设计坐标
// 运行：npm run check:canvas

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
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(30000);
    await page.goto("http://localhost:5199/");
    await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);

    const html = `<div id="canvas"><div class="mask"></div><div class="dialog"><div class="dialog-title">确认出售</div></div></div>`;
    const css = `#canvas { position: relative; width: 750px; height: 1334px; background: #808080; } .mask { position: absolute; left: 0; top: 0; width: 750px; height: 1334px; } .dialog { position: absolute; left: 95px; top: 307px; width: 560px; height: 720px; border: 2px solid #c9a227; }`;

    const loadAndMeasure = (): Promise<{ canvas: { w: number; h: number; bg: string }; dialog: { l: number; t: number } }> =>
      page.evaluate(
        `(() => {
          const ed = window.__editorInstance;
          const doc = ed.Canvas.getFrame().view.el.contentDocument;
          const canvas = doc.querySelector("#canvas");
          const dialog = doc.querySelector(".dialog");
          const cs = ed.Canvas.getFrame().view.el.contentWindow.getComputedStyle(doc.body);
          return {
            canvas: { w: canvas.offsetWidth, h: canvas.offsetHeight, bg: cs.backgroundColor },
            dialog: { l: dialog.offsetLeft, t: dialog.offsetTop },
          };
        })()`,
      );

    await page.evaluate(async ([h, c]) => {
      await (window as unknown as { __editorLoad: (h: string, c: string) => Promise<boolean> }).__editorLoad(h, c);
    }, [html, css] as [string, string]);
    await page.waitForTimeout(300);

    // 1. 画布尺寸与背景
    const m1 = await loadAndMeasure();
    ok(m1.canvas.w === 750 && m1.canvas.h === 1334, "画布 750x1334（实际 " + m1.canvas.w + "x" + m1.canvas.h + "）");
    ok(m1.canvas.bg === "rgb(128, 128, 128)", "画布背景 #808080（实际 " + m1.canvas.bg + "）");

    // 2. 设计坐标 1:1
    const m2 = await loadAndMeasure();
    ok(m2.dialog.l === 95 && m2.dialog.t === 307, "dialog 设计坐标 offset(95,307)（实际 " + m2.dialog.l + "," + m2.dialog.t + "）");

    // 3. zoom 缩放不影响设计坐标（GrapesJS zoom 为 transform 显示缩放）
    await page.evaluate(() => (window as unknown as { __editorInstance: { Canvas: { setZoom: (n: number) => void } } }).__editorInstance.Canvas.setZoom(50));
    await page.waitForTimeout(200);
    const m3 = await loadAndMeasure();
    ok(m3.dialog.l === 95 && m3.dialog.t === 307, "zoom 50% 后设计坐标不变");

    // 4. 浏览器窗口 resize 不影响设计坐标
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(300);
    const m4 = await loadAndMeasure();
    ok(m4.dialog.l === 95 && m4.dialog.t === 307, "窗口 resize 后设计坐标不变");

    // 5. zoom 恢复 100% 正常
    await page.evaluate(() => (window as unknown as { __editorInstance: { Canvas: { setZoom: (n: number) => void } } }).__editorInstance.Canvas.setZoom(100));
    await page.setViewportSize({ width: 1400, height: 900 });
  } finally {
    await browser.close();
    await vite.close();
  }

  console.log(`Canvas 断言：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
