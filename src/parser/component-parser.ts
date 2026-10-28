import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { asArray } from "./package-parser.js";

// FairyGUI 组件 XML 解析：提取 displayList 节点与 controller（原版编辑器格式）

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  // 保留 gearXxx 子元素结构
  preserveOrder: false,
});

export interface ParsedNode {
  /** FairyGUI 节点类型：image / text / graph / component / loader / jta ... */
  type: string;
  id: string;
  name: string;
  xy: [number, number];
  size?: [number, number];
  /** 资源引用 id（image/component/loader 等使用） */
  src?: string;
  /** 其余原始属性 */
  attrs: Record<string, string>;
  /** gearDisplay 子元素的 pages（不可见性控制），undefined 表示无 gearDisplay */
  gearDisplay?: { controller: string; pages: string[] };
  /** P0 未支持的类型/属性原因（渲染时占位并上报） */
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

const KNOWN_TYPES = new Set(["image", "text", "graph"]);

/** 解析组件 XML 文件 */
export function parseComponent(xmlFile: string): ParsedComponent {
  const doc = parser.parse(readFileSync(xmlFile, "utf8"));
  const comp = doc.component;
  if (!comp) throw new Error(`${xmlFile} 缺少 component 根节点`);

  const controllers: Controller[] = asArray<Record<string, string>>(comp.controller as Record<string, string>).map((c) => {
    const pairs = String(c.pages ?? "").split(",").filter(Boolean);
    const pageIds = pairs.filter((_, i) => i % 2 === 0);
    return { name: c.name, pageIds, selected: c.selected ?? pageIds[0] ?? "" };
  });

  const nodes: ParsedNode[] = [];
  const displayList = comp.displayList ?? {};
  // displayList 下按标签名混排：image / text / graph / component ...
  for (const [tag, list] of Object.entries(displayList)) {
    for (const e of asArray<Record<string, string>>(list as Record<string, string>)) {
      // gearXxx 子元素在 fast-xml-parser 下成为 e 的同名键对象
      const gd = e.gearDisplay as { controller?: string; pages?: string } | undefined;
      const node: ParsedNode = {
        type: tag,
        id: e.id ?? "",
        name: e.name ?? e.id ?? "",
        xy: parsePair(e.xy) ?? [0, 0],
        size: parsePair(e.size),
        src: e.src,
        attrs: e,
      };
      if (gd) node.gearDisplay = { controller: gd.controller ?? "", pages: String(gd.pages ?? "").split(",").filter(Boolean) };
      if (!KNOWN_TYPES.has(tag)) {
        node.unsupported = `节点类型 ${tag} 在 P0 阶段未支持`;
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
