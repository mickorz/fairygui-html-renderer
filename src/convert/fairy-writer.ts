import fs from "node:fs";
import path from "node:path";
import type { FGNode } from "./style-mapper.js";
import { readPngSize } from "./style-mapper.js";

// fairy-writer（阶段 G）：FGNode 树 -> FairyGUI 原版格式包
// 确定性 id：djb2 内容哈希 base36 取 5 位——同内容同 id，重复导出资源不冲突
// 安全边界：输出目录已存在时拒绝写入（隔离新包，不覆盖既有包）

/** 容器节点引用的子组件文件 */
export interface ComponentFile {
  name: string;
  xml: string;
}

export interface WriteResult {
  pkgId: string;
  files: string[];
  components: ComponentFile[];
}

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor((h / Math.pow(36, i)) % 36)];
  return out;
}

interface ImageEntry {
  id: string;
  name: string;
  width: number;
  height: number;
}

interface WriteState {
  /** 包 id（前置生成：list 的 defaultItem ui:// 引用需要） */
  pkgId: string;
  /** 图片 src 的解析基准目录（样本 HTML 所在目录） */
  htmlDir: string;
  /** 组件 XML 的写盘目录（输出包目录） */
  outDir: string;
  imagesDir: string;
  images: Map<string, ImageEntry>;
  components: ComponentFile[];
  idByFile: Map<string, string>;
}

function nodeXml(node: FGNode, state: WriteState, componentRefs: { name: string }[]): string {
  const geom = `xy="${node.x},${node.y}" size="${node.w},${node.h}"`;
  const extra: string[] = [];
  if (node.alpha !== undefined) extra.push(`alpha="${node.alpha}"`);
  if (node.rotation !== undefined) extra.push(`rotation="${node.rotation}"`);
  const suffix = extra.length ? " " + extra.join(" ") : "";

  switch (node.kind) {
    case "image": {
      const srcAbs = path.resolve(state.htmlDir, node.src ?? "");
      const name = path.basename(srcAbs);
      let entry = state.images.get(name);
      if (!entry) {
        const size = readPngSize(srcAbs) ?? { width: node.w, height: node.h };
        entry = { id: hashId(name + size.width + size.height), name, ...size };
        state.images.set(name, entry);
        fs.mkdirSync(state.imagesDir, { recursive: true });
        fs.copyFileSync(srcAbs, path.join(state.imagesDir, name));
      }
      return `    <image id="n${name}" name="${node.name}" src="${entry.id}" ${geom} fileName="images/${name}"${suffix}/>`;
    }
    case "text": {
      const text = (node.text ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const stroke = node.strokeColor ? ` strokeColor="${node.strokeColor}" strokeSize="${node.strokeSize ?? 2}"` : "";
      return `    <text id="n${node.name}" name="${node.name}" ${geom} text="${text}" fontSize="${node.fontSize ?? 12}" color="${node.color ?? "#000000"}"${stroke}${suffix}/>`;
    }
    case "graph": {
      return `    <graph id="n${node.name}" name="${node.name}" ${geom} type="none" lineSize="0" fillColor="${argb(node.fillColor ?? "#808080")}"${suffix}/>`;
    }
    case "component": {
      // 子组件：children 递归成独立组件文件，父节点引用
      const child = childComponent(state, node);
      componentRefs.push({ name: child });
      return `    <component id="n${node.name}" name="${node.name}" src="${state.idByFile.get(child)}" ${geom}${suffix}/>`;
    }
    case "list": {
      // GList：defaultItem 抽成 item 组件文件，静态包登记 item 数（内容运行时建项，SDK ListSource 语义）
      const itemNodes = node.defaultItemNodes ?? [];
      const itemCompName = `${node.name}_item.xml`;
      // item 组件尺寸 = defaultItem 节点自身尺寸（GList 语义：item 尺寸由 defaultItem 决定）
      const itemSizeNode = itemNodes[0];
      const itemComponent: FGNode = {
        kind: "component",
        name: `${node.name}_item`,
        x: 0,
        y: 0,
        w: itemSizeNode?.w ?? node.w,
        h: itemSizeNode?.h ?? node.h,
        children: itemNodes,
      };
      childComponent(state, itemComponent);
      const itemId = state.idByFile.get(itemCompName)!;
      const items = Array.from({ length: node.count ?? 0 }, () => "      <item/>").join("\n");
      return `    <list id="n${node.name}" name="${node.name}" ${geom} layout="${node.layout ?? "column"}"${node.lineItemCount ? ` lineItemCount="${node.lineItemCount}"` : ""} overflow="scroll" defaultItem="ui://${state.pkgId}${itemId}">
${items}
    </list>`;
    }
  }
}

function argb(hex: string): string {
  return "#" + "ff" + hex.replace("#", "");
}

/** 把 FGNode 子树生成为组件文件（容器 -> 组件 XML），返回文件名 */
function childComponent(state: WriteState, node: FGNode): string {
  const fileName = `${node.name}.xml`;
  if (state.idByFile.has(fileName)) return fileName; // 同名容器复用同一组件定义

  const children = node.children ?? [];
  const lines: string[] = [];
  const refs: { name: string }[] = [];
  let i = 0;
  for (const c of children) {
    // 子组件文件的 displayList 坐标相对容器
    const shifted = { ...c, x: c.x, y: c.y };
    lines.push(nodeXml(shifted, state, refs).replace(/^    <(\w+) id="n[^"]*"/, (_m, tag) => `    <${tag} id="n${++i}"`));
  }
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<component size="${node.w},${node.h}">
  <displayList>
${lines.join("\n")}
  </displayList>
</component>`;
  fs.writeFileSync(path.join(state.outDir, fileName), xml, "utf8");
  const id = hashId(fileName + xml.length);
  state.components.push({ name: fileName, xml });
  state.idByFile.set(fileName, id);
  // 递归处理孙级容器（其 nodeXml 已写入 state.components）
  void refs;
  return fileName;
}

export function writePackage(
  outPkgDir: string,
  pkgName: string,
  opts: { rootNodes: FGNode[]; canvas: { w: number; h: number }; htmlDir: string; rootComponentName?: string },
): WriteResult {
  if (fs.existsSync(outPkgDir)) throw new Error(`输出包目录已存在（安全边界，不覆盖既有包）: ${outPkgDir}`);
  fs.mkdirSync(outPkgDir, { recursive: true });

  const pkgId = hashId(pkgName) + hashId(pkgName + "pkg").slice(0, 3);
  const state: WriteState = {
    pkgId,
    htmlDir: opts.htmlDir,
    outDir: outPkgDir,
    imagesDir: path.join(outPkgDir, "images"),
    images: new Map(),
    components: [],
    idByFile: new Map(),
  };

  const rootName = opts.rootComponentName ?? "Root.xml";
  state.idByFile.set(rootName, hashId(rootName));

  // 1. 先生成根组件 XML（其中子容器会递归写出各自的组件文件）
  const lines: string[] = [];
  let i = 0;
  const pending: FGNode[] = opts.rootNodes;
  for (const node of pending) {
    if (node.kind === "component") {
      const fileName = childComponent(state, node);
      const id = state.idByFile.get(fileName)!;
      lines.push(`    <component id="n${++i}" name="${node.name}" src="${id}" xy="${node.x},${node.y}" size="${node.w},${node.h}"${node.alpha !== undefined ? ` alpha="${node.alpha}"` : ""}${node.rotation !== undefined ? ` rotation="${node.rotation}"` : ""}/>`);
      continue;
    }
    const refs: { name: string }[] = [];
    lines.push(nodeXml(node, state, refs).replace(/^    <(\w+) id="n[^"]*"/, (_m, tag) => `    <${tag} id="n${++i}"`));
    void refs;
  }

  const rootXml = `<?xml version="1.0" encoding="utf-8"?>
<component size="${opts.canvas.w},${opts.canvas.h}">
  <displayList>
${lines.join("\n")}
  </displayList>
</component>`;
  fs.writeFileSync(path.join(outPkgDir, rootName), rootXml, "utf8");
  const rootId = hashId(rootName + rootXml.length);

  // 2. 子组件资源登记（childComponent 已把文件写盘）
  const compEntries = state.components
    .map((c) => `    <component id="${state.idByFile.get(c.name)}" name="${c.name}" path="/" exported="true"/>`)
    .join("\n");
  const imgEntries = [...state.images.values()]
    .map((e) => `    <image id="${e.id}" name="${e.name}" path="/images/" width="${e.width}" height="${e.height}"/>`)
    .join("\n");

  const packageXml = `<?xml version="1.0" encoding="utf-8"?>
<packageDescription id="${pkgId}">
  <resources>
    <component id="${rootId}" name="${rootName}" path="/" exported="true"/>
${compEntries}
${imgEntries}
  </resources>
</packageDescription>`;
  fs.writeFileSync(path.join(outPkgDir, "package.xml"), packageXml, "utf8");

  const files = [path.join(outPkgDir, rootName), path.join(outPkgDir, "package.xml"), ...state.components.map((c) => path.join(outPkgDir, c.name))];
  return { pkgId, files, components: state.components };
}
