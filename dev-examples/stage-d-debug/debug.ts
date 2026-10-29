import fs from "node:fs";
import path from "node:path";
import { toolListComponents, toolLocate, toolRender } from "../../src/mcp/tools.js";

// 阶段 D 调试：render/list 返回值排查（完成即删）

const ctx = { rootDir: path.resolve("CC-Default") };
const loc = toolLocate(ctx, { query: "closeButton" });
const hit = (loc as { results: { key: string; path: string }[] }).results.find((r) => r.path === "BagWin.frame.closeButton");
const render = toolRender(ctx, { key: hit!.key });
console.log("url:", render.url);
console.log("htmlFile exists:", fs.existsSync(render.htmlFile));
console.log("node:", JSON.stringify(render.node, null, 2));

const all = toolListComponents(ctx, {}) as { packages: unknown[] };
console.log("packages:", all.packages?.length);
const bag = toolListComponents(ctx, { package: "Bag" }) as { components: { component: string }[] };
console.log("bag comps:", JSON.stringify(bag.components?.slice(0, 2)));
