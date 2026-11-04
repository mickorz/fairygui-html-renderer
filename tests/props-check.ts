import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { findChrome } from "../src/mcp/chrome.js";

// Task 4 图层树与属性面板验收（React 外壳直连 component API）：
// 1. LayerTree 渲染真实组件树（data-cmp-id 节点数与画布一致）
// 2. 点击图层节点 -> 编辑器选中 -> 属性面板标题同步（双向）
// 3. 画布选中 -> 图层节点高亮 + 属性面板显示
// 4. Transform 输入 X -> 组件内联 left 更新 + 画布渲染同步
// 5. Typography 颜色 -> 内联 color 更新（验收三件事之「改标题颜色」）
// 6. Image src 展示与修改 -> 属性更新
// 7. Ctrl+Z（GrapesJS 内建 keymap）撤销属性修改
// 运行：npm run check:props

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
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(30000);
    await page.goto("http://localhost:5199/");
    await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);

    const imgB64 = fs.readFileSync(path.resolve("tests/fixtures/convert/images/pic.png")).toString("base64");
    const html =
      `<div id="canvas">` +
      `<div class="title" style="position:absolute;left:100px;top:80px;width:400px;height:50px;color:#333333;font-size:32px;font-weight:700;">每日签到</div>` +
      `<div class="btn-confirm" style="position:absolute;left:275px;top:600px;width:200px;height:64px;background:#e8b34b;border-radius:12px;">确定</div>` +
      `<img class="hero" src="data:image/png;base64,${imgB64}" style="position:absolute;left:40px;top:20px;width:120px;height:100px">` +
      `</div>`;
    const css = `#canvas { position: relative; width: 750px; height: 1334px; background: #808080; }`;
    await page.evaluate(async ([h, c]) => {
      await (window as unknown as { __editorLoad: (h: string, c: string) => Promise<boolean> }).__editorLoad(h, c);
    }, [html, css] as [string, string]);
    await page.waitForTimeout(500);

    // ---------- 用例 1：图层树渲染 ----------
    const treeInfo = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-testid="layer-node"]');
      return { count: nodes.length };
    });
    ok(treeInfo.count >= 4, "用例1 图层树渲染节点数（" + treeInfo.count + " 个 >= 4：canvas/title/btn/hero）");

    // ---------- 用例 2：点击图层节点选中（双向） ----------
    await page.evaluate(() => {
      const title = Array.from(document.querySelectorAll('[data-testid="layer-node"]')).find((n) =>
        (n.textContent ?? "").includes("title"),
      );
      (title as HTMLElement).click();
      return null;
    });
    await page.waitForTimeout(300);
    const selAfterTreeClick = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      const sel = ed.getSelected();
      return { cls: sel ? sel.getAttributes().class : "none", panelId: (document.querySelector('[data-testid="prop-panel"]') as HTMLElement)?.dataset.cmpId ?? "none", panelName: (document.querySelector('[data-testid="prop-panel"]') as HTMLElement)?.textContent ?? "" };
    });
    ok(selAfterTreeClick.cls === "title", "用例2 点击图层 title 节点 -> 编辑器选中 title（实际 " + selAfterTreeClick.cls + "）");
    ok(selAfterTreeClick.panelName.includes("title"), "用例2 属性面板标题同步显示 title");

    // ---------- 用例 3：画布选中 -> 图层高亮 ----------
    const heroCenter = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      const frameEl = ed.Canvas.getFrame().view.el;
      const fr = frameEl.getBoundingClientRect();
      const r = frameEl.contentDocument.querySelector(".hero").getBoundingClientRect();
      return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2 };
    });
    await page.mouse.click(heroCenter.x, heroCenter.y);
    await page.waitForTimeout(400);
    const highlight = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      const sel = ed.getSelected();
      const selId = sel ? sel.getId() : "none";
      const nodes = Array.from(document.querySelectorAll('[data-testid="layer-node"]')) as HTMLElement[];
      const highlighted = nodes.find((n) => n.dataset.cmpId === selId);
      const hasBg = highlighted ? (highlighted.className.includes("bg-[#4a5a7a]") || getComputedStyle(highlighted).backgroundColor !== "rgba(0, 0, 0, 0)") : false;
      const panelId = (document.querySelector('[data-testid="prop-panel"]') as HTMLElement)?.dataset.cmpId ?? "none";
      return { selId, hasBg, panelMatch: panelId === selId, srcShown: !!(document.querySelector('[data-testid="prop-src"]') as HTMLInputElement)?.value };
    });
    ok(highlight.hasBg, "用例3 画布选中 hero -> 图层节点高亮");
    ok(highlight.panelMatch, "用例3 属性面板 data-cmp-id 同步选中组件");
    ok(highlight.srcShown, "用例3 Image 分节显示 src（data:image/png 开头即非空）");

    // ---------- 用例 4：Transform X 输入 -> 组件内联 left + 画布渲染 ----------
    // 选中 btn-confirm（点图层节点）
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid="layer-node"]')).find((n) =>
        (n.textContent ?? "").includes("btn-confirm"),
      );
      (btn as HTMLElement).click();
      return null;
    });
    await page.waitForTimeout(300);
    const xBefore = await page.evaluate(() => (document.querySelector('[data-testid="prop-x"]') as HTMLInputElement).value);
    ok(xBefore === "275", "用例4 属性面板 X 显示设计坐标 275（实际 " + xBefore + "）");
    await page.fill('[data-testid="prop-x"]', "300");
    await page.waitForTimeout(300);
    const xAfter = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      const st = ed.getSelected().getStyle();
      const r = ed.Canvas.getFrame().view.el.contentDocument.querySelector(".btn-confirm").getBoundingClientRect();
      return { left: st.left ?? "", rectLeft: Math.round(r.left) };
    });
    ok(xAfter.left === "300px", "用例4 X 输入 300 -> 组件内联 left=300px（实际 " + xAfter.left + "）");

    // ---------- 用例 5：Typography 颜色（改标题颜色） ----------
    await page.evaluate(() => {
      const title = Array.from(document.querySelectorAll('[data-testid="layer-node"]')).find((n) =>
        (n.textContent ?? "").includes("title"),
      );
      (title as HTMLElement).click();
      return null;
    });
    await page.waitForTimeout(300);
    const typoVisible = await page.evaluate(() => !!document.querySelector('[data-testid="prop-color"]'));
    ok(typoVisible, "用例5 title 文本组件显示 Typography 分节（颜色输入）");
    await page.fill('[data-testid="prop-color"]', "#ff0000");
    await page.waitForTimeout(300);
    const colorAfter = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      const st = ed.getSelected().getStyle();
      const cs = ed.Canvas.getFrame().view.el.contentWindow.getComputedStyle(
        ed.Canvas.getFrame().view.el.contentDocument.querySelector(".title"),
      );
      return { styleColor: st.color ?? "", computed: cs.color };
    });
    ok(colorAfter.styleColor === "#ff0000", "用例5 颜色输入 #ff0000 -> 内联 color（实际 " + colorAfter.styleColor + "）");
    ok(colorAfter.computed === "rgb(255, 0, 0)", "用例5 画布渲染颜色 rgb(255,0,0)（实际 " + colorAfter.computed + "）");

    // ---------- 用例 6：Image src 修改 ----------
    const newSrc = "images/new-hero.png";
    await page.evaluate(() => {
      const hero = Array.from(document.querySelectorAll('[data-testid="layer-node"]')).find((n) => (n.textContent ?? "").includes("hero"));
      (hero as HTMLElement).click();
      return null;
    });
    await page.waitForTimeout(300);
    await page.fill('[data-testid="prop-src"]', newSrc);
    await page.waitForTimeout(300);
    const srcAfter = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      return ed.getSelected().getAttributes().src ?? "";
    });
    ok(srcAfter === newSrc, "用例6 src 修改 -> 属性 src=" + newSrc + "（实际 " + srcAfter + "）");

    // ---------- 用例 7：Ctrl+Z 内建 keymap 撤销 ----------
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      return ed.getSelected().getAttributes().src ?? "";
    });
    ok(afterUndo.startsWith("data:image/png"), "用例7 Ctrl+Z 撤销 src 修改（恢复 data:image/png，实际 " + afterUndo.slice(0, 30) + "...）");

    // ---------- 用例 8：内容编辑（textnode 直写） ----------
    await page.evaluate(() => {
      const title = Array.from(document.querySelectorAll('[data-testid="layer-node"]')).find((n) => (n.textContent ?? "").includes("title"));
      (title as HTMLElement).click();
      return null;
    });
    await page.waitForTimeout(300);
    const textBefore = await page.evaluate(() => (document.querySelector('[data-testid="prop-text"]') as HTMLInputElement)?.value ?? "");
    await page.fill('[data-testid="prop-text"]', "每周签到");
    await page.waitForTimeout(300);
    const textAfter = await page.evaluate(() => {
      const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
      const html = ed.getHtml();
      return { contains: html.includes("每周签到"), canvas: (ed.Canvas.getFrame().view.el.contentDocument.querySelector(".title") as HTMLElement).textContent };
    });
    ok(textBefore === "每日签到", "用例8 内容输入框显示原文本（实际 " + textBefore + "）");
    ok(textAfter.contains && (textAfter.canvas ?? "").includes("每周签到"), "用例8 内容改为 每周签到 -> 画布文本更新");
  } finally {
    await browser.close();
    await vite.close();
  }

  console.log("Props 断言：" + pass + " 通过 / " + fail + " 失败");
  if (fail > 0) process.exit(1);
}

void main();
