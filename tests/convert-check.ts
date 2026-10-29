import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { convert, readPngSize, toHexColor } from "../src/convert/transform.js";
import { loadPackage } from "../src/parser/package-parser.js";
import { getComponent, buildScene } from "../src/scene/scene-builder.js";
import { renderHtml } from "../src/renderer/html-renderer.js";

// 阶段 F 验收：HTML -> FairyGUI XML 转换确定性 + 实际产物（Converted 包）渲染回读一致性
// 运行：npm run check:convert

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "[通过]" : "[失败]"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failed++;
}

const extract = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/convert/hello.extract.json"), "utf8"));

// ===== 单元：颜色与 PNG 尺寸 =====
check("rgb 颜色转 hex", toHexColor("rgb(255, 214, 102)") === "#ffd666");
check("缩写 hex 补全", toHexColor("#abc") === "#000abc");
check("PNG IHDR 尺寸读取", JSON.stringify(readPngSize(path.resolve("tests/fixtures/convert/images/pic.png"))) === '{"width":61,"height":53}');

// ===== 转换确定性（临时目录，不触碰目标工程） =====
const tmpOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fairygui-convert-check-")), "Converted");
const result = convert({ extract, assetBaseDir: path.resolve("tests/fixtures/convert"), outPkgDir: tmpOut, pkgName: "Converted" });
const pkgXml = fs.readFileSync(path.join(tmpOut, "package.xml"), "utf8");
const helloXml = fs.readFileSync(path.join(tmpOut, "Hello.xml"), "utf8");
check("package.xml 登记 component 与 image（含原始尺寸）", pkgXml.includes('<component id="' + result.componentId + '" name="Hello.xml" path="/" exported="true"/>') && pkgXml.includes('width="61" height="53"'));
check("组件 XML 节点坐标与样式", helloXml.includes('xy="24,20" size="183,158"') && helloXml.includes('text="Converted Title" fontSize="18" color="#ffd666"'));
check("图片已复制", fs.existsSync(path.join(tmpOut, "images", "pic.png")));
// 安全边界：已存在目录拒绝写入
let rejected = false;
try {
  convert({ extract, assetBaseDir: path.resolve("tests/fixtures/convert"), outPkgDir: tmpOut, pkgName: "Converted" });
} catch {
  rejected = true;
}
check("拒绝覆盖已存在包目录", rejected);

// ===== 实际产物回读一致性（CC-Default/assets/Converted） =====
const convDir = path.resolve("CC-Default/assets/Converted");
check("目标工程隔离包已生成", fs.existsSync(path.join(convDir, "package.xml")));
const pkg = loadPackage(convDir);
const scene = buildScene(getComponent(path.join(convDir, "Hello.xml"), { fresh: true }), { pkg, root: path.resolve("CC-Default") });
const html = renderHtml(scene, { pkg, toAssetUrl: (f) => f }, { bare: true });
check("回读节点数与画布尺寸", scene.nodes.length === 3 && scene.size[0] === 400 && scene.size[1] === 300);
check(
  "回读内容与提取一致（文本/颜色/坐标）",
  html.includes("Converted Title") && html.includes("color:#ffd666") && /data-fgui-id="n1"[^>]*left:24px;top:20px/.test(html.replace(/>\s/g, ">")),
);
check("回读图片资源有效", fs.existsSync(path.join(convDir, "images", "pic.png")));

if (failed > 0) {
  console.error(`转换检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("转换全部检查通过");
