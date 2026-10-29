import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/server.js";
import { loadPackage } from "../src/parser/package-parser.js";
import { getComponent, buildScene } from "../src/scene/scene-builder.js";
import { renderHtml } from "../src/renderer/html-renderer.js";

// 阶段 B 服务端验收：安全 / 正确性 / 刷新生效 / 双模式一致
// 运行：npm run check:server

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "[通过]" : "[失败]"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failed++;
}

const workspace = path.resolve("tests/fixtures/workspace");
const server = createApp({ rootDir: workspace });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function get(url: string): Promise<{ status: number; body: string }> {
  const r = await fetch(base + url);
  return { status: r.status, body: await r.text() };
}

try {
  // ===== 1. 工程与包枚举 =====
  const proj = await get("/api/project");
  const projData = JSON.parse(proj.body) as { root: string; packages: { name: string }[] };
  check("工程信息与包枚举", proj.status === 200 && projData.root === "workspace" && projData.packages.some((p) => p.name === "cycle"));

  const comps = await get("/api/packages/cycle/components");
  const compsData = JSON.parse(comps.body) as { components: { id: string; component: string }[] };
  check(
    "组件清单（含 scene 参数所需相对路径）",
    comps.status === 200 && compsData.components.some((c) => c.component === "cycle/CycleA.xml") && compsData.components.some((c) => c.id === "c_a"),
  );

  // ===== 2. Scene Tree 正确性 =====
  const scene = await get("/api/scene?component=cycle/CycleA.xml");
  const sceneData = JSON.parse(scene.body) as {
    file: string;
    packageId: string;
    nodes: {
      name: string;
      path: string;
      key: string;
      unsupported?: string;
      component?: { file: string; packageId: string; resourceId: string };
      children?: { path: string; unsupported?: string }[];
    }[];
  };
  check(
    "scene JSON 基本结构（相对路径 + 包 id）",
    scene.status === 200 && sceneData.packageId === "test01" && sceneData.file === path.relative(workspace, path.resolve(workspace, "assets/cycle/CycleA.xml")).split(path.sep).join("/"),
  );
  const toB = sceneData.nodes.find((n) => n.name === "toB");
  const bChild = toB?.children?.[0];
  check(
    "scene 嵌套展开 + 循环标记（toB > toA 截断）",
    !!toB && toB.path === "CycleA.toB" && toB.key === "test01.c_a.n1" && !!toB.component && toB.component.resourceId === "c_b" && bChild?.unsupported?.includes("循环引用") === true,
  );
  check("scene 不越界时循环不误报（toB 自身无 unsupported）", !!toB && toB.unsupported === undefined);

  // ===== 3. scene 与渲染 DOM 一致性 =====
  const view = await get("/view?component=cycle/CycleA.xml");
  function countNodes(ns: { children?: unknown[] }[]): number {
    return ns.reduce((acc, n) => acc + 1 + (n.children ? countNodes(n.children as { children?: unknown[] }[]) : 0), 0);
  }
  const sceneNodeCount = countNodes(sceneData.nodes);
  // 排除内联脚本后计数（selectorScript 中含 data-fgui-key 字面量）
  const viewMarkup = view.body.replace(/<script>[\s\S]*?<\/script>/, "");
  const domKeyCount = (viewMarkup.match(/data-fgui-key="/g) || []).length;
  check("scene JSON 节点数与渲染 DOM 一致", view.status === 200 && sceneNodeCount === domKeyCount, `scene=${sceneNodeCount} dom=${domKeyCount}`);

  // ===== 4. 安全：路径边界 =====
  const sec1 = await get("/api/scene?component=../.git/config");
  check("拒绝相对目录穿越", sec1.status >= 400);
  const sec2 = await get("/api/scene?component=%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json");
  check("拒绝 URL 编码穿越", sec2.status >= 400);
  const sec3 = await get("/api/scene?component=" + encodeURIComponent("C:/Windows/system32/drivers/etc/hosts"));
  check("拒绝绝对路径注入", sec3.status >= 400);
  const sec4 = await get("/api/assets/../../package.json");
  check("拒绝资源穿越", sec4.status >= 400);
  const sec5 = await get("/api/scene?component=cycle/NotExists.xml");
  check("不存在组件返回 404", sec5.status === 404);

  // ===== 5. 改 XML 刷新生效（每请求重解析） =====
  const dupFile = path.resolve(workspace, "assets/cycle/Dup.xml");
  const original = fs.readFileSync(dupFile, "utf8");
  try {
    const before = await get("/api/scene?component=cycle/Dup.xml");
    check("刷新生效-基线", before.status === 200 && before.body.includes('"1"') && !before.body.includes("1_changed"));
    fs.writeFileSync(dupFile, original.replace('text="1"', 'text="1_changed"'), "utf8");
    const after = await get("/api/scene?component=cycle/Dup.xml");
    check("修改 XML 后同请求返回新内容", after.body.includes("1_changed"), before.body.includes("1_changed") ? "缓存疑似未失效" : "");
  } finally {
    // 无论断言成败都还原 fixture，避免污染 git
    fs.writeFileSync(dupFile, original, "utf8");
  }
  const restored = await get("/api/scene?component=cycle/Dup.xml");
  check("还原后内容恢复", restored.body.includes('"1"') && !restored.body.includes("1_changed"));

  // ===== 6. 双模式一致（服务渲染 vs CLI 渲染路径） =====
  // 用 CC-Default 再起一个服务实例（测试主实例的 root 是 fixtures/workspace）
  const ccServer = createApp({ rootDir: path.resolve("CC-Default") });
  await new Promise<void>((r) => ccServer.listen(0, "127.0.0.1", r));
  try {
    const ccPort = (ccServer.address() as AddressInfo).port;
    const pkg = loadPackage(path.resolve("CC-Default/assets/Bag"));
    const cliHtml = renderHtml(
      buildScene(getComponent(path.resolve("CC-Default/assets/Bag/BagWin.xml")), { pkg }),
      { pkg, toAssetUrl: (f) => f },
    );
    const serverView = await fetch(`http://127.0.0.1:${ccPort}/view?component=` + encodeURIComponent("Bag/BagWin.xml"));
    const serverBody = await serverView.text();
    function keySeq(html: string): string[] {
      return [...html.matchAll(/data-fgui-key="([^"]*)"/g)].map((m) => m[1]);
    }
    const cliKeys = keySeq(cliHtml).join("|");
    const srvKeys = keySeq(serverBody).join("|");
    check("双模式渲染节点序列一致（CLI vs 服务）", serverView.status === 200 && cliKeys.length > 0 && cliKeys === srvKeys);

    // ===== 阶段 C：搜索与深度定位 =====
    const sClose = await fetch(`http://127.0.0.1:${ccPort}/api/search?q=closebutton`);
    const closeData = JSON.parse(await sClose.text()) as { results: { path: string; component: string; key: string }[] };
    check(
      "搜索 closeButton 命中嵌套三层",
      sClose.status === 200 && closeData.results.some((r) => r.path === "BagWin.frame.closeButton" && r.component === "Bag/BagWin.xml"),
    );
    check("子节点随父路径命中（n4）", closeData.results.some((r) => r.path === "BagWin.frame.closeButton.n4"));

    const n4Key = "rbw1tv9t.kcy10.n7~rbw1tv9t.dwwc3.n2~rbw1tv9t.dwwc4.n4";
    const vFocus = await fetch(`http://127.0.0.1:${ccPort}/view?component=` + encodeURIComponent("Bag/BagWin.xml") + "&focus=" + encodeURIComponent(n4Key));
    const vFocusBody = await vFocus.text();
    check(
      "view focus 深度定位（脚本注入 + 目标节点存在）",
      vFocus.status === 200 && vFocusBody.includes("fgui-focus") && vFocusBody.includes(`data-fgui-key="${n4Key}"`),
    );
  } finally {
    ccServer.close();
  }

  // ===== 阶段 C：同名节点多结果（workspace 服务实例） =====
  const sDup = await get("/api/search?q=dup");
  const dupData = JSON.parse(sDup.body) as { results: { path: string; key: string }[] };
  check(
    "搜索同名节点多结果可切换",
    sDup.status === 200 && dupData.results.length === 2 && dupData.results[0].key !== dupData.results[1].key && dupData.results.every((r) => r.path === "Dup.dup"),
  );

  const sEmpty = await get("/api/search?q=zzznope");
  check("无匹配返回空结果", sEmpty.status === 200 && JSON.parse(sEmpty.body).results.length === 0);
} finally {
  server.close();
}

if (failed > 0) {
  console.error(`服务端检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("服务端全部检查通过");
