import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { readPngSize } from "../src/convert/style-mapper.js";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/server.js";
import { findChrome } from "../src/mcp/chrome.js";

// Task 5 会话服务验收（执行计划第六节）：
// API 部分：创建/重复 409/非法名 400/读取/保存乐观锁 409/保存 rN+1/project/export/asset 流/穿越 404/超大体 413
// 浏览器部分：?session 恢复、资源路径（HTML 相对 src 显示/CSS url() 显示/替换图片后显示/导出路径一致）、
//             重开节点 id 完整、恢复不一致提示与不静默覆盖
// 运行：npm run check:editor

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string): void {
  pass = pass + (cond ? 1 : 0);
  fail = fail + (cond ? 0 : 1);
  console.log((cond ? "[通过] " : "[失败] ") + label);
}

// ---------- 公共：API 服务 ----------

const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editor-ws-"));
process.env.FGUI_EDITOR_WORKSPACE = wsRoot;
// convert 输出根用临时工程（写 <assetsRoot>/<pkg>，不污染只读 fixtures）
const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editor-proj-"));
fs.mkdirSync(path.join(projRoot, "assets"), { recursive: true });

const apiServer = createApp({ rootDir: projRoot });
await new Promise<void>((r) => apiServer.listen(0, "127.0.0.1", r));
const apiPort = (apiServer.address() as AddressInfo).port;
const apiBase = `http://127.0.0.1:${apiPort}`;

async function api(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: string }> {
  const r = await fetch(apiBase + urlPath, {
    method,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.text() };
}

const HTML1 = `<div id="canvas"><div class="card" data-fgui-node-id="node_001" style="position:absolute;left:20px;top:20px;width:100px;height:60px;">A</div><img class="hero" data-fgui-node-id="node_002" src="assets/pic.png" style="position:absolute;left:200px;top:100px;width:120px;height:90px"></div>`;
const CSS1 = `#canvas { position: relative; width: 750px; height: 1334px; }`;
const HTML2 = HTML1.replace("left:20px", "left:40px");
const PIC = fs.readFileSync(path.resolve("tests/fixtures/convert/images/pic.png"));

// ---------- API 断言 ----------

{
  // 1. 创建会话
  const r1 = await api("POST", "/api/editor/session", { name: "s1", html: HTML1, css: CSS1 });
  const d1 = JSON.parse(r1.body) as { id: string; sourceRevision: string };
  ok(r1.status === 200 && d1.id === "s1" && d1.sourceRevision === "r1", "API1 创建会话 r1（" + r1.status + " " + d1.sourceRevision + "）");
  ok(
    fs.readFileSync(path.join(wsRoot, "s1", "source", "index.html"), "utf-8") === HTML1 &&
      fs.readFileSync(path.join(wsRoot, "s1", "editor", "index.html"), "utf-8") === HTML1,
    "API1 source 与 editor 初始文件落盘（AI 原稿 = 编辑态初始副本）",
  );

  // 2. 重复创建
  const r2 = await api("POST", "/api/editor/session", { name: "s1", html: HTML1, css: CSS1 });
  ok(r2.status === 409 && JSON.parse(r2.body).error.code === "SESSION_EXISTS", "API2 重复创建 409 SESSION_EXISTS");

  // 3. 非法会话名
  const r3 = await api("POST", "/api/editor/session", { name: "../escape", html: HTML1, css: CSS1 });
  ok(r3.status === 400, "API3 非法会话名 400（目录穿越拒绝）");

  // 4. 读取（含 assets 清单）
  fs.mkdirSync(path.join(wsRoot, "s1", "editor", "assets"), { recursive: true });
  fs.writeFileSync(path.join(wsRoot, "s1", "editor", "assets", "pic.png"), PIC);
  const r4 = await api("GET", "/api/editor/session/s1");
  const d4 = JSON.parse(r4.body) as { html: string; projectData: unknown; assets: string[]; sourceRevision: string };
  ok(r4.status === 200 && d4.html === HTML1 && d4.projectData === null, "API4 读取会话（html=原稿，projectData=null）");
  ok(JSON.stringify(d4.assets) === JSON.stringify(["assets/pic.png"]), "API4 assets 清单（" + d4.assets.join(",") + "）");

  // 5. 乐观锁冲突
  const r5 = await api("PUT", "/api/editor/session/s1", { html: HTML2, css: CSS1, projectData: { pages: [] }, sourceRevision: "r9" });
  const d5 = JSON.parse(r5.body) as { error: { code: string; detail: { expected: string; actual: string } } };
  ok(r5.status === 409 && d5.error.code === "REVISION_CONFLICT" && d5.error.detail.actual === "r1", "API5 版本冲突 409（expected r9 actual r1）");

  // 6. 正确保存
  const r6 = await api("PUT", "/api/editor/session/s1", { html: HTML2, css: CSS1, projectData: { pages: [{ id: "p1" }] }, assets: ["assets/pic.png"], diagnostics: [], sourceRevision: "r1" });
  const d6 = JSON.parse(r6.body) as { sourceRevision: string };
  ok(r6.status === 200 && d6.sourceRevision === "r2", "API6 保存成功 r2");
  ok(fs.readFileSync(path.join(wsRoot, "s1", "editor", "index.html"), "utf-8") === HTML2, "API6 保存落盘 editor/index.html");

  // 7. project.json
  const r7 = await api("GET", "/api/editor/session/s1/project");
  const d7 = JSON.parse(r7.body) as { projectData: { pages: { id: string }[] }; sourceRevision: string };
  ok(r7.status === 200 && d7.projectData.pages[0].id === "p1" && d7.sourceRevision === "r2", "API7 project.json 原文读取");

  // 8. export
  const r8 = await api("POST", "/api/editor/session/s1/export", { projectData: {} });
  const d8 = JSON.parse(r8.body) as { html: string; assets: string[]; diagnostics: unknown[] };
  ok(r8.status === 200 && d8.html === HTML2 && JSON.stringify(d8.assets) === JSON.stringify(["assets/pic.png"]), "API8 export 返回保存态（html+assets+diagnostics）");

  // 9. asset 流
  const r9 = await fetch(apiBase + "/api/editor/session/s1/asset/assets/pic.png");
  const bin = Buffer.from(await r9.arrayBuffer());
  ok(r9.status === 200 && bin.equals(PIC) && (r9.headers.get("content-type") ?? "").includes("image/png"), "API9 asset 文件流（字节一致）");
  const r9b = await api("GET", "/api/editor/session/s1/asset/assets/none.png");
  ok(r9b.status === 404, "API9b 缺失资源 404");
  const r9c = await api("GET", "/api/editor/session/s1/asset/../source/index.html");
  ok(r9c.status === 404, "API9c 穿越路径 404（拒绝 ..）");

  // 10. 超大请求体
  const big = '<div id="canvas">' + "x".repeat(11 * 1024 * 1024) + "</div>";
  const r10 = await api("PUT", "/api/editor/session/s1", { html: big, css: CSS1, projectData: {}, sourceRevision: "r2" });
  ok(r10.status === 413, "API10 超过 10MB 请求体 413 PAYLOAD_TOO_LARGE（" + r10.status + "）");

  // 11. 未知会话
  const r11 = await api("GET", "/api/editor/session/nope");
  ok(r11.status === 404 && JSON.parse(r11.body).error.code === "SESSION_NOT_FOUND", "API11 未知会话 404");

  // 12. convert（Converter 集成闭环）：editor/index.html 输入 -> 隔离新包 + 报告落盘
  const r12 = await api("POST", "/api/editor/session/s1/convert", { outPkgName: "pkg-a" });
  const d12 = JSON.parse(r12.body) as { pkgId: string; files: string[]; report: { nodeTotal: number; assets: string[]; inputHtml: string }; validation: { matched: number } };
  ok(
    r12.status === 200 && !!d12.pkgId && d12.files.some((f) => f.endsWith("Root.xml")),
    "API12 convert 生成隔离新包（" + d12.pkgId + "，文件 " + d12.files.length + " 个）",
  );
  ok(fs.existsSync(path.join(projRoot, "assets", "pkg-a", "Root.xml")), "API12 包落盘 <工程assets>/pkg-a/Root.xml");
  ok(
    d12.report.inputHtml === "editor/index.html" && d12.report.nodeTotal > 0 && d12.report.assets.includes("assets/pic.png"),
    "API12 报告字段（输入路径/节点总数/资源清单，assets=" + d12.report.assets.join(",") + "）",
  );
  ok(d12.validation.matched > 0, "API12 回读对照（matched=" + d12.validation.matched + "）");
  const repFile = JSON.parse(fs.readFileSync(path.join(wsRoot, "s1", "output", "validation-report.json"), "utf-8")) as { inputHtml: string };
  ok(repFile.inputHtml === "editor/index.html", "API12 validation-report.json 落盘会话 output/");

  // 12b. 重复 convert 拒绝覆盖
  const r12b = await api("POST", "/api/editor/session/s1/convert", { outPkgName: "pkg-a" });
  ok(r12b.status === 400 && JSON.parse(r12b.body).error.code === "PKG_EXISTS", "API12b 已存在包 400 PKG_EXISTS（不覆盖）");

  // 12c. 非法包名
  const r12c = await api("POST", "/api/editor/session/s1/convert", { outPkgName: "../evil" });
  ok(r12c.status === 400, "API12c 非法包名 400");

  // 12d. Renderer bare 回读新包
  const r12d = await api("GET", "/view?component=pkg-a/Root.xml&bare=1");
  ok(r12d.status === 200 && r12d.body.includes("body"), "API12d Renderer bare 回读新包（" + r12d.status + "）");
}

console.log("API 断言：" + pass + " 通过 / " + fail + " 失败");
const apiFail = fail;

// ---------- 浏览器断言 ----------

let vite: ViteDevServer | null = null;
try {
  process.env.EDITOR_API_PORT = String(apiPort);
  vite = await createViteServer({
    root: path.resolve("src/editor"),
    configFile: path.resolve("src/editor/vite.config.ts"),
    server: { port: 5199, strictPort: true },
    logLevel: "error",
  });
  await vite.listen();
  const chromePath = findChrome();
  if (!chromePath) throw new Error("未找到 Chrome（findChrome）");
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto("http://localhost:5199/?session=bs1");
  await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);

  // bs1 会话：带真实资源 + CSS url() 背景
  fs.mkdirSync(path.join(wsRoot, "bs1", "editor", "assets"), { recursive: true });
  fs.copyFileSync(path.join(wsRoot, "s1", "editor", "assets", "pic.png"), path.join(wsRoot, "bs1", "editor", "assets", "pic.png"));
  fs.copyFileSync(path.join(wsRoot, "s1", "editor", "assets", "pic.png"), path.join(wsRoot, "bs1", "editor", "assets", "pic2.png"));
  const bsHtml = `<div id="canvas"><div class="bg-block" style="position:absolute;left:20px;top:20px;width:100px;height:60px;background-image:url(assets/pic.png)"></div><img class="hero" data-fgui-node-id="node_hero" src="assets/pic.png" style="position:absolute;left:200px;top:100px;width:120px;height:90px"></div>`;
  const bsCss = `#canvas { position: relative; width: 750px; height: 1334px; } .bg-block { border-radius: 8px; }`;
  await api("POST", "/api/editor/session", { name: "bs1", html: bsHtml, css: bsCss });

  // 重开页面加载会话（POST 在页面打开后创建，直接 reload 触发会话流）
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);
  await page.waitForTimeout(800);

  // B1. HTML 相对路径 src 显示（base href -> asset 路由）
  const imgLoaded = await page.evaluate(() => {
    const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
    const img = ed.Canvas.getFrame().view.el.contentDocument.querySelector(".hero") as HTMLImageElement;
    return { currentSrc: img.currentSrc, w: img.naturalWidth, h: img.naturalHeight, base: !!(ed.Canvas.getFrame().view.el.contentDocument.querySelector("base")) };
  });
  // 占位 SVG（加载失败 onError 兜底）是 data: 且 100x24；真实资源 currentSrc 命中 asset 路由
  ok(
    imgLoaded.base && imgLoaded.currentSrc.includes("/api/editor/session/bs1/asset/assets/pic.png") && imgLoaded.h !== 24,
    "B1 HTML 相对路径图片经 base href + asset 路由加载（currentSrc=" + imgLoaded.currentSrc.slice(0, 70) + " " + imgLoaded.w + "x" + imgLoaded.h + "）",
  );

  // B2. CSS url() 显示（背景图）
  const bgShown = await page.evaluate(async () => {
    const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
    const cs = ed.Canvas.getFrame().view.el.contentWindow.getComputedStyle(
      ed.Canvas.getFrame().view.el.contentDocument.querySelector(".bg-block"),
    );
    const url = cs.backgroundImage.slice(5, -2); // url("...") -> ...
    let loaded = false;
    try {
      const r = await fetch(url);
      loaded = r.ok && (r.headers.get("content-type") ?? "").includes("image/");
    } catch {
      loaded = false;
    }
    return { url, loaded };
  });
  ok(bgShown.loaded, "B2 CSS url() 相对路径背景图经 asset 路由可达（" + bgShown.url.slice(-50) + "）");

  // B3. 替换图片后显示（属性面板 src 改 pic2 -> 图片仍加载）
  await page.evaluate(() => {
    const hero = Array.from(document.querySelectorAll('[data-testid="layer-node"]')).find((n) => (n.textContent ?? "").includes("hero"));
    (hero as HTMLElement).click();
    return null;
  });
  await page.waitForTimeout(300);
  await page.fill('[data-testid="prop-src"]', "assets/pic2.png");
  await page.waitForTimeout(500);
  const img2 = await page.evaluate(() => {
    const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
    const img = ed.Canvas.getFrame().view.el.contentDocument.querySelector(".hero") as HTMLImageElement;
    return { src: img.getAttribute("src"), currentSrc: img.currentSrc, h: img.naturalHeight, modelSrc: ed.getSelected().get("src") };
  });
  ok(
    img2.src === "assets/pic2.png" && img2.currentSrc.includes("/api/editor/session/bs1/asset/assets/pic2.png") && img2.h !== 24,
    "B3 替换图片后显示（src=" + img2.src + " currentSrc=" + img2.currentSrc.slice(0, 70) + "）",
  );

  // B4. 保存（Ctrl+S）-> 导出 HTML 路径与导入一致 + 落盘 projectData
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(800);
  const rB4 = await api("GET", "/api/editor/session/bs1");
  const dB4 = JSON.parse(rB4.body) as { html: string; css: string; projectData: { pages?: unknown[] } | null; sourceRevision: string };
  ok(dB4.sourceRevision === "r2", "B4 保存后 revision r2（" + dB4.sourceRevision + "）");
  ok(dB4.html.includes('src="assets/pic2.png"'), "B4 导出 HTML 资源路径原样保留（assets/pic2.png）");
  ok(!!dB4.projectData && Array.isArray(dB4.projectData.pages), "B4 projectData 落盘（pages 存在）");

  // B5. 重开：节点 id 完整 + 恢复一致（无 banner）
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);
  await page.waitForTimeout(1000);
  const reopen = await page.evaluate(() => {
    const ed = (window as unknown as { __editorInstance: any }).__editorInstance;
    const doc = ed.Canvas.getFrame().view.el.contentDocument;
    return {
      heroId: doc.querySelector(".hero")?.getAttribute("data-fgui-node-id") ?? null,
      banner: !!document.querySelector('[data-testid="consistency-banner"]'),
      imgLoaded: (() => {
        const img = doc.querySelector(".hero") as HTMLImageElement;
        return img.currentSrc.includes("/api/editor/session/bs1/asset/") && img.naturalHeight !== 24;
      })(),
    };
  });
  ok(reopen.heroId === "node_hero", "B5 重开节点 id 完整（node_hero）");
  ok(!reopen.banner, "B5 重开恢复与磁盘一致（无不一致 banner）");
  ok(reopen.imgLoaded, "B5 重开图片加载（base href 恢复后仍命中）");

  // B6. 恢复不一致：篡改磁盘 HTML -> 提示可见 + 取消不覆盖
  const diskHtml = fs.readFileSync(path.join(wsRoot, "bs1", "editor", "index.html"), "utf-8");
  fs.writeFileSync(path.join(wsRoot, "bs1", "editor", "index.html"), diskHtml.replace('class="hero"', 'class="hero-tampered"').replace("node_hero", "node_999"), "utf-8");
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);
  await page.waitForTimeout(1200);
  const bannerVisible = await page.evaluate(() => !!document.querySelector('[data-testid="consistency-banner"]'));
  ok(bannerVisible, "B6 篡改磁盘后重开：不一致 banner 可见");
  // 取消：不覆盖
  await page.click('[data-testid="consistency-cancel"]');
  await page.waitForTimeout(500);
  const afterCancel = await api("GET", "/api/editor/session/bs1");
  const dAfterCancel = JSON.parse(afterCancel.body) as { html: string };
  ok(dAfterCancel.html.includes("node_999"), "B6 取消后磁盘文件未被覆盖（仍为篡改内容）");

  // B7. 以恢复态为准并重新保存 -> 覆盖为恢复态 + revision 递增
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true);
  await page.waitForTimeout(1200);
  await page.click("text=以恢复态为准并重新保存");
  await page.waitForTimeout(800);
  const afterKeep = await api("GET", "/api/editor/session/bs1");
  const dAfterKeep = JSON.parse(afterKeep.body) as { html: string; sourceRevision: string };
  ok(dAfterKeep.sourceRevision === "r3", "B7 重新保存 revision r3（取消未保存，" + dAfterKeep.sourceRevision + "）");
  ok(dAfterKeep.html.includes("node_hero") && !dAfterKeep.html.includes("node_999"), "B7 以恢复态为准覆盖（node_hero 恢复）");

  // B8. 浏览器会话 convert 闭环：编辑态 -> 新包 -> Renderer bare 回读截图（存在性与尺寸）
  const r8 = await api("POST", "/api/editor/session/bs1/convert", { outPkgName: "pkg-bs1" });
  ok(r8.status === 200, "B8 编辑态 convert 成新包（" + r8.status + "）");
  await page.goto(apiBase + "/view?component=pkg-bs1/Root.xml&bare=1");
  await page.waitForTimeout(1500);
  const shot = path.resolve("dev-examples/ui-editor-p0/convert-bare.png");
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
  const png = readPngSize(shot);
  const size = fs.statSync(shot).size;
  ok(!!png && png.width > 0 && png.height > 0 && size > 10_000, "B8 bare 回读截图存在且非空白（" + png?.width + "x" + png?.height + "，" + size + " 字节）");

  await browser.close();
} finally {
  await vite?.close();
  apiServer.close();
  fs.rmSync(wsRoot, { recursive: true, force: true });
  fs.rmSync(projRoot, { recursive: true, force: true });
}

console.log("Editor Session 断言：" + pass + " 通过 / " + fail + " 失败");
if (fail > 0 || apiFail > 0) process.exit(1);
