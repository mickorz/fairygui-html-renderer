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
  const ccServer = createApp({ rootDir: path.resolve("projects", "CC-Default") });
  await new Promise<void>((r) => ccServer.listen(0, "127.0.0.1", r));
  try {
    const ccPort = (ccServer.address() as AddressInfo).port;
    const pkg = loadPackage(path.resolve("projects", "CC-Default/assets/Bag"));
    const cliHtml = renderHtml(
      buildScene(getComponent(path.resolve("projects", "CC-Default/assets/Bag/BagWin.xml")), { pkg, root: path.resolve("projects", "CC-Default") }),
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

  // ===== S5：语义 HTML -> XML 写出路由（POST，只返回文本不落盘） =====
  {
    // 取 RenderFix 渲染 HTML，改 n3 文本后写回
    const view = await get("/view?component=cycle/RenderFix.xml&bare=1");
    const changed = view.body.replace(/text="%E5%B1%85%E4%B8%AD%E6%96%87%E6%9C%AC"/, 'text="CHANGED"').replace(/(data-fgui-id="n3"[^>]*data-fgui-attrs=')([^']*)'/, (_m0, pre, json) => {
      const attrs = JSON.parse(json.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<"));
      attrs.text = "CHANGED";
      return pre + JSON.stringify(attrs).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;") + "'";
    });
    const wr = await fetch(base + "/api/xml-write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component: "cycle/RenderFix.xml", html: changed }),
    });
    const wd = JSON.parse(await wr.text()) as { xml?: string; appliedChanges?: number; error?: string };
    check(
      "XML 写出路由（POST：覆盖 n3 text，返回含 CHANGED 的 XML）",
      wr.status === 200 && wd.appliedChanges === 1 && (wd.xml?.includes("CHANGED") ?? false),
      JSON.stringify({ status: wr.status, appliedChanges: wd.appliedChanges }),
    );
    const bad = await fetch(base + "/api/xml-write", { method: "POST", body: JSON.stringify({ component: "cycle/RenderFix.xml" }) });
    const badData = JSON.parse(await bad.text()) as { error?: string };
    check("XML 写出缺 html 返回 400", bad.status === 400 && typeof badData.error === "string");
  }

  // ===== S4：场景结构 diff 路由 =====
  {
    const dr = await get("/api/scene-diff?a=cycle/DiffA.xml&b=cycle/DiffB.xml");
    const dd = JSON.parse(dr.body) as { stats: { added: number; removed: number; changed: number }; changed: { node: { id: string | null }; changes: { path: string; from: unknown; to: unknown }[] }[] };
    check(
      "场景 diff 路由（DiffA->DiffB：added 1/removed 1/changed 3，n1 文本 Hello->World）",
      dr.status === 200 && dd.stats.added === 1 && dd.stats.removed === 1 && dd.stats.changed === 3
        && dd.changed.some((c) => c.node.id === "n1" && c.changes.some((ch) => ch.path === "attrs.text" && ch.from === "Hello" && ch.to === "World")),
    );
    const dbad = await get("/api/scene-diff?a=cycle/DiffA.xml");
    check("场景 diff 缺参返回 400", dbad.status === 400);
  }

  // ===== S6：路径守卫加固（符号链接 realpath 复核 + 不存在返回 404） =====
  {
    const { safeResolve } = await import("../src/server/server.js");
    const guardRoot = path.join(workspace, "assets");
    check("守卫：正常包内路径放行", safeResolve(guardRoot, "cycle/P3Fix.xml") !== null);
    check("守卫：越界路径拦截", safeResolve(guardRoot, "../package.json") === null);
    check("守卫：不存在文件拦截（realpath 复核）", safeResolve(guardRoot, "cycle/NotExist.xml") === null);
    check("守卫：root 本身不放行", safeResolve(guardRoot, ".") === null);
  }

  // ===== P0-A：多工程切换（projects/ 注册目录 + ?project= 白名单 + 资源链路携带工程） =====
  {
    // 单工程兼容：主实例（fixtures/workspace 形态）/api/projects 返回 single 模式单元素
    const single = await get("/api/projects");
    const sd = JSON.parse(single.body) as { mode: string; defaultProject: string; projects: { name: string }[] };
    check(
      "多工程：单工程模式兼容（single + 唯一工程）",
      single.status === 200 && sd.mode === "single" && sd.projects.length === 1 && sd.defaultProject === sd.projects[0].name,
      single.body.slice(0, 120),
    );

    // 双工程夹具实例（workspace2/projects/a + b：同名包名/组件/图片路径，仅内容不同）
    const ws2 = path.resolve("tests/fixtures/workspace2/projects");
    const server2 = createApp({ projectsDir: ws2 });
    await new Promise<void>((r) => server2.listen(0, "127.0.0.1", r));
    const base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    try {
      const g2 = async (url: string): Promise<{ status: number; body: string }> => {
        const r = await fetch(base2 + url);
        return { status: r.status, body: await r.text() };
      };
      // 1. 双工程注册
      const pr = await g2("/api/projects");
      const pd = JSON.parse(pr.body) as { mode: string; defaultProject: string; projects: { name: string; packageCount: number }[] };
      check(
        "多工程：注册清单（multi + a/b 两工程）",
        pr.status === 200 && pd.mode === "multi" && pd.defaultProject === "a"
          && pd.projects.length === 2 && pd.projects.every((x) => x.name.length === 1 && x.packageCount === 1),
        pr.body.slice(0, 160),
      );
      // 2. 切换不重启：同进程两个工程各自的包列表
      const pa = JSON.parse((await g2("/api/project?project=a")).body) as { project: string; packages: { name: string }[] };
      const pb = JSON.parse((await g2("/api/project?project=b")).body) as { project: string; packages: { name: string }[] };
      check(
        "多工程：切换不重启（a/b 各自正确响应带工程名）",
        pa.project === "a" && pb.project === "b" && pa.packages.some((x) => x.name === "Pkg") && pb.packages.some((x) => x.name === "Pkg"),
        JSON.stringify([pa.project, pb.project]),
      );
      // 3. 缺省回退默认工程 + 未知工程 404
      const pd2 = JSON.parse((await g2("/api/project")).body) as { project: string };
      const unknown = await g2("/api/project?project=c");
      check("多工程：缺省回退默认工程 a", pd2.project === "a", pd2.project);
      check("多工程：未知工程 404（不静默回退）", unknown.status === 404, `status=${unknown.status}`);
      // 4. 路径越界：跨工程相对路径被守卫拦截（safeResolve 以所选工程 assetsRoot 为界）
      const cross = await g2("/api/scene?project=a&component=../b/assets/Pkg/Comp.xml");
      check("多工程：跨工程路径拒绝", cross.status === 404, `status=${cross.status}`);
      // 5. 资源隔离（P0-1 核心）：同名图片相对路径各归各工程
      const ra = await g2("/api/assets/Pkg/img.png?project=a");
      const rb = await g2("/api/assets/Pkg/img.png?project=b");
      check(
        "多工程：资源隔离（同名图片各归各工程）",
        ra.status === 200 && rb.status === 200 && ra.body === "PNG-DATA-PROJ-a" && rb.body === "PNG-DATA-PROJ-b",
        `a=${ra.body} b=${rb.body}`,
      );
      // 6. 渲染资源 URL 携带工程（P0-1：/view 产物内资源地址带 project）
      const va = await g2("/view?project=a&component=Pkg/Comp.xml");
      const vb = await g2("/view?project=b&component=Pkg/Comp.xml");
      check(
        "多工程：渲染资源 URL 带 project（/view 产物）",
        va.status === 200 && vb.status === 200
          && va.body.includes("/api/assets/Pkg/img.png?project=a") && va.body.includes("PROJ_a")
          && vb.body.includes("/api/assets/Pkg/img.png?project=b") && vb.body.includes("PROJ_b"),
        `a含url=${va.body.includes("?project=a")} b含url=${vb.body.includes("?project=b")}`,
      );
      // 7. scene-diff 带工程（同工程内 diff 自身为空）
      const da = JSON.parse((await g2("/api/scene-diff?project=a&a=Pkg/Comp.xml&b=Pkg/Comp.xml")).body) as { stats: { added: number; removed: number; changed: number } };
      check(
        "多工程：scene-diff 带工程（同组件 diff 为空）",
        da.stats.added === 0 && da.stats.removed === 0 && da.stats.changed === 0,
        JSON.stringify(da.stats),
      );
      // 8. xml-write 带工程（POST query 上的 project；b 工程文本回写）
      const wr2 = await fetch(base2 + "/api/xml-write?project=b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ component: "Pkg/Comp.xml", html: "<div></div>" }),
      });
      const wd2 = JSON.parse(await wr2.text()) as { xml?: string; nodeCount?: number; error?: string };
      check(
        "多工程：xml-write 带工程（b 工程原样合并写出含 PROJ_b）",
        wr2.status === 200 && (wd2.xml?.includes("PROJ_b") ?? false) && !(wd2.xml?.includes("PROJ_a") ?? false),
        JSON.stringify({ status: wr2.status, error: wd2.error }),
      );
      // 9. 并发隔离：a/b 交错请求互不污染（工程是请求上下文不是服务状态）
      const [sa, sb, sa2] = await Promise.all([
        g2("/api/scene?project=a&component=Pkg/Comp.xml"),
        g2("/api/scene?project=b&component=Pkg/Comp.xml"),
        g2("/api/scene?project=a&component=Pkg/Comp.xml"),
      ]);
      const textsOf = (body: string): string =>
        (JSON.parse(body) as { nodes: { attrs?: { text?: string } }[] }).nodes.map((n) => n.attrs?.text ?? "").join(",");
      check(
        "多工程：并发隔离（a/b 交错互不污染）",
        textsOf(sa.body).includes("PROJ_a") && textsOf(sb.body).includes("PROJ_b")
          && textsOf(sa2.body).includes("PROJ_a") && !textsOf(sb.body).includes("PROJ_a"),
        `a=${textsOf(sa.body)} b=${textsOf(sb.body)}`,
      );
    } finally {
      server2.close();
    }
  }
} finally {
  server.close();
}

if (failed > 0) {
  console.error(`服务端检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("服务端全部检查通过");
