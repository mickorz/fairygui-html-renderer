import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "../src/convert/transform.js";
import { toHexColor, readPngSize } from "../src/convert/style-mapper.js";
import { loadPackage } from "../src/parser/package-parser.js";
import { getComponent, buildScene } from "../src/scene/scene-builder.js";

// 阶段 G 验收：三样本流水线（提取→映射→写入→回读对照）+ 确定性 id
// 运行：npm run check:convert

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "[通过]" : "[失败]"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failed++;
}

const root = path.resolve("CC-Default");

// ===== 单元：颜色与 PNG 尺寸 =====
check("rgb 颜色转 hex", toHexColor("rgb(255, 214, 102)") === "#ffd666");
check("缩写 hex 补全", toHexColor("#abc") === "#000abc");
check("PNG IHDR 尺寸读取", JSON.stringify(readPngSize(path.resolve("tests/fixtures/convert/images/pic.png"))) === '{"width":61,"height":53}');

// ===== 样本 1：hello（文本图片组合，F 回归） =====
const hello = runPipeline({
  htmlFile: "tests/fixtures/convert/hello.html",
  outPkgDir: path.join(root, "assets", "Converted"),
  pkgName: "Converted",
  rootComponentName: "Hello.xml",
  force: true,
});
check("hello：3 节点原生转换", hello.report.total === 3 && hello.report.skipped.length === 0);
check("hello：回读坐标 ±1px", hello.validation.ok && hello.validation.matched === 3, `dx=${hello.validation.maxDx} dy=${hello.validation.maxDy}`);

// ===== 样本 2：flex-grid（Flex 计算位置 + 格子背景） =====
const flex = runPipeline({
  htmlFile: "tests/fixtures/convert/flex-grid.html",
  outPkgDir: path.join(root, "assets", "FlexGrid"),
  pkgName: "FlexGrid",
  force: true,
});
// GList 语义：同结构连续兄弟折叠为 list，item 内容运行时从 defaultItem 建项
check("flex：识别为 GList（list 计 1）", flex.report.byKind.list === 1 && flex.report.total === 3);
const flexRoot = fs.readFileSync(path.join(root, "assets", "FlexGrid", "Root.xml"), "utf8");
check(
  "flex：GList 形态（flow_hz + lineItemCount=4 + defaultItem + 8 item）",
  flexRoot.includes('layout="flow_hz"') && flexRoot.includes('lineItemCount="4"') && flexRoot.includes('defaultItem="ui://') && (flexRoot.match(/<item\/>/g) || []).length === 8,
);
check("flex：item 组件文件抽出（背景+文字）", fs.existsSync(path.join(root, "assets", "FlexGrid", "div_0_list_item.xml")) && fs.readFileSync(path.join(root, "assets", "FlexGrid", "div_0_list_item.xml"), "utf8").includes("#ff3d6b8f"));
// 回读展开：渲染器 GList 展开机制（E4）与 writer 产出闭环
const flexScene = buildScene(
  getComponent(path.join(root, "assets", "FlexGrid", "Root.xml"), { fresh: true }),
  { pkg: loadPackage(path.join(root, "assets", "FlexGrid")), root },
);
const listNode = flexScene.nodes[0];
check(
  "flex：渲染器 GList 展开 8 item",
  listNode.listItems?.length === 8 && listNode.listItems.every((li) => li.scene.nodes.some((n) => n.attrs.text === "C1")),
);

// ===== 样本 3：nested（嵌套容器 → 子组件 + 透明度 + 旋转） =====
const nested = runPipeline({
  htmlFile: "tests/fixtures/convert/nested.html",
  outPkgDir: path.join(root, "assets", "Nested"),
  pkgName: "Nested",
  force: true,
});
check("nested：容器转 component（含背景 graph 共 4 节点）", nested.report.byKind.component === 1 && nested.report.total === 4);
const nestedRoot = fs.readFileSync(path.join(root, "assets", "Nested", "Root.xml"), "utf8");
check("nested：Root 引用子组件文件", nestedRoot.includes('src="') && fs.existsSync(path.join(root, "assets", "Nested", "panel.xml")));
check("nested：透明度与旋转透传到 avatar", fs.readFileSync(path.join(root, "assets", "Nested", "panel.xml"), "utf8").includes('alpha="0.6"') && fs.readFileSync(path.join(root, "assets", "Nested", "panel.xml"), "utf8").includes('rotation="-12"'));
check("nested：容器背景 graph 落在子组件内", fs.readFileSync(path.join(root, "assets", "Nested", "panel.xml"), "utf8").includes("#ff223344"));

// ===== 确定性：重复导出产物一致 =====
const helloAgain = runPipeline({
  htmlFile: "tests/fixtures/convert/hello.html",
  outPkgDir: path.join(root, "assets", "Converted"),
  pkgName: "Converted",
  rootComponentName: "Hello.xml",
  force: true,
});
const same = hello.files.map((f) => fs.readFileSync(f, "utf8")).join("|") === helloAgain.files.map((f) => fs.readFileSync(f, "utf8")).join("|");
check("重复导出产物一致（确定性 id）", same && helloAgain.pkgId === hello.pkgId);

if (failed > 0) {
  console.error(`转换检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("转换全部检查通过");
