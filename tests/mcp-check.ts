import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { toolListComponents, toolLocate, toolRender, toolScreenshot } from "../src/mcp/tools.js";

// 阶段 D 验收：MCP 四工具直测（三类场景）+ PNG 文件头 + stdio 协议冒烟
// 运行：npm run check:mcp

const execFileAsync = promisify(execFile);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "[通过]" : "[失败]"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failed++;
}

const ctx = { rootDir: path.resolve("CC-Default") };
const fxRoot = { rootDir: path.resolve("tests/fixtures/workspace") };

// ===== 场景 1：同名组件重复出现（locate → 两个 key 各自定位） =====
const dup = toolLocate(fxRoot, { query: "dup" });
const dupResults = (dup as { results: { key: string; path: string }[] }).results;
check("同名节点两条定位结果", dupResults.length === 2 && dupResults[0].key !== dupResults[1].key);
const dupRender1 = toolRender(fxRoot, { key: dupResults[0].key });
const dupRender2 = toolRender(fxRoot, { key: dupResults[1].key });
check(
  "两个同名 key 渲染各自定位（互不串扰）",
  fs.existsSync(dupRender1.htmlFile) &&
    fs.existsSync(dupRender2.htmlFile) &&
    JSON.stringify(dupRender1.node.key) === JSON.stringify(dupResults[0].key) &&
    JSON.stringify(dupRender2.node.key) === JSON.stringify(dupResults[1].key),
);

// ===== 场景 2：嵌套三层（closeButton 实例链） =====
const loc = toolLocate(ctx, { query: "closeButton" });
const closeHit = (loc as { results: { path: string; key: string; component: string }[] }).results.find(
  (r) => r.path === "BagWin.frame.closeButton",
);
check("locate 命中三层实例链", !!closeHit && closeHit.component === "Bag/BagWin.xml");
const render = toolRender(ctx, { key: closeHit!.key });
check(
  "render 返回 file:// URL 与设计坐标",
  render.url.startsWith("file:///") &&
    fs.existsSync(render.htmlFile) &&
    (render.node.bounds as { x: number }).x === 509 &&
    (render.node as { sourceFile: string }).sourceFile === "assets/Bag/WindowFrame.xml",
);

// ===== 场景 3：修改 XML 后重新定位（实时搜索） =====
// 搜索匹配 name/id/path：改节点 name 才会反映到结果
const dupFile = path.resolve("tests/fixtures/workspace/assets/cycle/Dup.xml");
const original = fs.readFileSync(dupFile, "utf8");
try {
  fs.writeFileSync(dupFile, original.replace('name="dup"', 'name="dup_relocated"'), "utf8");
  const relocated = toolLocate(fxRoot, { query: "dup_relocated" });
  check(
    "修改 XML 后 locate 反映新内容",
    (relocated as { results: { path: string }[] }).results.length === 1 &&
      (relocated as { results: { path: string }[] }).results[0].path === "Dup.dup_relocated",
  );
} finally {
  fs.writeFileSync(dupFile, original, "utf8");
}
const restored = toolLocate(fxRoot, { query: "1_relocated" });
check("还原后搜索不再命中", (restored as { results: unknown[] }).results.length === 0);

// ===== list_components =====
const all = toolListComponents(ctx, {}) as { packages: unknown[] };
const bag = toolListComponents(ctx, { package: "Bag" }) as { components: { component: string }[] };
check(
  "list_components 包与组件枚举",
  Array.isArray(all.packages) && all.packages.length >= 15 && bag.components.some((c) => c.component === "Bag/BagWin.xml"),
);

// ===== screenshot_component：PNG 文件头 =====
let shot: { screenshotFile: string } | null = null;
try {
  shot = toolScreenshot(ctx, { key: closeHit!.key, width: 1280, height: 800 });
  const head = fs.readFileSync(shot.screenshotFile).subarray(0, 8);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  check("screenshot_component 产出合法 PNG", isPng, shot.screenshotFile);
} catch (err) {
  // Chrome 未安装时明确报错也算环境结论，但不计入通过
  check("screenshot_component 产出合法 PNG", false, String((err as Error).message));
}

// ===== stdio 协议冒烟：initialize -> tools/list -> tools/call =====
const mainTs = path.resolve("src/mcp/main.ts");
const child = spawn(process.execPath, ["--import", "tsx", mainTs], { stdio: ["pipe", "pipe", "pipe"] });
const protocolResult = await new Promise<{ toolCount?: number; locateTotal?: number; error?: string }>((resolve) => {
  let buf = "";
  let toolCount: number | undefined;
  let locateTotal: number | undefined;
  child.stdout!.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { id?: number; result?: { tools?: unknown[]; structuredContent?: { total?: number } } };
      if (msg.id === 1) {
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
      } else if (msg.id === 2) {
        toolCount = msg.result?.tools?.length;
        child.stdin!.write(
          JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "locate_component", arguments: { query: "closeButton" } } }) + "\n",
        );
      } else if (msg.id === 3) {
        locateTotal = msg.result?.structuredContent?.total;
        resolve({ toolCount, locateTotal });
      }
    }
  });
  child.on("error", (e) => resolve({ error: String(e) }));
  setTimeout(() => resolve({ error: "协议冒烟超时" }), 20_000).unref?.();
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n");
});
check(
  "stdio 协议冒烟（initialize/tools/list/tools/call）",
  protocolResult.toolCount === 4 && protocolResult.locateTotal !== undefined && protocolResult.locateTotal > 0,
  JSON.stringify(protocolResult),
);
child.kill();

if (failed > 0) {
  console.error(`MCP 检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("MCP 全部检查通过");
