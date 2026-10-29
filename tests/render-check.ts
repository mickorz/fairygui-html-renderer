import path from "node:path";
import { loadPackage, resourceIdOf } from "../src/parser/package-parser.js";
import { parseComponent } from "../src/parser/component-parser.js";
import { getComponent, buildScene, clearCache } from "../src/scene/scene-builder.js";
import { renderHtml } from "../src/renderer/html-renderer.js";

// 回归检查：P0/P1/P2 既有断言 + 阶段 A 数据结构修正（有序解析/缓存分离/唯一键/失效接口）

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "[通过]" : "[失败]"} ${name}`);
  if (!ok) failed++;
}

/** 统一 DOM 属性顺序差异：去掉标签间空白便于正则跨属性匹配 */
function flat(html: string): string {
  return html.replace(/>\s/g, ">");
}

// ===== P0：dot.xml 最小渲染 =====
const pkgDir = path.resolve("CC-Default/assets/Bag");
const pkg = loadPackage(pkgDir);
const dotHtml = renderHtml(
  buildScene(parseComponent(path.join(pkgDir, "dot.xml")), { pkg }),
  { pkg, toAssetUrl: (f) => f },
);

// n23: 椭圆 graph，fillColor #ff3f5b5f -> ARGB, alpha=ff -> rgba(63,91,95,1)
check("graph 椭圆圆角", dotHtml.includes("border-radius:50%"));
check("graph 填充色 ARGB 转换", dotHtml.includes("rgba(63,91,95,1)"));
// n22: gearDisplay pages=1，controller button selected=0 -> 隐藏
check("gearDisplay 默认页隐藏 n22", /data-fgui-id="n22"[^>]*visibility:hidden/.test(flat(dotHtml)));
check("节点保留原始 id/name", dotHtml.includes('data-fgui-id="n23_osdo"') && dotHtml.includes('data-fgui-name="n23"'));
check("stage 尺寸 15x15", dotHtml.includes("width:15px;height:15px"));

// ===== P1：BagWin 嵌套 / 九宫格 / gear 取值 =====
const bagWin = buildScene(getComponent(path.join(pkgDir, "BagWin.xml")), { pkg, root: path.resolve("CC-Default") });
const bagHtml = renderHtml(bagWin, { pkg, toAssetUrl: (f) => f });

check("嵌套组件 frame 与 closeButton 三层展开", bagHtml.includes('data-fgui-name="frame"') && bagHtml.includes('data-fgui-name="closeButton"'));
check("九宫格 slice 换算 78 86 66 88", bagHtml.includes("border-image-slice:78 86 66 88"));
check("9grid 超界 clamp（负 slice 归零）", bagHtml.includes("border-image-slice:1 83 0 83"));
check("gearXY 默认页取值 n4=(2,13)", /data-fgui-id="n4"[^>]*left:2px;top:13px/.test(flat(bagHtml)));
check("嵌套内 gearDisplay 隐藏 n1/n3", /data-fgui-id="n1"[^>]*visibility:hidden/.test(flat(bagHtml)) && /data-fgui-id="n3"[^>]*visibility:hidden/.test(flat(bagHtml)));
// ===== 阶段 E：BagWin 未支持清单清零 + title 注入 + list 展开 + 描边（取代旧的 list/loader 未支持断言） =====
check("阶段 E：BagWin 未支持清单清零", !bagHtml.includes("未支持"));
check("阶段 E：标题注入 Bag（覆盖默认窗口标题）", bagHtml.includes(">Bag</div>") && !bagHtml.includes("窗口标题"));
check("阶段 E：标题描边 -webkit-text-stroke", bagHtml.includes("-webkit-text-stroke:2px #000000"));
check("阶段 E：list 静态展开首尾 item 实例", bagHtml.includes('data-fgui-key="rbw1tv9t.kcy10.n8#0~rbw1tv9t.jlmg7.') && bagHtml.includes("n8#19~rbw1tv9t.jlmg7."));
check("阶段 E：row 布局页签 list（3 个 dot）", bagHtml.includes("n25_osdo#2~rbw1tv9t.osdok"));
check("阶段 E：loader 占位不再上报", bagHtml.includes(">Loader</div>"));

// ===== P2：实例路径与选择器 =====
check("实例路径三层嵌套 BagWin.frame.closeButton.n4", bagHtml.includes('data-fgui-path="BagWin.frame.closeButton.n4"'));
check("顶层节点路径 BagWin.frame", bagHtml.includes('data-fgui-path="BagWin.frame"'));
check("选择器脚本与信息栏注入", bagHtml.includes('id="fgui-info"') && bagHtml.includes("fgui-select"));
check("所有节点均带实例路径", (bagHtml.match(/data-fgui-path=/g) || []).length >= 15);

// ===== A1：displayList 有序解析（z 序正确性） =====
const basicsDir = path.resolve("CC-Default/assets/Basics");
const basicsPkg = loadPackage(basicsDir);
// Demo_Image：XML 顺序 n11(text) 在 n12(image) 之前——DOM 中 n12 必须位于 n11 之后
const demoHtml = renderHtml(
  buildScene(getComponent(path.join(basicsDir, "Demo_Image.xml")), { pkg: basicsPkg }),
  { pkg: basicsPkg, toAssetUrl: (f) => f },
);
check("混排 z 序：n12 渲染在 n11 之后", demoHtml.indexOf('data-fgui-id="n12"') > demoHtml.indexOf('data-fgui-id="n11"'));
// 更强的顺序校验：XML displayList 全序 [n6,n7,n8,n9,n11,n12,n14,n15,n16,n17,n18,n19]
const order = ["n6", "n7", "n8", "n9", "n11", "n12", "n14", "n15", "n16", "n17", "n18", "n19"];
const positions = order.map((id) => demoHtml.indexOf(`data-fgui-id="${id}"`));
check("displayList 全序保持（12 节点）", positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])));

// ===== A2：构建与缓存分离 =====
const aComp = getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleA.xml"));
const a1 = buildScene(aComp, { pkg: fxPkg() });
function fxPkg() {
  return loadPackage(path.resolve("tests/fixtures/workspace/assets/cycle"));
}
// A -> B 正常展开，B 内引用 A 标记循环
const toB = a1.nodes.find((n) => n.name === "toB");
check("循环引用标记写入构建副本", !!toB?.childComp && toB.childComp.comp.nodes[0].unsupported?.includes("循环引用") === true);
// 重复构建幂等：两次构建产物一致
const a2 = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleA.xml")), { pkg: fxPkg() });
check("重复构建幂等", JSON.stringify(a1) === JSON.stringify(a2));
// 缓存内原始解析结果无残留（未被 buildScene 污染）
check("缓存原始树未被污染", aComp.nodes.every((n) => !n.unsupported && !n.childComp));
// 不同入口：直接构建 B，其引用 A 正常展开，A 内引用 B 标记循环（视角隔离）
const b1 = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleB.xml")), { pkg: fxPkg() });
check("不同入口构建不受残留影响", !!b1.nodes[0].childComp && b1.nodes[0].childComp.comp.nodes[0].unsupported?.includes("循环引用") === true);

// ===== A3：唯一实例键 =====
// BagWin(kcy10) > frame(dwwc3=WindowFrame) > closeButton(dwwc4=CloseButton) > n4
const n4Key = "rbw1tv9t.kcy10.n7~rbw1tv9t.dwwc3.n2~rbw1tv9t.dwwc4.n4";
check("实例链稳定键三层穿透", bagHtml.includes(`data-fgui-key="${n4Key}"`));
// 同名节点：Dup.xml 两个 name="dup"（id 不同）-> 键不同
const dupHtml = renderHtml(
  buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/Dup.xml")), { pkg: fxPkg() }),
  { pkg: fxPkg(), toAssetUrl: (f) => f },
);
check("同名节点键不同", dupHtml.includes('data-fgui-key="test01.c_c.d1"') && dupHtml.includes('data-fgui-key="test01.c_c.d2"'));
check("可读 path 与稳定键并存", dupHtml.includes('data-fgui-path="Dup.dup"') && (dupHtml.match(/data-fgui-key=/g) || []).length >= 2);
// resourceIdOf 反查
check("resourceIdOf 反查组件资源 id", resourceIdOf(pkg, path.resolve("CC-Default/assets/Bag/BagWin.xml")) === "kcy10");
check("cycle 包结构就位（workspace/assets 布局）", fxPkg().id === "test01");

// ===== A4：缓存失效接口 =====
const cached1 = getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleA.xml"));
clearCache();
const cached2 = getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleA.xml"));
check("clearCache 后重新解析（新对象）", cached1 !== cached2);
const fresh1 = getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleA.xml"));
const fresh2 = getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/CycleA.xml"), { fresh: true });
check("fresh 选项绕过缓存", fresh1 !== fresh2);

// ===== 阶段 E：gearColor 默认页覆盖（c1 selected=1 -> 文本变黑） =====
const gcScene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/GearColorText.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace") });
const gcHtml = renderHtml(gcScene, { pkg: fxPkg(), toAssetUrl: (f) => f });
check("gearColor 默认页覆盖颜色", gcHtml.includes("color:#000000") && !gcHtml.includes("color:#ffffff"));

if (failed > 0) {
  console.error(`检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("全部检查通过");
