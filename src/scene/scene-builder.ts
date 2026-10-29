import path from "node:path";
import { parseComponent, type ParsedComponent, type ParsedNode } from "../parser/component-parser.js";
import { resourceIdOf, type FairyPackage } from "../parser/package-parser.js";

// 场景树构建：递归展开 component 节点引用的子组件 XML
// A2：构建与缓存分离——getComponent 缓存的解析结果视为不可变原始数据，
// buildScene 每次生成全新节点对象（副本），循环标记等状态只写入副本，不污染缓存。
// B1：instancePath / stableKey 在构建时统一填充，渲染器与 Scene Tree JSON 共用同一份数据。

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

/** 递归上下文：调用方（如服务）不传即视为根组件 */
interface BuildContext {
  stack: string[];
  parentPath: string;
  keyPrefix: string;
}

/**
 * 递归构建场景树：component 节点的 src 解析为子组件并展开。
 * 每次调用生成全新节点副本（含子组件递归副本），缓存内原始树不被修改。
 * 同时为每个节点填充 instancePath（可读定位）与 stableKey（唯一实例键）。
 */
export function buildScene(comp: ParsedComponent, opts: SceneOptions, ctx?: BuildContext): ParsedComponent {
  const file = path.normalize(comp.file);
  const stack = ctx ? ctx.stack : [];
  const fullStack = [file, ...stack];
  const parentPath = ctx ? ctx.parentPath : path.basename(comp.file, ".xml");
  const rootResId = resourceIdOf(opts.pkg, comp.file) ?? path.basename(comp.file, ".xml");
  const keyPrefix = ctx ? ctx.keyPrefix : `${opts.pkg.id}.${rootResId}`;

  const nodes: ParsedNode[] = comp.nodes.map((node) => {
    // 逐节点副本：与缓存内对象断开可变引用
    const copy: ParsedNode = { ...node, attrs: { ...node.attrs }, gears: node.gears.map((g) => ({ ...g })) };
    copy.instancePath = `${parentPath}.${copy.name || copy.id}`;
    copy.stableKey = `${keyPrefix}.${copy.id}`;
    if (copy.type !== "component" || !copy.src) return copy;
    const res = opts.pkg.byId(copy.src);
    if (!res || res.kind !== "component") {
      copy.unsupported = `component 引用资源 ${copy.src ?? "?"} 未找到`;
      return copy;
    }
    const childFile = path.normalize(res.file);
    if (fullStack.includes(childFile)) {
      copy.unsupported = `循环引用: ${path.basename(childFile)}`;
      opts.onCycle?.(childFile, fullStack);
      return copy;
    }
    // 子层稳定键以子组件资源 id 续接：...~pkgId.resId（层间 ~ 避开 HTML 属性转义）
    const childResId = resourceIdOf(opts.pkg, childFile) ?? path.basename(childFile, ".xml");
    const childKeyPrefix = `${copy.stableKey}~${opts.pkg.id}.${childResId}`;
    copy.childComp = {
      file: childFile,
      comp: buildScene(getComponent(childFile), opts, {
        stack: [...fullStack, childFile],
        parentPath: copy.instancePath,
        keyPrefix: childKeyPrefix,
      }),
    };
    return copy;
  });
  return { ...comp, nodes };
}
