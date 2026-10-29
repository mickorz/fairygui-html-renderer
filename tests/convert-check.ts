import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "../src/convert/transform.js";
import { toHexColor, readPngSize } from "../src/convert/style-mapper.js";

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
check("flex：8 文字 + 8 格子背景", flex.report.total === 16 && flex.report.byKind.text === 8 && flex.report.byKind.graph === 8);
check("flex：回读坐标 0 偏差", flex.validation.ok && flex.validation.maxDx === 0 && flex.validation.maxDy === 0);

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
