import { createEditorInstance, getEditor } from "../grapes/editor-instance";
import { loadHtml } from "../grapes/load-html";
import { installAdapterHooks } from "./adapter-hooks";
import { setupDragEnhancements } from "../grapes/drag-enhance";

// 保真度验证钩子（check:grapes 用；常驻无副作用）
// 设计要点：几何/样式对比全部在"浏览器渲染后 computed style"层面取值，
// 两侧同一基准，颜色/简写天然同表达，无需文本归一化。

export interface FidelityDiff {
  kind: "semantic" | "geometry" | "asset" | "css-format";
  severity: "blocker" | "info";
  selector: string;
  property: string;
  before: string;
  after: string;
}

export interface GeoItem {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  display: string;
  position: string;
  opacity: string;
  bg: string;
  color: string;
  fontSize: string;
  fontWeight: string;
  textAlign: string;
  lineHeight: string;
  radius: string;
  border: string;
  transform: string;
  text: string;
}

interface FidelityWindow {
  __editorReady: boolean;
  __editorLoad: (bodyHtml: string, css: string) => Promise<boolean>;
  __editorExport: () => { html: string; css: string };
  __structureDiff: (origBody: string, exportedHtml: string) => FidelityDiff[];
  __geometrySnapshot: (
    bodyHtml: string,
    css: string,
    assetMap: Record<string, string>,
  ) => Promise<GeoItem[]>;
  __cssDiff: (origCss: string, exportedCss: string) => FidelityDiff[];
}

declare global {
  interface Window extends FidelityWindow {}
}

const ATTRS = ["id", "class", "src", "data-fgui-node-id"] as const;

/** 元素的直接文本（仅非空白文本节点；空白节点在块级/absolute 布局中渲染等价，后代文本由递归覆盖） */
function directText(el: Element): string {
  let out = "";
  Array.from(el.childNodes).forEach((n) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out += (out ? " " : "") + t;
    }
  });
  return out;
}

function classSet(el: Element): string {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).sort().join(" ");
}

/** 结构对比：原始 body 内的 #canvas 子树 vs 导出 HTML 的 #canvas 子树 */
function structureDiff(origBody: string, exportedHtml: string): FidelityDiff[] {
  const diffs: FidelityDiff[] = [];
  const parse = (h: string) => new DOMParser().parseFromString(h, "text/html");
  const canvasA = parse(origBody).querySelector("#canvas");
  const canvasB = parse(exportedHtml).querySelector("#canvas");
  if (!canvasA || !canvasB) {
    diffs.push({
      kind: "semantic",
      severity: "blocker",
      selector: "#canvas",
      property: "presence",
      before: String(!!canvasA),
      after: String(!!canvasB),
    });
    return diffs;
  }
  const walk = (ea: Element, eb: Element, path: string) => {
    const ca = Array.from(ea.children);
    const cb = Array.from(eb.children);
    if (ca.length !== cb.length) {
      diffs.push({
        kind: "semantic",
        severity: "blocker",
        selector: path,
        property: "childCount",
        before: String(ca.length),
        after: String(cb.length),
      });
    }
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i++) {
      const xa = ca[i];
      const xb = cb[i];
      const p = path + ">" + i + ":" + xa.tagName.toLowerCase();
      if (xa.tagName !== xb.tagName) {
        diffs.push({ kind: "semantic", severity: "blocker", selector: p, property: "tag", before: xa.tagName, after: xb.tagName });
      }
      for (const attr of ATTRS) {
        const va = attr === "class" ? classSet(xa) : (xa.getAttribute(attr) ?? "");
        const vb = attr === "class" ? classSet(xb) : (xb.getAttribute(attr) ?? "");
        if (va !== vb) {
          diffs.push({
            kind: attr === "src" ? "asset" : "semantic",
            severity: "blocker",
            selector: p,
            property: attr,
            before: va,
            after: vb,
          });
        }
      }
      const ta = directText(xa);
      const tb = directText(xb);
      if (ta !== tb) {
        diffs.push({
          kind: "semantic",
          severity: "blocker",
          selector: p,
          property: "text",
          before: ta.slice(0, 60),
          after: tb.slice(0, 60),
        });
      }
      walk(xa, xb, p);
    }
  };
  walk(canvasA, canvasB, "#canvas");
  return diffs;
}

/** 干净 iframe 渲染并收集 #canvas 子树的几何 + computed style 快照 */
async function geometrySnapshot(
  bodyHtml: string,
  css: string,
  assetMap: Record<string, string>,
): Promise<GeoItem[]> {
  // 资源引用替换为 data URL，保证 iframe 内图片真实加载（src 字符串保真由 structureDiff 负责）
  let html = bodyHtml;
  let cssText = css;
  for (const [p, data] of Object.entries(assetMap)) {
    html = html.split(p).join(data);
    cssText = cssText.split(p).join(data);
  }
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:fixed;left:-99999px;top:0;width:900px;height:1500px;border:0;");
  document.body.appendChild(iframe);
  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    iframe.srcdoc =
      "<!doctype html><html><head><meta charset='utf-8'><style>" +
      cssText +
      "</style></head><body>" +
      html +
      "</body></html>";
  });
  await new Promise((r) => setTimeout(r, 300)); // 图片与布局稳定
  const win = iframe.contentWindow!;
  const doc = iframe.contentDocument!;
  const canvas = doc.querySelector("#canvas");
  if (!canvas) {
    iframe.remove();
    throw new Error("渲染快照缺少 #canvas");
  }
  const base = canvas.getBoundingClientRect();
  const items: GeoItem[] = [];
  const walk = (el: Element, path: string) => {
    Array.from(el.children).forEach((child, i) => {
      const r = child.getBoundingClientRect();
      const cs = win.getComputedStyle(child);
      const p = path + ">" + i + ":" + child.tagName.toLowerCase();
      items.push({
        path: p,
        x: +(r.left - base.left).toFixed(1),
        y: +(r.top - base.top).toFixed(1),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        display: cs.display,
        position: cs.position,
        opacity: cs.opacity,
        bg: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        textAlign: cs.textAlign,
        lineHeight: cs.lineHeight,
        radius: cs.borderRadius,
        border: cs.borderTopWidth + " " + cs.borderTopColor,
        transform: cs.transform,
        text: directText(child).slice(0, 40),
      });
      walk(child, p);
    });
  };
  walk(canvas, "#canvas");
  iframe.remove();
  return items;
}

// ---------- CSS 文本级对比（css-format 来源） ----------

function hexToRgb(m: string): string {
  const h = m.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return "rgb(" + r + ", " + g + ", " + b + ")";
}

function normVal(v: string): string {
  return v
    .replace(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi, hexToRgb)
    .replace(/\s+/g, " ")
    .replace(/\s*([:,()])\s*/g, "$1")
    .replace(/"/g, "'")
    .trim()
    .toLowerCase();
}

/** 解析 CSS 文本为 selector -> {prop: value}（仅 style 规则） */
function parseCssRules(css: string): Map<string, Record<string, string>> {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const out = new Map<string, Record<string, string>>();
  try {
    const sheet = style.sheet as CSSStyleSheet | null;
    const rules = sheet?.cssRules ?? [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as CSSStyleRule;
      if (rule.type !== 1 || !rule.selectorText) continue;
      const decl: Record<string, string> = {};
      for (let j = 0; j < rule.style.length; j++) {
        const prop = rule.style.item(j);
        decl[prop] = rule.style.getPropertyValue(prop);
      }
      out.set(rule.selectorText, decl);
    }
  } finally {
    style.remove();
  }
  return out;
}

/** CSS 规则级对比：归一化后等价 → css-format(info)；真值不同/缺失 → semantic(blocker)；导出新增规则 → css-format(info) */
function cssDiff(origCss: string, exportedCss: string): FidelityDiff[] {
  const diffs: FidelityDiff[] = [];
  const a = parseCssRules(origCss);
  const b = parseCssRules(exportedCss);
  for (const [sel, declA] of a) {
    const declB = b.get(sel);
    if (!declB) {
      diffs.push({ kind: "semantic", severity: "blocker", selector: sel, property: "<rule>", before: "存在", after: "缺失" });
      continue;
    }
    const props = new Set([...Object.keys(declA), ...Object.keys(declB)]);
    for (const prop of props) {
      const va = declA[prop];
      const vb = declB[prop];
      if (va === undefined || vb === undefined) {
        diffs.push({ kind: "semantic", severity: "blocker", selector: sel, property: prop, before: va ?? "缺失", after: vb ?? "缺失" });
        continue;
      }
      const na = normVal(va);
      const nb = normVal(vb);
      if (na !== nb) {
        diffs.push({ kind: "semantic", severity: "blocker", selector: sel, property: prop, before: va, after: vb });
      } else if (va !== vb) {
        diffs.push({ kind: "css-format", severity: "info", selector: sel, property: prop, before: va, after: vb });
      }
    }
  }
  // 导出侧新增规则（如画布注入的全局规则）：不阻断，但必须可见（评审：不允许静默）
  for (const sel of b.keys()) {
    if (!a.has(sel)) {
      const decl = b.get(sel)!;
      diffs.push({
        kind: "css-format",
        severity: "info",
        selector: sel,
        property: "<added-rule>",
        before: "-",
        after: Object.keys(decl).join(","),
      });
    }
  }
  return diffs;
}

/** 安装全部钩子（main.tsx 调用一次） */
export function installFidelityHooks(): void {
  const w = window as unknown as FidelityWindow & typeof globalThis;
  w.__editorLoad = async (bodyHtml, css) => {
    await loadHtml(getEditor(), bodyHtml, css);
    return true;
  };
  w.__editorExport = () => {
    const ed = getEditor();
    return { html: ed.getHtml(), css: ed.getCss() ?? "" };
  };
  w.__structureDiff = structureDiff;
  w.__geometrySnapshot = geometrySnapshot;
  w.__cssDiff = cssDiff;
  installAdapterHooks();
  // React 渲染是异步调度，容器挂载晚于本函数：轮询等到 host 出现再初始化编辑器
  const start = Date.now();
  const timer = setInterval(() => {
    const host = document.getElementById("gjs-canvas-host");
    if (host) {
      clearInterval(timer);
      const ed = createEditorInstance(host);
      setupDragEnhancements(ed);
      w.__editorReady = true;
    } else if (Date.now() - start > 15000) {
      clearInterval(timer);
      console.error("[fidelity-hooks] 15s 内未出现 #gjs-canvas-host");
    }
  }, 50);
}
