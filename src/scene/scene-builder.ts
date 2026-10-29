import path from "node:path";
import { parseComponent, type ParsedComponent, type ParsedNode } from "../parser/component-parser.js";
import type { FairyPackage } from "../parser/package-parser.js";

// 场景树构建：递归展开 component 节点引用的子组件 XML
// A2：构建与缓存分离——getComponent 缓存的解析结果视为不可变原始数据，
// buildScene 每次生成全新节点对象（副本），循环标记等状态只写入副本，不污染缓存。

const compCache = new Map<string, ParsedComponent>();

export interface GetOptions {
  /** 跳过缓存重新解析（文件可能已修改），结果仍回写缓存 */
  fresh?: boolean;
}

export function getComponent(xmlFile: string, opts?: GetOptions): ParsedComponent {
  const key = path.normalize(xmlFile);
  if (!opts?.fresh) {
    const cached = compCache.get(key);
    if (cached) return cached;
  }
  const comp = parseComponent(xmlFile);
  compCache.set(key, comp);
  return comp;
}

/** 清空解析缓存（A4：供服务化场景的每请求重解析或显式失效使用） */
export function clearCache(): void {
  compCache.clear();
}

export interface SceneOptions {
  pkg: FairyPackage;
  /** 循环引用上报回调（可选） */
  onCycle?: (file: string, stack: string[]) => void;
}

/**
 * 递归构建场景树：component 节点的 src 解析为子组件并展开。
 * 每次调用生成全新节点副本（含子组件递归副本），缓存内原始树不被修改。
 * stack 为当前递归链上的组件 XML 路径，用于检测循环引用。
 */
export function buildScene(comp: ParsedComponent, opts: SceneOptions, stack: string[] = []): ParsedComponent {
  // 当前组件根入栈：自引用（A 引 A）与互相引用均能在首次重现处截断
  const fullStack = [path.normalize(comp.file), ...stack];
  const nodes: ParsedNode[] = comp.nodes.map((node) => {
    // 逐节点副本：与缓存内对象断开可变引用
    const copy: ParsedNode = { ...node, attrs: { ...node.attrs }, gears: node.gears.map((g) => ({ ...g })) };
    if (copy.type !== "component" || !copy.src) return copy;
    const res = opts.pkg.byId(copy.src);
    if (!res || res.kind !== "component") {
      copy.unsupported = `component 引用资源 ${copy.src ?? "?"} 未找到`;
      return copy;
    }
    const file = path.normalize(res.file);
    if (fullStack.includes(file)) {
      copy.unsupported = `循环引用: ${path.basename(file)}`;
      opts.onCycle?.(file, fullStack);
      return copy;
    }
    copy.childComp = { file, comp: buildScene(getComponent(file), opts, [...fullStack, file]) };
    return copy;
  });
  return { ...comp, nodes };
}
