import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, getComponent } from "../src/scene/scene-builder.js";
import { loadPackage } from "../src/parser/package-parser.js";
import { diffScenes } from "../src/scene/scene-diff.js";

// 场景结构 diff 检查（S4）：夹具 DiffA/DiffB（cycle 包）
// DiffA -> DiffB 的预期差异：
//   根 size 100x100 -> 120x100（changed，root）
//   n1 text Hello/12 -> World/14（changed，id 配对）
//   n2 graph xy/size 变（changed，id 配对）
//   n5 removedBg：A 有 B 无 -> removed
//   n6 addedBg：B 新增 -> added
//   n3 movedChild：id 相同父相同（root）-> matched（非 moved）；其子 n4 被删

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) {
    failed++;
    console.error(`[失败] ${name}`, detail ?? "");
  } else {
    console.log(`[通过] ${name}`);
  }
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "workspace");
const assets = path.join(root, "assets");

const fileA = path.join(assets, "cycle", "DiffA.xml");
const fileB = path.join(assets, "cycle", "DiffB.xml");
const pkg = loadPackage(path.join(assets, "cycle"));
const a = buildScene(getComponent(fileA, { fresh: true }), { pkg, root });
const b = buildScene(getComponent(fileB, { fresh: true }), { pkg, root });
const d = diffScenes(a, b);

check("根属性变化报告（size 100->120）", (() => {
  const rootChanged = d.changed.find((c) => c.node.type === "component");
  return !!rootChanged && rootChanged.changes.some((ch) => ch.path === "size" && JSON.stringify(ch.from) === "[100,100]" && JSON.stringify(ch.to) === "[120,100]");
})(), d.changed.map((c) => ({ n: c.node.type, p: c.changes.map((x) => x.path) })));

check("id 配对属性变化（n1 text Hello->World）", (() => {
  const n1 = d.changed.find((c) => c.node.id === "n1");
  return !!n1 && n1.changes.some((ch) => ch.path === "attrs.text" && ch.from === "Hello" && ch.to === "World");
})());

check("id 配对属性变化（n2 xy 变）", (() => {
  const n2 = d.changed.find((c) => c.node.id === "n2");
  return !!n2 && n2.changes.some((ch) => ch.path === "xy" && JSON.stringify(ch.from) === "[0,30]" && JSON.stringify(ch.to) === "[10,30]");
})());

check("id 删除（n5 removedBg）", d.removed.some((r) => r.id === "n5"));
check("新增（n6 addedBg）", d.added.some((r) => r.id === "n6"));
check("无跨父移动（n3 父未变）", d.moved.length === 0, d.moved);
check("统计守恒（added 1 / removed 1 / changed 3）", d.stats.added === 1 && d.stats.removed === 1 && d.stats.moved === 0 && d.stats.changed === 3, d.stats);

// ===== 同组件 diff 应为空 =====
const self = diffScenes(a, buildScene(getComponent(fileA, { fresh: true }), { pkg, root }));
check("同组件 diff 为空", self.stats.added === 0 && self.stats.removed === 0 && self.stats.moved === 0 && self.stats.changed === 0 && self.stats.matched > 0, self.stats);

// ===== 无 id 节点顺序配对（text 同类型兄弟按序配对，文本变化报告） =====
import fs from "node:fs";
const noIdA = path.join(assets, "cycle", "NoIdA.xml");
const noIdB = path.join(assets, "cycle", "NoIdB.xml");
fs.writeFileSync(noIdA, `<?xml version="1.0" encoding="utf-8"?>
<component size="50,20">
  <displayList>
    <text name="t1" xy="0,0" size="50,10" text="AAA"/>
    <text name="t2" xy="0,10" size="50,10" text="BBB"/>
  </displayList>
</component>
`);
fs.writeFileSync(noIdB, `<?xml version="1.0" encoding="utf-8"?>
<component size="50,20">
  <displayList>
    <text name="t1" xy="0,0" size="50,10" text="AAA"/>
    <text name="t2" xy="0,10" size="50,10" text="CCC"/>
  </displayList>
</component>
`);
const nd = diffScenes(buildScene(getComponent(noIdA, { fresh: true }), { pkg, root }), buildScene(getComponent(noIdB, { fresh: true }), { pkg, root }));
check("无 id 顺序配对（t2 文本 BBB->CCC）", (() => {
  const t2 = nd.changed.find((c) => c.node.name === "t2");
  return !!t2 && t2.changes.some((ch) => ch.path === "attrs.text" && ch.from === "BBB" && ch.to === "CCC");
})(), nd.changed.map((c) => c.node.name));

if (failed > 0) {
  console.error(`场景 diff 检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("场景 diff 全部检查通过");
