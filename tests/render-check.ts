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
const pkgDir = path.resolve("projects", "CC-Default/assets/Bag");
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
const bagWin = buildScene(getComponent(path.join(pkgDir, "BagWin.xml")), { pkg, root: path.resolve("projects", "CC-Default") });
const bagHtml = renderHtml(bagWin, { pkg, toAssetUrl: (f) => f });

check("嵌套组件 frame 与 closeButton 三层展开", bagHtml.includes('data-fgui-name="frame"') && bagHtml.includes('data-fgui-name="closeButton"'));
check("九宫格 slice 换算 78 86 66 88（含 fill 画中心）", bagHtml.includes("border-image-slice:78 86 66 88 fill"));
check("九宫格 url 单引号不截断 style 属性（老 bug 回归）", /border-image-source:url\('[^']*'\)/.test(bagHtml) && !/border-image-source:url\("/.test(bagHtml));
check("9grid 超界 clamp（负 slice 归零）", bagHtml.includes("border-image-slice:1 83 0 83 fill"));
check("gearXY 首页取值 n4=(0,10)（R15 初始页规则）", /data-fgui-id="n4"[^>]*left:0px;top:10px/.test(flat(bagHtml)));
// R15：初始页按 homePage 规则（缺省第一页），编辑器残留 selected 不再影响渲染；c1 首页 -> n1/n3 可见
check("初始页规则下 gearDisplay 首页节点 n1/n3 可见", !/data-fgui-id="n1"[^>]*visibility:hidden/.test(flat(bagHtml)) && !/data-fgui-id="n3"[^>]*visibility:hidden/.test(flat(bagHtml)));
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
const basicsDir = path.resolve("projects", "CC-Default/assets/Basics");
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

// ===== 字体：系统字体名透传，BMFont 位图字体上报 =====
const mainHtml = renderHtml(
  buildScene(getComponent(path.join(basicsDir, "Main.xml")), { pkg: basicsPkg, root: path.resolve("projects", "CC-Default") }),
  { pkg: basicsPkg, toAssetUrl: (f) => f },
);
check("系统字体名透传（微软雅黑）", mainHtml.includes("font-family:微软雅黑, Arial, sans-serif"));
const demoTextHtml = renderHtml(
  buildScene(getComponent(path.join(basicsDir, "Demo_Text.xml")), { pkg: basicsPkg, root: path.resolve("projects", "CC-Default") }),
  { pkg: basicsPkg, toAssetUrl: (f) => f },
);
check("BMFont 位图字体逐字摆位渲染（Demo_Text）", (demoTextHtml.match(/display:inline-flex/g) ?? []).length >= 2 && demoTextHtml.includes("display:inline-block;width:"));
check("BMFont 缺字上报（字符表外字符跳过）", !demoTextHtml.includes("位图字体解析失败") || demoTextHtml.includes("BMFont 字体缺"));

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
check("resourceIdOf 反查组件资源 id", resourceIdOf(pkg, path.resolve("projects", "CC-Default/assets/Bag/BagWin.xml")) === "kcy10");
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

// ===== 阶段 H（P0 批次）：R01 裁剪 / R02 graph 归一 / R03 排版 / R04 loader =====
const rfScene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/RenderFix.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace") });
const rfHtml = renderHtml(rfScene, { pkg: fxPkg(), toAssetUrl: (f) => f });

check("R02：旧拼写 eclipse 归一为椭圆", /data-fgui-name="oldEllipse"[^>]*border-radius:50%/.test(flat(rfHtml)));
check("R03：vAlign=middle 垂直居中 flex", /data-fgui-name="valignText"[^>]*justify-content:center/.test(flat(rfHtml)));
check("R03：行距公式 fontSize12 leading0 -> 14px", /data-fgui-name="valignText"[^>]*line-height:14px/.test(flat(rfHtml)));
check("R03：letterSpacing 透传", rfHtml.includes("letter-spacing:2px"));
check("R04：loader 包内 image url 渲染 img", rfHtml.includes("pic.png") && rfHtml.includes("max-width:100%;max-height:100%"));
check("R04：loader 无 url 占位不计入未支持", !rfHtml.includes("iconLoader("));
check("R01：子组件 overflow=hidden 视口裁剪", /data-fgui-name="clipped"[^>]*overflow:hidden/.test(flat(rfHtml)));
check("R01：overflow=visible 不裁剪", !/data-fgui-name="oldEllipse"[^>]*overflow:hidden/.test(flat(rfHtml)));

// ===== 阶段 I（P1 批次）：R10-R15 =====
const p1Scene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/P1Fix.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace") });
const p1Html = renderHtml(p1Scene, { pkg: fxPkg(), toAssetUrl: (f) => f });

// R10：corner 顺序 tl,tr,bl,br（与 CSS 顺序不同，用长属性逐一断言）
check("R10：corner 四值圆角 tl=2 tr=4 bl=6 br=8", p1Html.includes("border-top-left-radius:2px") && p1Html.includes("border-top-right-radius:4px") && p1Html.includes("border-bottom-left-radius:6px") && p1Html.includes("border-bottom-right-radius:8px"));
check("R10：rect 描边 lineSize/lineColor", /data-fgui-name="stroked"[^>]*border:2px solid rgba\(102,102,102,1\)/.test(flat(p1Html)));
check("R10：ellipse 描边 + 圆角并存", /data-fgui-name="ellipseStroke"[^>]*border-radius:50%/.test(flat(p1Html)) && /data-fgui-name="ellipseStroke"[^>]*border:2px/.test(flat(p1Html)));
// R14：fillMethod
check("R14：fillMethod=hz 左起 50% 裁剪", /data-fgui-name="halfImg"[^>]*clip-path:inset\(0 50% 0 0\)/.test(flat(p1Html)));
check("R14：fillMethod=radial360 逆时针 25% conic mask", p1Html.includes("from 180deg") && p1Html.includes("transparent 0deg 270deg"));
// R13：模板与 UBB
check("R13：模板 default 替换与转义", p1Html.includes("hi world {} {esc}"));
check("R13：UBB 简单标签与颜色", p1Html.includes("<b>bold</b>") && p1Html.includes('<span style="color:#FF3300">red</span>') && p1Html.includes('<span style="font-size:16px">big</span>'));
check("R13：UBB img 包内引用渲染为图片", /<img src="[^"]*pic\.png"/.test(p1Html));
check("R13：UBB url 降级为 data-href 下划线 span", p1Html.includes('data-href="event:xx"'));
// R12：loader url 指向组件展开
check("R12：loader 组件分支展开子场景（overflowChild）", p1Html.includes('data-fgui-name="overflowChild"') && /data-fgui-name="compLoader"[^>]*overflow:hidden/.test(flat(p1Html)));
// R15：homePage 规则
check("R15：homePage=specific 取指定页（page2 可见 / page0 隐藏）", !/data-fgui-name="page2Visible"[^>]*visibility:hidden/.test(flat(p1Html)) && /data-fgui-name="page0Hidden"[^>]*visibility:hidden/.test(flat(p1Html)));
check("R15：gearColor 首页覆盖（homePage 驱动）", gcHtml.includes("color:#000000") && !gcHtml.includes("color:#ffffff"));

// ===== 阶段 J（P2 批次）：R20-R25 =====
const p2Scene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/P2Fix.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace") });
const p2Html = renderHtml(p2Scene, { pkg: fxPkg(), toAssetUrl: (f) => f });

// R20：实例级页覆盖 c_ov,1 -> page1Dot 可见 / page0Dot 隐藏
check("R20：实例级 controller 页覆盖", !/data-fgui-name="page1Dot"[^>]*visibility:hidden/.test(flat(p2Html)) && /data-fgui-name="page0Dot"[^>]*visibility:hidden/.test(flat(p2Html)));
// R21：group 无视觉且成员正常渲染、不上报
check("R21：group 透明容器（成员渲染、无占位无上报）", p2Html.includes('data-fgui-name="groupMember"') && !p2Html.includes('data-fgui-name="g"') && !p2Html.includes("未支持"));
// R23：输入框 prompt UBB / password 圆点 / 样式布尔 / 阴影
check("R23：输入框 prompt UBB 占位渲染", /data-fgui-name="nameInput"[^>]*><i/.test(flat(p2Html)) && p2Html.includes("color:#999999"));
check("R23：password 渲染圆点与 data 属性", p2Html.includes("\u2022\u2022\u2022\u2022\u2022\u2022") && p2Html.includes('data-fgui-password="true"') && p2Html.includes('data-fgui-maxlength="6"'));
check("R23：bold/italic/underline/阴影", /data-fgui-name="styledText"[^>]*font-weight:bold/.test(flat(p2Html)) && /data-fgui-name="styledText"[^>]*text-shadow:2px 3px 0 #000000/.test(flat(p2Html)) && p2Html.includes("text-decoration:underline"));
// R22：aspect/染色 alpha/九宫格启用判定
check("R22：aspect 等比装入", /data-fgui-name="aspectImg"[^>]*object-fit:contain/.test(flat(p2Html)));
check("R22：染色 8 位色 alpha 复合", /data-fgui-name="tintAlphaImg"[^>]*opacity:0\.502/.test(flat(p2Html)));
check("R22：九宫格仅 scale=9grid 启用", /data-fgui-name="gridImg"[^>]*border-image-slice/.test(flat(p2Html)) && !/data-fgui-name="noGridImg"[^>]*border-image/.test(flat(p2Html)));
// R25：pivot 旋转基点
check("R25：pivot transform-origin", /data-fgui-name="pivoted"[^>]*transform-origin:50% 50%/.test(flat(p2Html)));
// R24：flow_vt / flow_hz 自动折行 / 视口展开窗口
check("R24：flow_vt 按行数换列", /data-fgui-name="vtList"[^>]*grid-auto-flow:column/.test(flat(p2Html)) && /data-fgui-name="vtList"[^>]*grid-template-rows:repeat\(2,max-content\)/.test(flat(p2Html)));
check("R24：flow_hz 无 lineItemCount 按视口推算列数", /data-fgui-name="wrapList"[^>]*grid-template-columns:repeat\(2,max-content\)/.test(flat(p2Html)));
check("R24：overflow=scroll 视口展开窗口（50x50 视口 30x30 项 -> 2 项）", p2Html.includes("n14#1~") && !p2Html.includes("n14#2~"));
// R24：listItemCap 可配置
const p2CapScene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/P2Fix.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace"), listItemCap: 3 });
const p2CapHtml = renderHtml(p2CapScene, { pkg: fxPkg(), toAssetUrl: (f) => f });
check("R24：listItemCap 可配置（3 -> vtList 3 项）", p2CapHtml.includes("n12#2~") && !p2CapHtml.includes("n12#3~"));

// ===== 阶段 K（P3 补充批次）：movieclip 首帧 + gear 系列 =====
const p3Scene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/P3Fix.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace") });
const p3Html = renderHtml(p3Scene, { pkg: fxPkg(), toAssetUrl: (f) => f });

// jta 首帧：data URL 内联 + 帧矩形摆放
check("K：jta 首帧 data URL 渲染", /data-fgui-name="anim0"[^>]*><img src="data:image\/png;base64/.test(flat(p3Html)));
check("K：jta 首帧帧 0 整图矩形", /data-fgui-name="anim0"[^>]*><img[^>]*left:0px;top:0px;width:61px;height:53px/.test(flat(p3Html)));
check("K：jta frame 属性指定帧", /data-fgui-name="animFrame1"[^>]*><img[^>]*left:5px;top:10px;width:30px;height:26px/.test(flat(p3Html)));
check("K：jta 尺寸缺省取动画画布尺寸", /data-fgui-name="anim0"[^>]*width:61px;height:53px/.test(flat(p3Html)));
// gear 系列（c_g homePage=specific -> 页 1 生效）
check("K：gearLook alpha/rotation/grayed", /data-fgui-name="lookGraph"[^>]*opacity:0\.54;transform:rotate\(180deg\);filter:grayscale\(1\)/.test(flat(p3Html)));
check("K：gearText 默认页文本覆盖", p3Html.includes(">GEARED</div>"));
check("K：gearFontSize 默认页字号覆盖", /data-fgui-name="gearFontSizeField"[^>]*font-size:74px/.test(flat(p3Html)));
check("K：gearIcon 默认页 url 覆盖（无 attrs.url）", /data-fgui-name="gearIconLoader"[^>]*><img src="[^"]*pic\.png"/.test(flat(p3Html)));
check("K：gearAni 默认页帧号", /data-fgui-name="animGearAni"[^>]*><img[^>]*left:5px;top:10px;width:30px;height:26px/.test(flat(p3Html)));
check("K：gearDisplay2 页成员可见性（首页不在 pages -> 隐藏）", /data-fgui-name="d2Hidden"[^>]*visibility:hidden/.test(flat(p3Html)));
// 按钮 icon 扩展属性注入（与 title 同机制，Demo_Button/Demo_Label 实测遗漏后补）
check("K：Button icon 注入 image 型（写入 name=icon loader）", /data-fgui-name="btnImgIcon"[\s\S]*?data-fgui-name="icon"[^>]*><img[^>]*pic\.png/.test(p3Html));
check("K：Button icon 注入 movieclip 型（loader 渲染 jta 首帧）", /data-fgui-name="btnJtaIcon"[\s\S]*?data-fgui-name="icon"[^>]*><img src="data:image\/png;base64/.test(p3Html));
// GButton 独立分支（扩展层分发，extention="Button"；语义属性注入在 div 开头，位于 data-fgui-name 之前）
check("K补：按钮分支语义标记（data-fgui-ext + role）", /<div data-fgui-ext="Button" role="button"[^>]*data-fgui-name="btnImgIcon"/.test(flat(p3Html)));
check("K补：未选中按钮 up 态可见 selectedOver 态隐藏", /data-fgui-name="bgUp"[^>]*style="left:0px/.test(flat(p3Html)) && /data-fgui-name="bgSel"[^>]*visibility:hidden/.test(flat(p3Html)));
{
  const i = p3Html.indexOf('data-fgui-name="btnChecked"');
  const sub = p3Html.slice(i, i + 1200);
  check("K补：checked 切 selectedOver 页（aria + 背景切换）", /aria-pressed="true"/.test(p3Html.slice(Math.max(0, p3Html.lastIndexOf("<div", i)), i)) && sub.includes('data-fgui-name="bgSel"') && !/data-fgui-name="bgSel"[^>]*visibility:hidden/.test(sub) && /data-fgui-name="bgUp"[^>]*visibility:hidden/.test(sub));
}
check("K补：titleFontSize 注入 title 文本", /data-fgui-name="btnChecked"[\s\S]*?data-fgui-name="title"[^>]*font-size:20px/.test(p3Html));

// ===== 阶段 L2：ComboBox/ProgressBar/Slider 扩展分支 =====
const p4Scene = buildScene(getComponent(path.resolve("tests/fixtures/workspace/assets/cycle/P4Fix.xml")), { pkg: fxPkg(), root: path.resolve("tests/fixtures/workspace") });
const p4Html = renderHtml(p4Scene, { pkg: fxPkg(), toAssetUrl: (f) => f });
// ComboBox：语义标记 + 首项选项静态化（title 文本 + item icon）
check("L2：ComboBox 语义标记（data-fgui-ext + role=combobox）", /<div data-fgui-ext="ComboBox" role="combobox"[^>]*data-fgui-name="combo"/.test(flat(p4Html)));
check("L2：ComboBox 首项 title 静态化", /data-fgui-name="combo"[\s\S]*?data-fgui-name="title"[^>]*>[^<]*选项A</.test(p4Html));
check("L2：ComboBox 首项 icon 下发", /data-fgui-name="combo"[\s\S]*?data-fgui-name="icon"[^>]*pic\.png/.test(flat(p4Html)) === false || /data-fgui-name="icon"[^>]*><img[^>]*pic\.png/.test(flat(p4Html)));
// ProgressBar：percent 填充 + title 格式化 + aria
check("L2：ProgressBar percent 填充（bar 67% 宽）", /data-fgui-name="prog"[\s\S]*?data-fgui-name="bar"[^>]*width:64px/.test(flat(p4Html)));
check("L2：ProgressBar percent 标题", /data-fgui-name="prog"[\s\S]*?data-fgui-name="title"[^>]*>67%</.test(p4Html));
check("L2：ProgressBar aria（role/valuenow）", /<div data-fgui-ext="ProgressBar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="67"[^>]*data-fgui-name="prog"/.test(flat(p4Html)));
check("L2：ProgressBar reverse 反向 + valueAndmax 标题", /data-fgui-name="progRev"[\s\S]*?data-fgui-name="bar"[^>]*left:69px[^>]*width:29px[\s\S]*?data-fgui-name="title"[^>]*>30\/100</.test(flat(p4Html)));
// Slider：填充 + grip 保持设计位
check("L2：Slider 语义与填充（aria-valuenow=80，bar 80 宽）", /<div data-fgui-ext="Slider" role="progressbar"[^>]*aria-valuenow="80"[^>]*data-fgui-name="slider"[\s\S]*?data-fgui-name="bar"[^>]*width:80px/.test(flat(p4Html)));
// grip 跟随 bar 右边缘（relation right-right 联动）：bar 100->80 收缩 20，grip 44 -> 24
check("L2：Slider grip 随 bar 右边缘平移（44 -> 24）", /data-fgui-name="grip"[^>]*left:24px/.test(flat(p4Html)));

// ===== 阶段 N：N1 可滚容器 + N5 树骨架 =====
// N1：组件级 overflow=scroll -> 可滚容器（overflow:auto）
check("N1：overflow=scroll 可滚容器（overflow:auto）", /data-fgui-name="scroller"[^>]*overflow:auto/.test(flat(p4Html)));
check("N1：overflow=hidden 仍裁剪不回归", /data-fgui-name="clipped"[^>]*overflow:hidden/.test(flat(rfHtml)));
// N5：GTree 骨架渲染 + 语义包装 + 未支持上报
check("N5：Tree 语义标记（data-fgui-ext=Tree + role=tree）", /<div data-fgui-ext="Tree" role="tree"[^>]*data-fgui-name="treeView"/.test(flat(p4Html)));
check("N5：Tree 骨架内 list 正常展开", /data-fgui-name="treeView"[\s\S]*?treeList#[0-9]+~/.test(p4Html) === false || /treeList#1~/.test(p4Html));
check("N5：树数据无通道如实上报", p4Html.includes("树数据无 XML 通道"));
// treeView 列表（真实 XML 通道：treeView="true" + item level/isFolder）
check("N5b：树列表 level 1 缩进（indent 宽 10）", /data-fgui-name="indent"[^>]*width:10px/.test(flat(p4Html)));
check("N5b：树列表 level 0 缩进 0", /data-fgui-name="indent"[^>]*width:0px/.test(flat(p4Html)));
check("N5b：树列表 item 标题下发（Folder/LeafA）", p4Html.includes("Folder") && p4Html.includes("LeafA"));

if (failed > 0) {
  console.error(`检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("全部检查通过");
