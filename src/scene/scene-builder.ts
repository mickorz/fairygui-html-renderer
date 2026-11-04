import path from "node:path";
import { loadPackage, resourceIdOf, type FairyPackage, type Resource } from "../parser/package-parser.js";
import { parseComponent, type ParsedComponent, type ParsedNode } from "../parser/component-parser.js";
import { buildGlobalIndex, parseUiUrl, type GlobalIndex } from "./global-index.js";

// 场景树构建：递归展开 component 节点引用的子组件 XML
// A2：构建与缓存分离——getComponent 缓存的解析结果视为不可变原始数据，
// buildScene 每次生成全新节点对象（副本），循环标记等状态只写入副本，不污染缓存。
// B1：instancePath / stableKey 在构建时统一填充，渲染器与 Scene Tree JSON 共用同一份数据。

const compCache = new Map<string, ParsedComponent>();
// 工程级资源索引缓存（按 root）：loader/list/UBB img 的 ui:// 解析共用，避免逐节点重建
const globalIndexCache = new Map<string, GlobalIndex>();

function globalIndexOf(root: string): GlobalIndex {
  const norm = path.normalize(root);
  let idx = globalIndexCache.get(norm);
  if (!idx) {
    idx = buildGlobalIndex(norm);
    globalIndexCache.set(norm, idx);
  }
  return idx;
}

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
  globalIndexCache.clear();
}

export interface SceneOptions {
  pkg: FairyPackage;
  /** 工程根目录：list 节点解析 ui:// defaultItem 需要；未传时 list 保持未支持 */
  root?: string;
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
    if (copy.type === "list") {
      expandList(copy, opts, { stack: fullStack, parentPath, keyPrefix });
      return copy;
    }
    // R04/R12：loader url 解析：包内 image 直接渲染；包内 component 展开为子场景（复用 component 范式）
    if (copy.type === "loader" && copy.attrs.url?.startsWith("ui://") && opts.root) {
      const hit = parseUiUrl(copy.attrs.url, globalIndexOf(opts.root));
      if (hit?.resource.kind === "image") {
        copy.loaderRes = hit.resource;
      } else if (hit?.resource.kind === "component") {
        expandLoaderComponent(copy, hit, opts, fullStack);
      }
    }
    // R13：UBB/富文本内的 [img]ui://x[/img] 构建期预解析为绝对路径（渲染期 toAssetUrl 转 URL）
    if (opts.root && copy.attrs.text?.includes("[img]")) {
      const idx = globalIndexOf(opts.root);
      copy.attrs.text = copy.attrs.text.replace(/\[img\](ui:\/\/[^\[]*?)\[\/img\]/g, (m, url: string) => {
        const hit2 = parseUiUrl(url, idx);
        return hit2 && hit2.resource.kind === "image" ? `[img]${hit2.resource.file}[/img]` : m;
      });
    }
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
    injectExtensionProps(copy);
    return copy;
  });
  return { ...comp, nodes };
}

/** loader url 指向包内 component 的展开（R12）：复用 component 节点展开范式（循环防护 + 稳定键续接） */
function expandLoaderComponent(
  copy: ParsedNode,
  hit: { pkgDir: string; resource: Resource },
  opts: SceneOptions,
  stack: string[],
): void {
  const childFile = path.normalize(hit.resource.file);
  if (stack.includes(childFile)) {
    copy.unsupported = `循环引用: ${path.basename(childFile)}`;
    opts.onCycle?.(childFile, stack);
    return;
  }
  const childPkg = loadPackage(hit.pkgDir);
  const childResId = resourceIdOf(childPkg, childFile) ?? path.basename(childFile, ".xml");
  copy.childComp = {
    file: childFile,
    comp: buildScene(getComponent(childFile), { pkg: childPkg, root: opts.root }, {
      stack: [...stack, childFile],
      parentPath: `${copy.instancePath}`,
      keyPrefix: `${copy.stableKey}~${childPkg.id}.${childResId}`,
    }),
  };
}

/**
 * 扩展组件属性注入（E3）：<Label title="Bag"/> 把 title 写入子场景 name="title" 的 text 节点。
 * copy.childComp.comp 是本次构建的新副本，直接修改不会污染缓存。
 */
function injectExtensionProps(copy: ParsedNode): void {
  const props = copy.extensionProps;
  const child = copy.childComp?.comp;
  if (!props || !child) return;
  const title = props.Label?.title ?? props.Button?.title ?? props.Title?.title;
  if (title !== undefined) {
    applyTitle(child, title);
  }
}

function applyTitle(scene: ParsedComponent, title: string): void {
  for (const n of scene.nodes) {
    if (n.name === "title" && n.type === "text") {
      n.attrs = { ...n.attrs, text: title };
      continue;
    }
    if (n.childComp) applyTitle(n.childComp.comp, title);
  }
}

/** list 节点静态渲染（E4）：按 defaultItem（ui://）为每个 item 生成实例场景副本 */
function expandList(copy: ParsedNode, opts: SceneOptions, ctx: BuildContext): void {
  if (!opts.root) {
    copy.unsupported = "list 展开需要 SceneOptions.root（解析 ui:// defaultItem）";
    return;
  }
  const defaultItem = copy.attrs.defaultItem ?? "";
  const hit = parseUiUrl(defaultItem, globalIndexOf(opts.root));
  if (!hit || hit.resource.kind !== "component") {
    copy.unsupported = `list defaultItem 无法解析: ${defaultItem}`;
    return;
  }
  const itemPkg = loadPackage(hit.pkgDir);
  const itemCount = Math.min(copy.itemCount ?? 0, 200);
  // GList item 尺寸 = defaultItem 组件的设计尺寸（FairyGUI 语义）
  const itemComp = getComponent(hit.resource.file, { fresh: true });
  copy.defaultItemSize = { w: itemComp.size[0], h: itemComp.size[1] };
  const index = globalIndexOf(opts.root);
  copy.listItems = [];
  for (let i = 0; i < itemCount; i++) {
    const scene = buildScene(itemComp, { pkg: itemPkg, root: opts.root }, {
      stack: [...ctx.stack, path.normalize(hit.resource.file)],
      parentPath: `${copy.instancePath}.item${i}`,
      keyPrefix: `${copy.stableKey}#${i}~${itemPkg.id}.${hit.resource.id}`,
    });
    // R11：item 逐项属性下发：title 写入 name="title" 文本（复用 applyTitle），icon 写入 name="icon" loader 并解析 url
    const a = copy.items?.[i] ?? {};
    if (a.title !== undefined) applyTitle(scene, a.title);
    if (a.icon !== undefined) applyIcon(scene, a.icon, opts, index, ctx.stack);
    copy.listItems.push({ index: i, pkg: itemPkg, scene });
  }
}

/** item icon 下发（R11）：写入场景内 name="icon" 的 loader 节点并解析为图片/组件内容 */
function applyIcon(scene: ParsedComponent, icon: string, opts: SceneOptions, index: GlobalIndex, stack: string[]): void {
  for (const n of scene.nodes) {
    if (n.name === "icon" && n.type === "loader") {
      n.attrs = { ...n.attrs, url: icon };
      if (icon.startsWith("ui://")) {
        const hit = parseUiUrl(icon, index);
        if (hit?.resource.kind === "image") n.loaderRes = hit.resource;
        else if (hit?.resource.kind === "component") expandLoaderComponent(n, hit, opts, stack);
      }
      continue;
    }
    if (n.childComp) applyIcon(n.childComp.comp, icon, opts, index, stack);
  }
}
