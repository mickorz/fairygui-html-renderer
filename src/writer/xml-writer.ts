import type { ParsedComponent, ParsedNode, Gear, Controller } from "../parser/component-parser.js";

// FairyGUI 组件 XML 写出器（沿袭 egret 项目 P2-E writer 的"不猜映射"原则，适配 FairyGUI 模型）
//
// 形态：合并写出（merge）—— 语义 HTML 的属性覆盖应用到原组件解析模型上，再序列化为 XML。
//   为什么不是"从 HTML 重建 XML"：FairyGUI 组件 XML 含 gear/controller/扩展元素等丰富结构，
//   HTML 只有属性快照；从 HTML 重建会丢结构。合并模式保证未改动的部分字节级保留语义。
//
// 语义约定（与渲染器 dataAttrs 一致）：
//   1. 节点根元素携带 data-fgui-id / data-fgui-src（声明文件）/ data-fgui-attrs（原始属性 JSON 全量）
//   2. 无语义标记的元素（jta 帧图 img / BMFont 字符片 / 九宫格片）是渲染装饰，自动跳过
//   3. 只接受 data-fgui-src == 目标组件文件 的节点（展开子树属于来源文件，写回应写到来源文件）
//   4. 覆盖粒度：属性级（xy/size/text/color/...）。结构增删移不在本写出器范围（诚实报错不静默）
//
// 已知边界（明示）：
//   - 解析器未保留的根属性（bgColor/scrollBar 等 displayList 外信息）不会出现在输出中
//   - 无 id 节点不可定位（不覆盖，报 warning）
//   - XML 属性顺序 = 解析顺序（覆盖键保持原位，新增键追加）

export interface XmlWriteResult {
  /** 写出的组件 XML 文本 */
  xml: string;
  /** 参与写出的节点数（含根） */
  nodeCount: number;
  /** 跳过的装饰元素数（无语义标记） */
  skippedDecorations: number;
  /** 应用覆盖的属性数 */
  appliedChanges: number;
  diagnostics: { level: "warning" | "error"; code: string; message: string }[];
}

interface SemanticNode {
  id: string;
  file: string;
  type: string;
  attrs: Record<string, string>;
}

/** HTML 实体解码（写出器输入侧） */
function unescapeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * 语义 HTML -> 覆盖表（id -> attrs）。
 * 提取方式：正则扫描携带 data-fgui-id 的标签（渲染器产物形态；输入需为工作台/渲染器 HTML）。
 */
export function parseSemanticHtml(html: string): { nodes: SemanticNode[]; skippedDecorations: number; diagnostics: XmlWriteResult["diagnostics"] } {
  const diagnostics: XmlWriteResult["diagnostics"] = [];
  const nodes: SemanticNode[] = [];
  let skipped = 0;
  const tagRe = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attrRe = /data-fgui-(id|src|type|attrs)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tagContent = m[2] ?? "";
    if (!tagContent.includes("data-fgui-id")) {
      skipped++;
      continue;
    }
    const fields: Record<string, string> = {};
    let a: RegExpExecArray | null;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(tagContent))) {
      fields[a[1]] = unescapeEntities(a[2] ?? a[3] ?? "");
    }
    if (!fields.id) continue;
    let attrs: Record<string, string> = {};
    if (fields.attrs) {
      try {
        const parsed = JSON.parse(fields.attrs) as Record<string, unknown>;
        attrs = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
      } catch (e) {
        diagnostics.push({ level: "error", code: "XMLW_ATTRS_JSON", message: `节点 ${fields.id} 的 data-fgui-attrs 不是合法 JSON: ${(e as Error).message}` });
        continue;
      }
    }
    nodes.push({ id: fields.id, file: fields.src ?? "", type: fields.type ?? "", attrs });
  }
  return { nodes, skippedDecorations: skipped, diagnostics };
}

/** 属性覆盖差异：HTML attrs 相对原 attrs 的增/改/删（值相同的键不动） */
export function attrDiff(original: Record<string, string>, override: Record<string, string>): { set: Record<string, string>; removed: string[] } {
  const set: Record<string, string> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(override)) {
    if (original[k] !== v) set[k] = v;
  }
  for (const k of Object.keys(original)) {
    if (!(k in override)) removed.push(k);
  }
  return { set, removed };
}

// ---- XML 序列化（解析器的逆；转义 & < > " ） ----

function escXml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrList(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([k]) => k !== "") // 语义通道字段不写出
    .map(([k, v]) => ` ${k}="${escXml(v)}"`)
    .join("");
}

// kind -> 标签对照（解析侧 GEAR_KINDS 的逆；注意 gearXY 是全大写 XY）
const GEAR_TAGS: Record<Gear["kind"], string> = {
  display: "gearDisplay", display2: "gearDisplay2", xy: "gearXY", size: "gearSize",
  color: "gearColor", look: "gearLook", text: "gearText", fontSize: "gearFontSize",
  icon: "gearIcon", ani: "gearAni",
};

function gearTag(g: Gear): string {
  const tag = GEAR_TAGS[g.kind];
  const parts = [` controller="${escXml(g.controller)}"`];
  if (g.pages.length) parts.push(` pages="${escXml(g.pages.join(","))}"`);
  if (g.values !== undefined) parts.push(` values="${escXml(g.values.join("|"))}"`);
  if (g.default !== undefined) parts.push(` default="${escXml(g.default)}"`);
  return `<${tag}${parts.join("")}/>`;
}

function controllerTag(c: Controller): string {
  // pages = id,name 交替（与解析侧对称：pageIds/pageNames 成对还原）
  const pages = c.pageIds.map((id, i) => `${id},${c.pageNames[i] ?? ""}`).join(",");
  return `<controller name="${escXml(c.name)}" pages="${escXml(pages)}"${c.selected !== undefined ? ` selected="${escXml(c.selected)}"` : ""}/>`;
}

/**
 * 节点序列化（attrs 允许被覆盖表替换；子元素 = gears + 扩展元素 + list items）。
 * 结构化字段（name/xy/size/src）覆盖生效：覆盖值回填到节点视图再序列化。
 */
function nodeTag(n: ParsedNode, overrides: Map<string, Record<string, string>>): string {
  const ov = overrides.get(n.id);
  const num2 = (v: string | undefined): [number, number] | undefined => {
    if (v === undefined) return undefined;
    const [a, b] = v.split(",").map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined;
  };
  const eff: ParsedNode = { ...n };
  if (ov?.name !== undefined) eff.name = ov.name;
  if (ov?.xy !== undefined) eff.xy = num2(ov.xy) ?? n.xy;
  if (ov?.size !== undefined) eff.size = num2(ov.size) ?? n.size;
  if (ov?.src !== undefined) eff.src = ov.src;
  const attrs: Record<string, string> = { ...n.attrs, ...(ov ?? {}) };
  // 解析器抽出的结构化字段按 XML 原位回填（id/name/xy/size/src 属于属性；以 effective 视图为准）
  attrs.id = eff.id;
  attrs.name = eff.name;
  attrs.xy = eff.xy.join(",");
  if (eff.size) attrs.size = eff.size.join(",");
  if (eff.src) attrs.src = eff.src;
  const inner: string[] = [];
  for (const g of n.gears) inner.push(`      ${gearTag(g)}`);
  // 扩展设置子元素（如 <Button title=".."/>；item 子元素归位）
  for (const [tag, props] of Object.entries(n.extensionProps ?? {})) {
    inner.push(`      <${tag}${attrList(props)}/>`);
  }
  for (const item of n.items ?? []) {
    inner.push(`      <item${attrList(item)}/>`);
  }
  // list itemCount：item 子元素数与 itemCount 同源（items 为空但 itemCount 存在时还原 item 空标签）
  if (n.type === "list" && n.itemCount !== undefined && !(n.items?.length)) {
    for (let i = 0; i < n.itemCount; i++) inner.push("      <item/>");
  }
  if (inner.length) {
    return `    <${n.type}${attrList(attrs)}>\n${inner.join("\n")}\n    </${n.type}>`;
  }
  return `    <${n.type}${attrList(attrs)}/>`;
}

/**
 * 合并写出：语义 HTML 的属性覆盖应用到组件解析模型 -> XML 文本。
 * 只读边界：不写文件系统，只产出文本。
 */
export function writeComponentXml(comp: ParsedComponent, html: string): XmlWriteResult {
  const { nodes, skippedDecorations, diagnostics } = parseSemanticHtml(html);
  const targetFile = comp.file.split("\\").join("/").split("/").pop() ?? comp.file;
  // 覆盖表：仅接受声明文件 == 目标组件文件的节点（展开子树属于来源文件）
  const overrides = new Map<string, Record<string, string>>();
  const seenIds = new Set<string>();
  let appliedChanges = 0;
  let nodeCount = 0;

  // 全树 id 索引（含重复检测：同 id 重复出现不覆盖，保守报错）
  const byId = new Map<string, ParsedNode>();
  const dupIds = new Set<string>();
  const walk = (list: ParsedNode[]): void => {
    for (const n of list) {
      if (byId.has(n.id)) dupIds.add(n.id);
      else byId.set(n.id, n);
      walk(n.childComp ? n.childComp.comp.nodes : []);
      if (!n.childComp) nodeCount++;
    }
  };
  walk(comp.nodes);

  for (const sn of nodes) {
    if (sn.file && !sn.file.endsWith(targetFile)) continue; // 展开子树节点：属于来源文件，本文件不写
    const target = byId.get(sn.id);
    if (!target) {
      diagnostics.push({ level: "warning", code: "XMLW_NO_TARGET", message: `HTML 节点 ${sn.id} 在组件中无同 id 节点（可能属于展开子树或已删除），跳过` });
      continue;
    }
    if (dupIds.has(sn.id)) {
      diagnostics.push({ level: "error", code: "XMLW_DUP_ID", message: `节点 id ${sn.id} 在组件内重复，无法唯一定位，跳过` });
      continue;
    }
    if (seenIds.has(sn.id)) continue;
    seenIds.add(sn.id);
    const { set, removed } = attrDiff(target.attrs, sn.attrs);
    if (!Object.keys(set).length && !removed.length) continue;
    const merged: Record<string, string> = { ...target.attrs, ...set };
    for (const k of removed) delete merged[k];
    // 结构化字段（id/name/xy/size/src）由序列化层强制回填，覆盖表的删除对它们无效
    overrides.set(sn.id, merged);
    appliedChanges += Object.keys(set).length + removed.length;
  }

  const rootAttrs: Record<string, string> = { size: comp.size.join(",") };
  if (comp.overflow !== undefined) rootAttrs.overflow = comp.overflow;
  if (comp.extension !== undefined) rootAttrs.extention = comp.extension;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push(`<component${attrList(rootAttrs)}>`);
  for (const c of comp.controllers) lines.push(`  ${controllerTag(c)}`);
  if (comp.nodes.length) {
    lines.push("  <displayList>");
    for (const n of comp.nodes) lines.push(nodeTag(n, overrides));
    lines.push("  </displayList>");
  }
  for (const [tag, props] of Object.entries(comp.rootExtension ?? {})) {
    lines.push(`  <${tag}${attrList(props)}/>`);
  }
  lines.push("</component>");
  return { xml: `${lines.join("\n")}\n`, nodeCount: nodeCount + 1, skippedDecorations, appliedChanges, diagnostics };
}
