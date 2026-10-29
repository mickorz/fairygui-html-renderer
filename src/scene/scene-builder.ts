import path from "node:path";
import { parseComponent, type ParsedComponent, type ParsedNode } from "../parser/component-parser.js";
import type { FairyPackage } from "../parser/package-parser.js";

// 场景树构建：递归展开 component 节点引用的子组件 XML（带缓存与循环引用保护）

const compCache = new Map<string, ParsedComponent>();

export function getComponent(xmlFile: string): ParsedComponent {
  let c = compCache.get(xmlFile);
  if (!c) {
    c = parseComponent(xmlFile);
    compCache.set(xmlFile, c);
  }
  return c;
}

export interface SceneOptions {
  pkg: FairyPackage;
  /** 循环引用上报回调（可选） */
  onCycle?: (file: string, stack: string[]) => void;
}

/**
 * 递归填充节点树：component 节点的 src 解析为子组件并展开。
 * stack 为当前递归链上的组件 XML 路径，用于检测循环引用。
 */
export function buildChildren(comp: ParsedComponent, opts: SceneOptions, stack: string[] = []): void {
  for (const node of comp.nodes) {
    if (node.type !== "component" || !node.src) continue;
    const res = opts.pkg.byId(node.src);
    if (!res || res.kind !== "component") {
      node.unsupported = `component 引用资源 ${node.src ?? "?"} 未找到`;
      continue;
    }
    const file = path.normalize(res.file);
    if (stack.includes(file)) {
      node.unsupported = `循环引用: ${path.basename(file)}`;
      opts.onCycle?.(file, stack);
      continue;
    }
    node.childComp = { file, comp: getComponent(file) };
    buildChildren(node.childComp.comp, opts, [...stack, file]);
  }
}
