import path from "node:path";
import { loadPackage, resourceIdOf, type FairyPackage, type Resource } from "../parser/package-parser.js";
import { parseComponent, type ParsedComponent, type ParsedNode } from "../parser/component-parser.js";
import { parseFnt, type BitmapGlyph, type BitmapFontResolved } from "../parser/fnt.js";
import { buildGlobalIndex, parseUiUrl, type GlobalIndex } from "./global-index.js";
import { pickGearValue } from "../renderer/gear.js";

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
  /** list 展开数量安全上限（overflow 非 scroll 时的全量上限，缺省 200） */
  listItemCap?: number;
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
    // BMFont 位图字体（L1）：ui:// font 构建期解析为字符 -> 图文件表（renderer 保持纯函数，同 loaderRes 范式）
    if ((copy.type === "text" || copy.type === "richtext" || copy.type === "inputtext") && copy.attrs.font?.startsWith("ui://") && opts.root) {
      resolveBitmapFont(copy, opts, opts.root);
    }
    // R04/R12：loader url 解析：包内 image 直接渲染；包内 component 展开为子场景（复用 component 范式）
    // gearIcon 默认页取值优先于 attrs.url（FairyGUI gearIcon 语义）
    if (copy.type === "loader" && opts.root) {
      const gearIcon = copy.gears.find((g) => g.kind === "icon");
      const iconUrl = gearIcon
        ? pickGearValue(gearIcon, comp.controllers.find((c) => c.name === gearIcon.controller))
        : null;
      const url = iconUrl ?? copy.attrs.url;
      if (url?.startsWith("ui://")) {
        const hit = parseUiUrl(url, globalIndexOf(opts.root));
        if (hit?.resource.kind === "image" || (hit?.resource.kind === "other" && hit.resource.type === "movieclip")) {
          copy.loaderRes = hit.resource;
        } else if (hit?.resource.kind === "component") {
          expandLoaderComponent(copy, hit, opts, fullStack);
        }
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
    injectExtensionProps(copy, opts, fullStack);
    // R20：实例级页覆盖：controller 属性为 name,pageId 逗号对，覆写子场景控制器初始页（gear 求值链自动生效）
    applyInstanceControllers(copy.childComp.comp, copy.attrs.controller);
    return copy;
  });
  // controllers 逐项副本：实例页覆盖（R20）可安全写入而不污染解析缓存
  return { ...comp, controllers: comp.controllers.map((c) => ({ ...c })), nodes };
}

/** 实例级页覆盖（R20）：对齐 OpenFairy ConfigureInstanceControllers 语义（name,pageId 逗号对） */
function applyInstanceControllers(scene: ParsedComponent, spec: string | undefined): void {
  if (!spec) return;
  const pairs = spec.split(",");
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const c = scene.controllers.find((x) => x.name === pairs[i]);
    if (c && c.pageIds.includes(pairs[i + 1])) c.selected = pairs[i + 1];
  }
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
  applyInstanceControllers(copy.childComp.comp, copy.attrs.controller);
}

/**
 * 扩展组件属性注入（E3）：<Label title="Bag"/> 把 title 写入子场景 name="title" 的 text 节点；
 * <Button icon="ui://..."/> 把 icon 写入 name="icon" 的 loader 并解析 url（与 title 同机制，真实样本 Demo_Button/Demo_Label 实测）。
 * copy.childComp.comp 是本次构建的新副本，直接修改不会污染缓存。
 */
function injectExtensionProps(copy: ParsedNode, opts: SceneOptions, stack: string[]): void {
  const props = copy.extensionProps;
  const child = copy.childComp?.comp;
  if (!child) return;
  const childExt = child.extension;
  const buttonOrLabel = props?.Button ?? props?.Label ?? props?.Title;
  // 定义级（根扩展元素）与实例级同名属性合并：实例级覆盖（OpenFairy 语义）
  const def = childExt ? child.rootExtension?.[childExt] ?? {} : {};
  const inst = childExt ? props?.[childExt] ?? {} : {};
  const merged = { ...def, ...inst };
  const title = merged.title ?? buttonOrLabel?.title;
  if (title !== undefined) {
    applyTitle(child, title);
  }
  const icon = merged.icon ?? buttonOrLabel?.icon;
  if (icon !== undefined && opts.root) {
    applyIcon(child, icon, opts, globalIndexOf(opts.root), stack);
  }
  // Button 专属语义（button-node 分支的数据层）：checked/titleColor/titleFontSize
  if ((props?.Button || childExt === "Button") && Object.keys(merged).length) injectButtonProps(child, merged);
  // ComboBox：选项静态化（selectedIndex 缺省 0，title 取首项；下拉弹层属运行时不渲染）
  if (childExt === "ComboBox") {
    const item = copy.extensionItems?.[0];
    if (item) {
      if (item.title !== undefined) applyTitle(child, item.title);
      if (item.icon !== undefined && opts.root) applyIcon(child, item.icon, opts, globalIndexOf(opts.root), stack);
    }
    injectButtonProps(child, merged);
  }
  // ProgressBar/Slider：值填充静态化（titleType 四格式 + bar/bar_v 宽高按 percent 缩放，reverse 反向）
  if (childExt === "ProgressBar" || childExt === "Slider") {
    injectProgressProps(child, merged);
  }
}

/**
 * ProgressBar/Slider 共用值填充（语义依据 OpenFairy ProgressBar/Slider.Apply 与 Migrate.SetupXxx 源码）：
 * - percent = clamp01((value-min)/(max-min))，缺省 value=50/max=100/min=0
 * - title（name="title"）文本 = ProgressTitle.Format：percent -> "N%"，valueAndmax -> "v/m"，value/max -> 原值
 * - bar（name="bar"）宽 = round(设计宽 * percent)；reverse -> x = 设计x + (设计宽 - w)
 * - bar_v（name="bar_v"）同理纵向（y 向下与 CSS 同向，reverse 时从底向上填充）
 * - Slider 的 grip 保持设计位（OpenFairy 烘焙不动 grip，运行时拖动才摆位）
 */
function injectProgressProps(child: import("../parser/component-parser.js").ParsedComponent, props: Record<string, string>): void {
  const num = (k: string, d: number) => (props[k] !== undefined && Number.isFinite(Number(props[k])) ? Number(props[k]) : d);
  const value = num("value", 50);
  const max = num("max", 100);
  const min = num("min", 0);
  const denom = max - min;
  const percent = denom > 0 ? Math.min(1, Math.max(0, (value - min) / denom)) : 1;
  const fmt = (props.titleType ?? "percent").toLowerCase();
  const titleText = fmt === "valueandmax" ? `${Math.round(value)}/${Math.round(max)}`
    : fmt === "value" ? `${Math.round(value)}`
    : fmt === "max" ? `${Math.round(max)}`
    : `${Math.floor(percent * 100)}%`;
  for (const n of child.nodes) {
    if (n.name === "title" && n.type === "text") {
      n.attrs = { ...n.attrs, text: titleText };
    } else if (n.name === "bar" && (n.attrs.fillMethod || n.size)) {
      // SetFillAmount 路径（bar 自带 fillMethod，如 CircleProgress radial360 圆环）：改 fillAmount 而非缩宽（OpenFairy 语义）
      if (n.attrs.fillMethod) {
        n.attrs = { ...n.attrs, fillAmount: String(Math.round(percent * 100)) };
        continue;
      }
      const w = Math.round((n.size ?? [0, 0])[0] * percent);
      const x = props.reverse === "true" ? n.xy[0] + ((n.size ?? [0, 0])[0] - w) : n.xy[0];
      n.size = [w, (n.size ?? [0, 0])[1]];
      n.xy = [x, n.xy[1]];
    } else if (n.name === "bar_v" && n.size) {
      const h = Math.round(n.size[1] * percent);
      const y = props.reverse === "true" ? n.xy[1] + (n.size[1] - h) : n.xy[1];
      n.size = [n.size[0], h];
      n.xy = [n.xy[0], y];
    }
  }
}

/**
 * GButton 专属属性注入（语义依据 OpenFairy Button/Migrate 源码）：
 * - checked：button 控制器（固定名）切到 selectedOver 页（按页名找，无该页不动）；
 *   页切换发生在构建期副本上，gearDisplay/gearLook 求值链自动生效（三态背景/按下态正确）
 * - titleColor/titleFontSize：注入 name="title" 文本（定义级属性，同 title 机制）
 */
function injectButtonProps(child: import("../parser/component-parser.js").ParsedComponent, props: Record<string, string>): void {
  const ctrl = child.controllers.find((c) => c.name === "button");
  if (ctrl && (props.checked === "1" || props.checked === "true")) {
    const pageIdx = ctrl.pageNames.indexOf("selectedOver");
    if (pageIdx >= 0) ctrl.selected = ctrl.pageIds[pageIdx];
  }
  if (props.titleColor !== undefined || props.titleFontSize !== undefined) {
    for (const n of child.nodes) {
      if (n.name === "title" && n.type === "text") {
        n.attrs = { ...n.attrs };
        if (props.titleColor !== undefined) n.attrs.color = props.titleColor;
        if (props.titleFontSize !== undefined) n.attrs.fontSize = props.titleFontSize;
      }
    }
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
  // GList item 尺寸 = defaultItem 组件的设计尺寸（FairyGUI 语义）
  const itemComp = getComponent(hit.resource.file, { fresh: true });
  copy.defaultItemSize = { w: itemComp.size[0], h: itemComp.size[1] };
  // R24：展开数量上限：overflow=scroll 时按视口推算展开窗口（可视容量外多留一屏，对齐 overscan 思路），
  // 其余全量展开（安全上限可配 listItemCap，缺省 200）
  let cap = opts.listItemCap ?? 200;
  if (copy.attrs.overflow === "scroll" && copy.size && itemComp.size[0] > 0 && itemComp.size[1] > 0) {
    const cg = Number(copy.attrs.colGap ?? 0) || 0;
    const lg = Number(copy.attrs.lineGap ?? 0) || 0;
    const cols = Math.max(1, Math.floor((copy.size[0] + cg) / (itemComp.size[0] + cg)));
    const rows = Math.max(1, Math.floor((copy.size[1] + lg) / (itemComp.size[1] + lg)));
    cap = Math.max(1, cols * rows * 2);
  }
  const itemCount = Math.min(copy.itemCount ?? 0, cap);
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

/**
 * BMFont 位图字体构建期解析（L1）：ui:// font -> 字符表（字符 -> 图文件/图集矩形）。
 * 两种变体（实测 CC-Default）：
 *   FairyUI 变体（img=资源id）逐字独立图片；图集变体（x/y/width/height）图集矩形，
 *   图集优先用 font 资源的 texture 属性（package.xml），page file 实测可能是占位不存在的文件名。
 * 解析失败/无字形时静默返回（渲染器按普通文本回退并上报）。
 */
function resolveBitmapFont(copy: ParsedNode, opts: SceneOptions, root: string): void {
  const hit = parseUiUrl(copy.attrs.font ?? "", globalIndexOf(root));
  const res = hit?.resource;
  if (!res || res.kind !== "other" || res.type !== "font") return;
  let fnt;
  try {
    fnt = parseFnt(res.file);
  } catch {
    return;
  }
  if (!fnt.glyphs.length) return;
  const pkg = loadPackage(hit.pkgDir);
  const glyphs = new Map<number, BitmapGlyph>();
  let lineHeight = fnt.lineHeight;
  for (const g of fnt.glyphs) {
    if (g.img) {
      // FairyUI 变体：每字符独立图片资源
      const img = pkg.byId(g.img);
      if (!img || img.kind !== "image") continue;
      const w = img.width ?? 0;
      const h = img.height ?? 0;
      glyphs.set(g.id, { file: img.file, w, h, xoffset: g.xoffset ?? 0, yoffset: g.yoffset ?? 0, xadvance: g.xadvance ?? w });
      lineHeight = Math.max(lineHeight, h);
    } else {
      // 图集变体：texture 属性优先，page file 相对 fnt 目录兑底
      const atlasRes = res.texture ? pkg.byId(res.texture) : undefined;
      const atlasFile = atlasRes && atlasRes.kind === "image" ? atlasRes.file : path.join(path.dirname(res.file), fnt.pages[g.page ?? 0] ?? "");
      glyphs.set(g.id, {
        file: atlasFile,
        w: g.width ?? 0,
        h: g.height ?? 0,
        xoffset: g.xoffset ?? 0,
        yoffset: g.yoffset ?? 0,
        xadvance: g.xadvance ?? g.width ?? 0,
        atlasX: g.x,
        atlasY: g.y,
      });
    }
  }
  if (!glyphs.size) return;
  copy.bitmapFont = { glyphs, lineHeight: lineHeight || 0 };
  // 位图字体字号固定（FairyGUI BMFont 忽略 fontSize），渲染器逐字摆位不用 font-size
}

/** item icon 下发（R11）：写入场景内 name="icon" 的 loader 节点并解析为图片/组件内容 */
function applyIcon(scene: ParsedComponent, icon: string, opts: SceneOptions, index: GlobalIndex, stack: string[]): void {
  for (const n of scene.nodes) {
    if (n.name === "icon" && n.type === "loader") {
      n.attrs = { ...n.attrs, url: icon };
      if (icon.startsWith("ui://")) {
        const hit = parseUiUrl(icon, index);
        if (hit?.resource.kind === "image" || (hit?.resource.kind === "other" && hit.resource.type === "movieclip")) {
          n.loaderRes = hit.resource;
        } else if (hit?.resource.kind === "component") expandLoaderComponent(n, hit, opts, stack);
      }
      continue;
    }
    if (n.childComp) applyIcon(n.childComp.comp, icon, opts, index, stack);
  }
}
