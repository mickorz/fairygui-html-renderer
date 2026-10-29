import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { asArray } from "./package-parser.js";

// FairyGUI 组件 XML 解析：提取 displayList 节点、controller 与 gear（原版编辑器格式）

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
});

export interface Gear {
  kind: "display" | "xy" | "size";
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
  /** component 节点递归展开后的子组件（由 scene-builder 填充） */
  childComp?: { file: string; comp: ParsedComponent };
  /** P0/P1 未支持的类型/属性原因（渲染时占位并上报） */
  unsupported?: string;
}

export interface Controller {
  name: string;
  pageIds: string[];
  selected: string;
}

export interface ParsedComponent {
  file: string;
  size: [number, number];
  /** 组件扩展类型（Button/Label/ComboBox 等） */
  extension?: string;
  controllers: Controller[];
  nodes: ParsedNode[];
}

function parsePair(s: string | undefined): [number, number] | undefined {
  if (s === undefined) return undefined;
  const parts = s.split(",").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

const KNOWN_TYPES = new Set(["image", "text", "graph", "component"]);
const GEAR_KINDS: { tag: string; kind: Gear["kind"] }[] = [
  { tag: "gearDisplay", kind: "display" },
  { tag: "gearXY", kind: "xy" },
  { tag: "gearSize", kind: "size" },
];

function parseGears(e: Record<string, unknown>): Gear[] {
  const gears: Gear[] = [];
  for (const { tag, kind } of GEAR_KINDS) {
    const g = e[tag] as { controller?: string; pages?: string; values?: string; default?: string } | undefined;
    if (!g) continue;
    gears.push({
      kind,
      controller: g.controller ?? "",
      pages: String(g.pages ?? "").split(",").filter((v) => v !== ""),
      values: g.values !== undefined ? String(g.values).split("|") : undefined,
      default: g.default,
    });
  }
  return gears;
}

/** 解析组件 XML 文件 */
export function parseComponent(xmlFile: string): ParsedComponent {
  const doc = parser.parse(readFileSync(xmlFile, "utf8"));
  const comp = doc.component;
  if (!comp) throw new Error(`${xmlFile} 缺少 component 根节点`);

  const controllers: Controller[] = asArray<Record<string, string>>(comp.controller as Record<string, string>).map((c) => {
    const pairs = String(c.pages ?? "").split(",").filter(Boolean);
    // pages 是 id,name 交替：偶数位为页 id
    const pageIds = pairs.filter((_, i) => i % 2 === 0);
    return { name: c.name, pageIds, selected: c.selected ?? pageIds[0] ?? "" };
  });

  const nodes: ParsedNode[] = [];
  const displayList = comp.displayList ?? {};
  // displayList 下按标签名混排：image / text / graph / component / list ...
  for (const [tag, list] of Object.entries(displayList)) {
    for (const e of asArray<Record<string, string>>(list as Record<string, string>)) {
      const node: ParsedNode = {
        type: tag,
        id: e.id ?? "",
        name: e.name ?? e.id ?? "",
        xy: parsePair(e.xy) ?? [0, 0],
        size: parsePair(e.size),
        src: e.src,
        attrs: e,
        gears: parseGears(e),
      };
      if (!KNOWN_TYPES.has(tag)) {
        node.unsupported = `节点类型 ${tag} 未支持`;
      }
      nodes.push(node);
    }
  }

  return {
    file: xmlFile,
    size: parsePair(comp.size) ?? [0, 0],
    extension: comp.extention ?? comp.extension,
    controllers,
    nodes,
  };
}
