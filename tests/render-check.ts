import path from "node:path";
import { loadPackage } from "../src/parser/package-parser.js";
import { parseComponent } from "../src/parser/component-parser.js";
import { renderHtml } from "../src/renderer/html-renderer.js";

// P0 最小渲染检查：断言 dot.xml 的关键渲染行为

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

if (failed > 0) {
  console.error(`检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("全部检查通过");
