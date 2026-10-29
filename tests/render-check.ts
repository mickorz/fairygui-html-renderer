import path from "node:path";
import { loadPackage } from "../src/parser/package-parser.js";
import { parseComponent } from "../src/parser/component-parser.js";
import { getComponent, buildChildren } from "../src/scene/scene-builder.js";
import { renderHtml } from "../src/renderer/html-renderer.js";

// P0 最小渲染检查 + P1 嵌套/九宫格/gear 检查：断言 dot.xml 与 BagWin.xml 的关键渲染行为

const pkgDir = path.resolve("CC-Default/assets/Bag");
const comp = parseComponent(path.join(pkgDir, "dot.xml"));
const pkg = loadPackage(pkgDir);
const html = renderHtml(comp, { pkg, toAssetUrl: (f) => f });

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "[通过]" : "[失败]"} ${name}`);
  if (!ok) failed++;
}

// n23: 椭圆 graph，fillColor #ff3f5b5f -> ARGB, alpha=ff -> rgba(63,91,95,1)
check("graph 椭圆圆角", html.includes("border-radius:50%"));
check("graph 填充色 ARGB 转换", html.includes("rgba(63,91,95,1)"));
// n22: gearDisplay pages=1，controller button selected=0 -> 隐藏
check("gearDisplay 默认页隐藏 n22", /data-fgui-id="n22"[^>]*visibility:hidden/.test(html.replace(/>\s/g, ">")));
check("节点保留原始 id/name", html.includes('data-fgui-id="n23_osdo"') && html.includes('data-fgui-name="n23"'));
check("stage 尺寸 15x15", html.includes("width:15px;height:15px"));

// ===== P1: BagWin 嵌套 / 九宫格 / gear 取值 =====
const bagWin = getComponent(path.join(pkgDir, "BagWin.xml"));
buildChildren(bagWin, { pkg });
const bagHtml = renderHtml(bagWin, { pkg, toAssetUrl: (f) => f });

check("嵌套组件 frame 与 closeButton 三层展开", bagHtml.includes('data-fgui-name="frame"') && bagHtml.includes('data-fgui-name="closeButton"'));
check("九宫格 slice 换算 78 86 66 88", bagHtml.includes("border-image-slice:78 86 66 88"));
check("9grid 超界 clamp（负 slice 归零）", bagHtml.includes("border-image-slice:1 83 0 83"));
// CloseButton: button selected=3 -> n4 gearXY 页3 = 2,13；c1 selected=1 -> n1/n3 gearDisplay pages=0 隐藏
check("gearXY 默认页取值 n4=(2,13)", /data-fgui-id="n4"[^>]*left:2px;top:13px/.test(bagHtml.replace(/>\s/g, ">")));
check("嵌套内 gearDisplay 隐藏 n1/n3", /data-fgui-id="n1"[^>]*visibility:hidden/.test(bagHtml.replace(/>\s/g, ">")) && /data-fgui-id="n3"[^>]*visibility:hidden/.test(bagHtml.replace(/>\s/g, ">")));
check("未支持类型 list loader 上报", bagHtml.includes("节点类型 list 未支持") && bagHtml.includes("节点类型 loader 未支持"));

if (failed > 0) {
  console.error(`检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("全部检查通过");
