import fs from "node:fs";
import path from "node:path";

// 阶段 F POC：提取 JSON（浏览器 DOM 快照）-> FairyGUI 原版格式包（package.xml + 组件 XML + 图片）
// 写入目标工程的隔离新包（不修改既有包）；渲染器可直接回读验证
// 映射范围（F 最小集）：#canvas 直接子元素的 absolute img / 带文本元素；颜色 rgb() / #hex

export interface ExtractNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "image" | "text";
  src?: string;
  text?: string;
  fontSize?: number;
  color?: string;
}

export interface ExtractData {
  canvas: { w: number; h: number };
  nodes: ExtractNode[];
}

let seed = Math.floor(Math.random() * 0x10000);
/** FairyGUI 风格资源 id：5 位小写字母数字 */
function genId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 5; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += chars[seed % chars.length];
  }
  return s;
}

/** css rgb(r, g, b) 或 #hex -> #rrggbb */
export function toHexColor(css: string | undefined): string | null {
  if (!css) return null;
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  }
  if (css.startsWith("#")) {
    const hex = css.slice(1);
    return `#${hex.padStart(6, "0").slice(-6)}`;
  }
  return null;
}

/** 读 PNG IHDR 取原始尺寸（package.xml 登记需要）；非 PNG 返回 null */
export function readPngSize(file: string): { width: number; height: number } | null {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null; // IHDR
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export interface ConvertOptions {
  /** 提取 JSON 数据 */
  extract: ExtractData;
  /** 解析节点 src 的基准目录（样本 HTML 所在目录） */
  assetBaseDir: string;
  /** 输出包目录（目标工程 assets/ 下，需为空或不存在） */
  outPkgDir: string;
  /** 包名（=输出目录名） */
  pkgName: string;
  /** 组件文件名（默认 Hello.xml） */
  componentName?: string;
}

export interface ConvertResult {
  pkgId: string;
  componentId: string;
  files: string[];
}

/** 转换：写入 package.xml + 组件 XML + 图片资源 */
export function convert(opts: ConvertOptions): ConvertResult {
  const { extract, assetBaseDir, outPkgDir, pkgName } = opts;
  const componentName = opts.componentName ?? "Hello.xml";
  if (fs.existsSync(outPkgDir)) throw new Error(`输出包目录已存在（安全边界，不覆盖既有包）: ${outPkgDir}`);

  const pkgId = genId() + genId().slice(0, 3); // 仿工程 id 的 8 位
  const componentId = genId();
  const imagesDir = path.join(outPkgDir, "images");
  fs.mkdirSync(imagesDir, { recursive: true });

  // 图片：复制 + 登记 + 节点 src 重映射
  const imageEntries: { id: string; name: string; width: number; height: number }[] = [];
  const nodeLines: string[] = [];
  let n = 0;
  for (const node of extract.nodes) {
    n++;
    const nodeId = `n${n}`;
    if (node.kind === "image") {
      const srcAbs = path.resolve(assetBaseDir, node.src ?? "");
      const name = path.basename(srcAbs);
      let entry = imageEntries.find((e) => e.name === name);
      if (!entry) {
        const id = genId();
        const size = readPngSize(srcAbs) ?? { width: node.w, height: node.h };
        entry = { id, name, ...size };
        imageEntries.push(entry);
        fs.copyFileSync(srcAbs, path.join(imagesDir, name));
      }
      nodeLines.push(
        `    <image id="${nodeId}" name="${node.id}" src="${entry.id}" xy="${node.x},${node.y}" size="${node.w},${node.h}"/>`,
      );
    } else {
      const fontSize = node.fontSize ?? 12;
      const color = toHexColor(node.color) ?? "#000000";
      nodeLines.push(
        `    <text id="${nodeId}" name="${node.id}" xy="${node.x},${node.y}" size="${node.w},${node.h}" text="${node.text?.replace(/"/g, "&quot;") ?? ""}" fontSize="${fontSize}" color="${color}" autoSize="none"/>`,
      );
    }
  }

  const imageXml = imageEntries
    .map((e) => `    <image id="${e.id}" name="${e.name}" path="/images/" width="${e.width}" height="${e.height}"/>`)
    .join("\n");

  const componentXml = `<?xml version="1.0" encoding="utf-8"?>
<component size="${extract.canvas.w},${extract.canvas.h}">
  <displayList>
${nodeLines.join("\n")}
  </displayList>
</component>`;

  const packageXml = `<?xml version="1.0" encoding="utf-8"?>
<packageDescription id="${pkgId}">
  <resources>
    <component id="${componentId}" name="${componentName}" path="/" exported="true"/>
${imageXml}
  </resources>
</packageDescription>`;

  fs.writeFileSync(path.join(outPkgDir, componentName), componentXml, "utf8");
  fs.writeFileSync(path.join(outPkgDir, "package.xml"), packageXml, "utf8");

  return {
    pkgId,
    componentId,
    files: [path.join(outPkgDir, componentName), path.join(outPkgDir, "package.xml")],
  };
}

// CLI：npx tsx src/convert/transform.ts <extract.json> <assetBaseDir> <outPkgDir> [componentName]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace(/^file:\/\/\//, "").replace(/\//g, path.sep))) {
  const [, , jsonArg, assetArg, outArg, nameArg] = process.argv;
  if (!jsonArg || !assetArg || !outArg) {
    console.error("用法: npm run convert -- <extract.json> <assetBaseDir> <outPkgDir> [componentName]");
    process.exit(1);
  }
  const result = convert({
    extract: JSON.parse(fs.readFileSync(jsonArg, "utf8")),
    assetBaseDir: path.resolve(assetArg),
    outPkgDir: path.resolve(outArg),
    pkgName: path.basename(path.resolve(outArg)),
    componentName: nameArg,
  });
  console.log(`已生成包 ${result.pkgId}: ${result.files.join(", ")}`);
}
