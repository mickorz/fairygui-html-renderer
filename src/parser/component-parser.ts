import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { FairyPackage, ImageResource, OtherResource } from "./package-parser.js";
import type { BitmapFontResolved } from "./fnt.js";

// FairyGUI 组件 XML 解析（有序模式）
// A1：使用 preserveOrder 保留 displayList 原始混排顺序——绘制层级（z 序）依赖 XML 顺序，
// 不能按标签聚合（聚合会让同类节点全部前置，破坏遮挡关系）。

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

export interface Gear {
  kind: "display" | "display2" | "xy" | "size" | "color" | "look" | "text" | "fontSize" | "icon" | "ani";
  controller: string;
  /** 页 id 列表，与 values 一一对应 */
  pages: string[];
  /** 每页值；"-" 表示该页无变化（用 default）。display 类型无 values */
  values?: string[];
  /** 无匹配页时的值 */
  default?: string;
}

export interface ParsedNode {
  /** FairyGUI 节点类型：image / text / graph / component / list / loader / jta ... */
  type: string;
  id: string;
  name: string;
  xy: [number, number];
  size?: [number, number];
  /** 资源引用 id（image/component/loader 等使用） */
  src?: string;
  /** 其余原始属性 */
  attrs: Record<string, string>;
  /** 节点上的 gearXxx 子元素 */
  gears: Gear[];
  /** component 节点的扩展设置子元素（如 <Label title="Bag"/> -> { Label: { title: "Bag" } }） */
  extensionProps?: Record<string, Record<string, string>>;
  /** list 节点的 item 子元素数量 */
  itemCount?: number;
  /** list 节点 item 子元素的原始属性（title/icon 等，逐项下发用） */
  items?: Record<string, string>[];
  /** list 节点按 defaultItem 展开的 item 场景副本（由 buildScene 填充，各项携带自身包） */
  listItems?: { index: number; scene: ParsedComponent; pkg: FairyPackage }[];
  /** list 单个 item 的尺寸（渲染 wrapper 需要：子节点 absolute 不贡献尺寸） */
  defaultItemSize?: { w: number; h: number };
  /** component 节点递归展开后的子组件（由 scene-builder 构建填充） */
  childComp?: { file: string; comp: ParsedComponent };
  /** loader 节点 url 指向包内 image 的解析结果（由 scene-builder 构建填充） */
  loaderRes?: ImageResource | OtherResource;
  /** 构建期解析的 BMFont 位图字体（ui:// font 属性，字符 -> 图文件表） */
  bitmapFont?: BitmapFontResolved;
  /** list 静态展开项（E4） */
  /** 实例路径（如 BagWin.frame.n2），构建时由 buildScene 填充 */
  instancePath?: string;
  /** 稳定键（实例链 pkgId.resId.nodeId~...），构建时由 buildScene 填充，同资源多实例/同名节点可区分 */
  stableKey?: string;
  /** P0/P1 未支持的类型/属性原因（渲染时占位并上报） */
  unsupported?: string;
}

export interface Controller {
  name: string;
  pageIds: string[];
  /** 页名与 pageIds 同长对齐（奇数位；Button 状态页按页名映射用，如 selectedOver） */
  pageNames: string[];
  selected: string;
}

export interface ParsedComponent {
  file: string;
  size: [number, number];
  /** 组件级溢出策略：visible / hidden / scroll（hidden/scroll 需裁剪视口） */
  overflow?: string;
  /** 组件扩展类型（Button/Label/ComboBox 等） */
  extension?: string;
  controllers: Controller[];
  /** displayList 节点，保持 XML 原始顺序 */
  nodes: ParsedNode[];
}

// ---- preserveOrder 输出的遍历辅助 ----
// 每个元素形如 { 标签名: 子内容 }，属性挂在同对象 { ":@": { 属性名: 值 } }

type OrderItem = Record<string, unknown>;

function tagOf(item: OrderItem): string {
  return Object.keys(item).find((k) => k !== ":@") ?? "";
}

function attrsOf(item: OrderItem): Record<string, string> {
  const a = (item[":@"] as Record<string, string> | undefined) ?? {};
  // 数字字符引用解码（fast-xml-parser 不解码 &#xA; 等；命名实体已由其处理）
  for (const k of Object.keys(a)) {
    a[k] = a[k].replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)));
  }
  return a;
}

function childrenOf(item: OrderItem, tag: string): OrderItem[] {
  const v = item[tag];
  return Array.isArray(v) ? (v as OrderItem[]) : [];
}

function findAll(items: OrderItem[], tag: string): OrderItem[] {
  return items.filter((i) => tagOf(i) === tag);
}

function findFirst(items: OrderItem[], tag: string): OrderItem | undefined {
  return items.find((i) => tagOf(i) === tag);
}

function parsePair(s: string | undefined): [number, number] | undefined {
  if (s === undefined) return undefined;
  const parts = s.split(",").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

const KNOWN_TYPES = new Set(["image", "text", "richtext", "inputtext", "graph", "group", "component", "list", "loader", "jta"]);
const GEAR_KINDS: { tag: string; kind: Gear["kind"] }[] = [
  { tag: "gearDisplay", kind: "display" },
  { tag: "gearDisplay2", kind: "display2" },
  { tag: "gearXY", kind: "xy" },
  { tag: "gearSize", kind: "size" },
  { tag: "gearColor", kind: "color" },
  { tag: "gearLook", kind: "look" },
  { tag: "gearText", kind: "text" },
  { tag: "gearFontSize", kind: "fontSize" },
  { tag: "gearIcon", kind: "icon" },
  { tag: "gearAni", kind: "ani" },
];

/** component 节点上的扩展设置子元素：<Label title="Bag"/> -> { Label: { title: "Bag" } } */
function parseExtensionProps(inner: OrderItem[]): Record<string, Record<string, string>> | undefined {
  const props: Record<string, Record<string, string>> = {};
  for (const item of inner) {
    const tag = tagOf(item);
    if (!tag || tag === ":@" || tag.startsWith("gear")) continue;
    props[tag] = attrsOf(item);
  }
  return Object.keys(props).length ? props : undefined;
}

/** 解析节点内容数组中的 gearXxx 子元素 */
function parseGears(inner: OrderItem[]): Gear[] {
  const gears: Gear[] = [];
  for (const g of inner) {
    const tag = tagOf(g);
    const spec = GEAR_KINDS.find((k) => k.tag === tag);
    if (!spec) continue;
    const a = attrsOf(g);
    gears.push({
      kind: spec.kind,
      controller: a.controller ?? "",
      pages: String(a.pages ?? "").split(",").filter((v) => v !== ""),
      values: a.values !== undefined ? String(a.values).split("|") : undefined,
      default: a.default,
    });
  }
  return gears;
}

/** 解析组件 XML 文件（displayList 保持原始顺序） */
export function parseComponent(xmlFile: string): ParsedComponent {
  const doc = parser.parse(readFileSync(xmlFile, "utf8")) as OrderItem[];
  const compItem = findFirst(doc, "component");
  if (!compItem) throw new Error(`${xmlFile} 缺少 component 根节点`);
  const compAttrs = attrsOf(compItem);
  const compChildren = childrenOf(compItem, "component");

  const controllers: Controller[] = findAll(compChildren, "controller").map((c) => {
    const a = attrsOf(c);
    // pages 是 id,name 交替（逗号分隔，name 可为空，如 "0,,1,"）。
    // 修复：不能 filter(Boolean) 去空串（会破坏交替关系，致 "0,,1,,2," 解析成 [0,2]），
    // 应成对过滤：id 为空的整对丢弃（尾逗号产生的空尾项自然落空）
    const raw = String(a.pages ?? "").split(",");
    const pageIds: string[] = [];
    const pageNames: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      if (raw[i] === "" ) continue;
      pageIds.push(raw[i]);
      pageNames.push(raw[i + 1] ?? "");
    }
    // R15 初始页规则（对齐 OpenFairy InitialPage）：homePageType=specific 时取 homePage 页，缺省第一页；
    // selected 是编辑器残留选中态，不作为初始页依据
    let selected = pageIds[0] ?? "";
    if ((a.homePageType ?? "").toLowerCase() === "specific" && a.homePage) {
      const idx = pageIds.indexOf(a.homePage);
      if (idx >= 0) selected = pageIds[idx];
    }
    return { name: a.name, pageIds, pageNames, selected };
  });

  // displayList 下的子项顺序即 XML 原始顺序（混排的 image/text/graph/component ...）
  const dlItem = findFirst(compChildren, "displayList");
  const nodes: ParsedNode[] = [];
  if (dlItem) {
    for (const item of childrenOf(dlItem, "displayList")) {
      const type = tagOf(item);
      if (!type || type === ":@") continue;
      const e = attrsOf(item);
      const node: ParsedNode = {
        type,
        id: e.id ?? "",
        name: e.name ?? e.id ?? "",
        xy: parsePair(e.xy) ?? [0, 0],
        size: parsePair(e.size),
        src: e.src,
        attrs: e,
        gears: parseGears(childrenOf(item, type)),
        extensionProps: parseExtensionProps(childrenOf(item, type)),
      };
      if (type === "list") {
        // list 的 item 子元素（静态渲染时按 defaultItem 展开，逐项属性下发用）
        const itemEls = childrenOf(item, type).filter((i2) => tagOf(i2) === "item");
        node.itemCount = itemEls.length;
        node.items = itemEls.map((i2) => attrsOf(i2));
      }
      if (!KNOWN_TYPES.has(type)) {
        node.unsupported = `节点类型 ${type} 未支持`;
      }
      nodes.push(node);
    }
  }

  const ext = compAttrs.extention ?? compAttrs.extension;
  return {
    file: xmlFile,
    size: parsePair(compAttrs.size) ?? [0, 0],
    overflow: compAttrs.overflow,
    extension: ext,
    controllers,
    nodes,
  };
}
