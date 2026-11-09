import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { buildScene, getComponent } from "../src/scene/scene-builder.js";
import { loadPackage } from "../src/parser/package-parser.js";
import { renderHtml } from "../src/renderer/html-renderer.js";
import { writeComponentXml, parseSemanticHtml, attrDiff } from "../src/writer/xml-writer.js";
import { diffScenes } from "../src/scene/scene-diff.js";

// XML 写出器检查（S5）：往返一致性（渲染 HTML -> 无改动写出 -> 解析模型等价）+ 属性覆盖 + 诊断
// 只读边界：写出器只产出文本；测试用临时目录验证写回后的解析等价性

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
const pkgDir = path.join(assets, "cycle");
const pkg = loadPackage(pkgDir);

// 渲染 RenderFix（含 image/graph/text/component/loader/jta 多节点形态）
const fileA = path.join(pkgDir, "RenderFix.xml");
const sceneA = buildScene(getComponent(fileA, { fresh: true }), { pkg, root });
const htmlA = renderHtml(sceneA, { pkg, toAssetUrl: () => "#" }, { bare: true });

// ===== 语义提取 =====
const sem = parseSemanticHtml(htmlA);
check("语义提取：节点数 > 5（RenderFix 多类型）", sem.nodes.length > 5, sem.nodes.length);
check("语义提取：装饰元素有跳过计数", sem.skippedDecorations > 0, sem.skippedDecorations);
check("语义提取：无 JSON 错误诊断", !sem.diagnostics.some((d) => d.level === "error"), sem.diagnostics);

// ===== 往返一致性：无改动写出 -> 解析模型等价（diff 为空） =====
const compA = getComponent(fileA, { fresh: true });
const resultA = writeComponentXml(compA, htmlA);
check("写出：应用 0 处改动", resultA.appliedChanges === 0, resultA.appliedChanges);
check("写出：无 error 诊断", !resultA.diagnostics.some((d) => d.level === "error"), resultA.diagnostics);
check("写出：XML 含根 component 与 displayList", resultA.xml.includes("<component") && resultA.xml.includes("<displayList>"));

// 写到临时文件 -> 解析 -> 与原模型 diff（结构等价）：tmp-write/assets/cycle 镜像 fixture 包
const tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp-write");
const tmpPkgDir = path.join(tmpDir, "assets", "cycle");
fs.mkdirSync(tmpPkgDir, { recursive: true });
fs.writeFileSync(path.join(tmpPkgDir, "package.xml"), fs.readFileSync(path.join(pkgDir, "package.xml"), "utf8"));
for (const f of fs.readdirSync(pkgDir)) {
  if (f.endsWith(".xml") || f.endsWith(".jta") || f.endsWith(".png") || f.endsWith(".fnt")) {
    fs.copyFileSync(path.join(pkgDir, f), path.join(tmpPkgDir, f));
  }
}
fs.writeFileSync(path.join(tmpPkgDir, "RenderFix.xml"), resultA.xml);
const wsRoot = tmpDir; // 临时工作台根（assets/cycle 结构与 fixture 对齐）
const pkg2 = loadPackage(path.join(wsRoot, "assets", "cycle"));
const roundTripped = buildScene(getComponent(path.join(wsRoot, "assets", "cycle", "RenderFix.xml"), { fresh: true }), { pkg: pkg2, root: wsRoot });
const rt = diffScenes(sceneA, roundTripped); // 基准同为构建场景（对称比较）
check(
  "往返一致性：写出 XML 解析后与原模型 diff 仅剩 component.file 路径差异（临时目录根不同，结构性零差异）",
  rt.stats.added === 0 && rt.stats.removed === 0 && rt.stats.moved === 0
    && rt.changed.every((c) => c.changes.every((ch) => ch.path === "component.file")),
  { stats: rt.stats, changed: JSON.stringify(rt.changed.slice(0, 3)) },
);

// ===== 属性覆盖：改 n5 文本与 xy -> 写出 -> 解析回读 =====
const compB = getComponent(fileA, { fresh: true });
const htmlB = htmlA
  .replace(/(<[^>]*data-fgui-id="n5"[^>]*data-fgui-attrs=')([^']*)'/, (_m, pre, json) => {
    const attrs = JSON.parse(json.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<")) as Record<string, string>;
    attrs.text = "CHANGED_TEXT";
    attrs.xy = "9,9";
    return pre + JSON.stringify(attrs).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;") + "'";
  });
const resultB = writeComponentXml(compB, htmlB);
check("覆盖：改动 2 处属性（text + xy）", resultB.appliedChanges === 2, resultB.appliedChanges);
check("覆盖：XML 含新文本", resultB.xml.includes("CHANGED_TEXT") && resultB.xml.includes('xy="9,9"'));

fs.writeFileSync(path.join(wsRoot, "assets", "cycle", "RenderFix.xml"), resultB.xml);
const roundB = getComponent(path.join(wsRoot, "assets", "cycle", "RenderFix.xml"), { fresh: true });
const node5 = roundB.nodes.find((n) => n.id === "n5");
check("覆盖回读：text/xy 生效", node5?.attrs.text === "CHANGED_TEXT" && node5?.xy[0] === 9 && node5?.xy[1] === 9, node5?.attrs);

// ===== 诊断：未知 id 与结构性边界 =====
const htmlC = htmlA.replace(/data-fgui-id="n5"/, 'data-fgui-id="zz9"');
const resultC = writeComponentXml(compB, htmlC);
check("诊断：未知 id 报 warning（不静默）", resultC.diagnostics.some((d) => d.code === "XMLW_NO_TARGET" && d.level === "warning"), resultC.diagnostics);

// ===== attrDiff 单元 =====
const ad = attrDiff({ a: "1", b: "2", c: "3" }, { a: "1", b: "X", d: "4" });
check("attrDiff：改 b 增 d 删 c", ad.set.b === "X" && ad.set.d === "4" && ad.removed.includes("c") && !("a" in ad.set), ad);

fs.rmSync(tmpDir, { recursive: true, force: true });

// ===== 真实样本往返冒烟（CC-Default：TreeView/TreeItem 含 controllers/gearDisplay/gearIcon/Button 扩展/indent 全形态） =====
{
  const realRoot = path.resolve(root, "..", "..", "..", "projects", "CC-Default");
  if (fs.existsSync(path.join(realRoot, "assets"))) {
    const realPkgDir = path.join(realRoot, "assets", "TreeView");
    const realPkg = loadPackage(realPkgDir);
    const biFile = path.join(realPkgDir, "TreeItem.xml");
    const biScene = buildScene(getComponent(biFile, { fresh: true }), { pkg: realPkg, root: realRoot });
    const biHtml = renderHtml(biScene, { pkg: realPkg, toAssetUrl: () => "#" }, { bare: true });
    const biComp = getComponent(biFile, { fresh: true });
    const biOut = writeComponentXml(biComp, biHtml);
    check("真实样本：写出无 error 诊断", !biOut.diagnostics.some((d) => d.level === "error"), biOut.diagnostics);
    check("真实样本：控制器还原（expanded/leaf 空名页）", biOut.xml.includes('name="expanded"') && biOut.xml.includes('pages="0,,1,"') && biOut.xml.includes('name="leaf"'), biOut.xml.split(String.fromCharCode(10)).slice(1, 4));
    check("真实样本：gear 还原（gearDisplay/gearIcon）", biOut.xml.includes("<gearDisplay") && biOut.xml.includes("<gearIcon"), "");
    check("真实样本：扩展元素还原（Button mode=Radio）", biOut.xml.includes('<Button mode="Radio"/>'), "");
    check("真实样本：实例注入不回写（title 注入值不进 XML 定义）", !biOut.xml.includes("Hello"), "");
    // 临时解析回读等价
    const t2 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp-write2", "assets", "Basics");
    fs.mkdirSync(t2, { recursive: true });
    for (const f of fs.readdirSync(realPkgDir)) {
      if (f.endsWith(".xml")) fs.copyFileSync(path.join(realPkgDir, f), path.join(t2, f));
    }
    // 包内子目录整体镜像（TreeItem 引用 Icons 图标资源）
    for (const d of fs.readdirSync(realPkgDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      fs.mkdirSync(path.join(t2, d.name), { recursive: true });
      for (const f of fs.readdirSync(path.join(realPkgDir, d.name))) {
        fs.copyFileSync(path.join(realPkgDir, d.name, f), path.join(t2, d.name, f));
      }
    }
    fs.writeFileSync(path.join(t2, "TreeItem.xml"), biOut.xml);
    const ws2 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp-write2");
    const pkg3 = loadPackage(t2);
    const rt2 = diffScenes(biScene, buildScene(getComponent(path.join(t2, "TreeItem.xml"), { fresh: true }), { pkg: pkg3, root: ws2 }));
    check(
      "真实样本：往返一致性（仅 component.file 路径差异）",
      rt2.stats.added === 0 && rt2.stats.removed === 0 && rt2.stats.moved === 0
        && rt2.changed.every((c) => c.changes.every((ch) => ch.path === "component.file")),
      { stats: rt2.stats, changed: JSON.stringify(rt2.changed.slice(0, 2)) },
    );
    fs.rmSync(ws2, { recursive: true, force: true });
  } else {
    console.log("[跳过] 真实样本 CC-Default 不存在");
  }
}

if (failed > 0) {
  console.error(`XML 写出器检查失败 ${failed} 项`);
  process.exit(1);
}
console.log("XML 写出器全部检查通过");
