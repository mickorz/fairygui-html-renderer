import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUiAssetIndex, searchUiAssets, findComponentUsages } from "../src/scene/ui-asset-index.js";
import { buildComponentGraph, classNeighborhood, graphIdOf } from "../src/scene/component-graph.js";

// UI 资产索引 + 组件关系图谱检查（S2/S3，沿袭 egret check:assets/check:graph 合并为一套）
// 夹具：tests/fixtures/workspace（cycle 包，引用关系确定性）

let failed = 0;
function check(name: string, ok: boolean): void {
  if (!ok) {
    failed++;
    console.error(`[失败] ${name}`);
  } else {
    console.log(`[通过] ${name}`);
  }
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "workspace");

// ===== S2：资产索引 =====
const idx = buildUiAssetIndex(root);
check("索引：全部组件登记（cycle 包 22 组件）", idx.entries.length === 22);
check("索引：无解析失败", idx.parseFailures.length === 0);
check("索引：基础元数据（P4Fix 尺寸与包 id）", (() => {
  const e = idx.entries.find((x) => x.name === "P4Fix.xml");
  return !!e && e.packageId === "test01" && e.package === "cycle" && e.resourceId === "c_p4" && Array.isArray(e.size);
})());
check("索引：refs 引用边（P4Fix 引用 7 个组件）", (() => {
  const e = idx.entries.find((x) => x.name === "P4Fix.xml");
  return !!e && e.refs.filter((r) => r.kind === "component").length === 7;
})());
check("索引：图片引用计数（P4Fix 图片引用 0）", (() => {
  const e = idx.entries.find((x) => x.name === "P4Fix.xml");
  return !!e && e.imageRefCount === 0;
})());

// ===== S2：检索与反向引用 =====
check("检索：组件名子串命中", searchUiAssets(idx, "slider").some((e) => e.name === "SliderFix.xml"));
check("检索：pkgId.resId 命中", searchUiAssets(idx, "test01.c_sl").some((e) => e.resourceId === "c_sl"));
const usage = findComponentUsages(idx, { id: "test01.c_sl" });
check("反向引用：SliderFix 被 P4Fix 引用", usage.target?.name === "SliderFix.xml" && usage.usedBy.length === 1 && usage.usedBy[0].file === "cycle/P4Fix.xml" && usage.usedBy[0].edge === "src");
const usageByFile = findComponentUsages(idx, { file: "cycle/TreeListFix.xml" });
check("反向引用：按文件查询（TreeListFix 被 P4Fix 引用，defaultItem 来自 tree list）", usageByFile.target?.resourceId === "c_tl" && usageByFile.usedBy.some((u) => u.file === "cycle/P4Fix.xml"));
const usageNone = findComponentUsages(idx, { id: "test01.c_p4" });
check("反向引用：无人引用返回空（P4Fix 是入口）", usageNone.usedBy.length === 0);
check("反向引用：不存在目标返回 null", findComponentUsages(idx, { id: "test01.nope" }).target === null);

// ===== S3：组件图谱 =====
const graph = buildComponentGraph(idx);
check("图谱：节点数 = 组件数", graph.nodes.length === idx.entries.length);
check("图谱：边数（P4Fix 7 条 + P3Fix 1 条 c_bi + CycleA/B 互引 + Dup 自引等）", graph.edges.length >= 10);
const dupId = graphIdOf(graph, "cycle/Dup.xml")!;
check("图谱：graphIdOf 按文件找 id", dupId === "test01.c_c");
check("图谱：Tarjan 检出 CycleA/B 互引环", (() => {
  const a = graphIdOf(graph, "cycle/CycleA.xml")!;
  const b = graphIdOf(graph, "cycle/CycleB.xml")!;
  return graph.cycles.some((c) => c.includes(a) && c.includes(b) && c.length === 2);
})());
check("图谱：环清单只含互引环（无自环误报）", graph.cycles.length === 1 && graph.cycles[0].length === 2);
check("图谱：枢纽排行首位被引用数 >= 3", (graph.hubs[0]?.inDegree ?? 0) >= 3);
check("图谱：未引用清单含入口组件 P4Fix", graph.unreferenced.some((n) => n.file === "cycle/P4Fix.xml"));
const nb = classNeighborhood(graph, "test01.c_bi");
check("邻域：ButtonIcon 被引用 3 次（P3Fix 三个实例）", nb.usedBy.length === 3 && nb.usedBy.every((e) => e.file === "cycle/P3Fix.xml"));
check("邻域：无环组件 inCycle 为空", nb.inCycle.length === 0);
const nbCycle = classNeighborhood(graph, graphIdOf(graph, "cycle/CycleA.xml")!);
check("邻域：环成员 inCycle 含自身与对端", nbCycle.inCycle.length === 2);

// ===== 真实样本冒烟（CC-Default 存在时） =====
import fs from "node:fs";
const realRoot = path.resolve(root, "..", "..", "..", "CC-Default");
if (fs.existsSync(path.join(realRoot, "assets"))) {
  const ridx = buildUiAssetIndex(realRoot);
  const rgraph = buildComponentGraph(ridx);
  check("真实样本：索引无解析失败", ridx.parseFailures.length === 0);
  check("真实样本：枢纽排行非空（被引用最多的组件）", rgraph.hubs.length > 0 && rgraph.hubs[0].inDegree >= 2);
  const btn = findComponentUsages(ridx, { file: "Basics/components/Button3.xml" });
  check("真实样本：Button3 反向引用非空", btn.usedBy.length >= 1);
} else {
  console.log("[跳过] 真实样本 CC-Default 不存在");
}

if (failed > 0) {
  console.error(`资产索引/图谱检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("资产索引/图谱全部检查通过");
