import type { NodeRenderInput, RenderContext } from "../types.js";
import { baseStyle, dataAttrs, esc, toCssColor } from "../utils.js";

// text/richtext 节点渲染：字号/颜色/描边/自动尺寸/对齐；gearColor 默认页覆盖属性色
// R03：vAlign 垂直对齐 flex 实现；行距按 FairyGUI 公式 round(fontSize*1.25)+leading-1 换算
// R13：模板占位替换（vars）+ UBB 白名单映射（ubb/richtext），未知标签按原文输出安全降级

/** 模板占位替换（对齐 TextTemplateCompiler 规则）：\{ 转义、{} 字面、{name=default} 取 default、{name} 置空 */
function applyTemplate(text: string): string {
  return text
    .replace(/\\{/g, "\u0000") // \{ 暂存为哨兵，防止后续正则误吞
    .replace(/\{([^{}]*)\}/g, (_m, tag: string) => {
      if (tag === "") return "{}"; // {} 字面
      const eq = tag.indexOf("=");
      return eq >= 0 ? tag.slice(eq + 1) : ""; // {name=default} / {name}
    })
    .replace(/\u0000/g, "{");
}

/**
 * UBB 白名单映射（对齐 UBBParser 标签表）：b/i/u/strike/sup/sub/color/size/font/align/img/url。
 * 输入必须是已 esc 的文本，标签属性值内不会出现未转义引号，可安全拼 HTML。
 * [img] 内容为构建期预解析的绝对路径（scene-builder），渲染期经 toAssetUrl 转 URL。
 */
function renderUbb(s: string, ctx: RenderContext): string {
  // 简单标签一一对应
  const simple: [string, string][] = [
    ["b", "<b>"], ["/b", "</b>"],
    ["i", "<i>"], ["/i", "</i>"],
    ["u", "<u>"], ["/u", "</u>"],
    ["strike", "<s>"], ["/strike", "</s>"],
    ["sup", "<sup>"], ["/sup", "</sup>"],
    ["sub", "<sub>"], ["/sub", "</sub>"],
  ];
  for (const [tag, html] of simple) s = s.split(`[${tag}]`).join(html);
  // 带属性标签 -> span
  s = s
    .replace(/\[color=([^\]]*)\]/g, '<span style="color:$1">')
    .replace(/\[size=([^\]]*)\]/g, '<span style="font-size:$1px">')
    .replace(/\[font=([^\]]*)\]/g, '<span style="font-family:$1">')
    .replace(/\[\/(?:color|size|font)\]/g, "</span>")
    .replace(/\[align=([^\]]*)\]/g, '<div style="text-align:$1">')
    .replace(/\[\/align\]/g, "</div>");
  // 图片：ui:// 未解析时按原文降级；本地绝对路径经 toAssetUrl；其余（http 等）原样
  s = s.replace(/\[img\]([^\[]*?)\[\/img\]/g, (m, src: string) => {
    if (src.startsWith("ui://")) return m;
    const url = /^[A-Za-z]:[\\/]/.test(src) || src.startsWith("/") ? ctx.toAssetUrl(src) : src;
    return `<img src="${url}" style="vertical-align:middle" alt="">`;
  });
  // 链接：静态渲染降级为下划线 span 携带 data-href（不做跳转交互）
  s = s.replace(/\[url=([^\]]*)\]([\s\S]*?)\[\/url\]/g, (_m, href: string, body: string) =>
    `<span style="text-decoration:underline" data-href="${href}">${body}</span>`);
  return s;
}

export function renderTextNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, colorOverride, unsupported } = input;
  // R23：输入框静态呈现：无 text 渲染 prompt（作者自带 UBB 占位样式），password 渲染圆点
  const isInput = node.type === "inputtext";
  const usingPrompt = isInput && !node.attrs.text;
  let attrs = dataAttrs(node, comp.file);
  if (isInput) {
    attrs += ` data-fgui-input="true"`;
    if (node.attrs.password === "true") attrs += ` data-fgui-password="true"`;
    if (node.attrs.maxLength !== undefined) attrs += ` data-fgui-maxlength="${esc(node.attrs.maxLength)}"`;
  }
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  const autoSize = node.attrs.autoSize ?? "none";
  if (autoSize === "height" && geo.size) style.push("height:auto"); // 高度随内容自适应
  if (autoSize === "both") style.push("width:auto", "height:auto"); // R23：Both 不换行随内容（见 white-space）
  const fontSize = Number(node.attrs.fontSize ?? 12);
  style.push(`font-size:${fontSize}px`);
  // 行高：对齐 FairyGUI 排版公式（缺省 leading=3）
  const leading = Number(node.attrs.leading ?? 3);
  style.push(`line-height:${Math.round(fontSize * 1.25) + leading - 1}px`);
  if (node.attrs.letterSpacing !== undefined) style.push(`letter-spacing:${node.attrs.letterSpacing}px`);
  // gearColor 默认页覆盖 > 属性色
  style.push(`color:${colorOverride ?? toCssColor(node.attrs.color, "#000000")}`);
  // R23：样式布尔
  if (node.attrs.bold === "true") style.push("font-weight:bold");
  if (node.attrs.italic === "true") style.push("font-style:italic");
  if (node.attrs.underline === "true") style.push("text-decoration:underline");
  // R23：阴影（shadowOffset 缺省 1,1；y 向下为正与 CSS 同向）
  if (node.attrs.shadowColor) {
    const [sx, sy] = (node.attrs.shadowOffset ?? "1,1").split(",").map(Number);
    style.push(`text-shadow:${sx || 0}px ${sy || 0}px 0 ${toCssColor(node.attrs.shadowColor, "#000000")}`);
  }
  // 描边（缺省 strokeSize=1 对齐 FairyGUI；CSS 居中口径补僵 2 倍近似向外描边）
  if (node.attrs.strokeColor) {
    const size = node.attrs.strokeSize !== undefined ? Number(node.attrs.strokeSize) : 1;
    style.push(`-webkit-text-stroke:${size * 2}px ${toCssColor(node.attrs.strokeColor, "#000000")}`);
  }
  // R23：singleLine / autoSize=both 不换行，其余保留换行
  const nowrap = node.attrs.singleLine === "true" || autoSize === "both";
  style.push(`white-space:${nowrap ? "nowrap" : "pre-wrap"};overflow:hidden`);
  if (node.attrs.align) style.push(`text-align:${node.attrs.align}`);
  // 垂直对齐：flex 列容器实现 top/middle/bottom
  if (node.attrs.vAlign) {
    const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[node.attrs.vAlign as "top" | "middle" | "bottom"];
    if (justify) {
      style.push("display:flex", "flex-direction:column", `justify-content:${justify}`);
    } else {
      unsupported.push({ nodeId: node.id, reason: `text vAlign=${node.attrs.vAlign} 无法识别` });
    }
  }
  // 文本内容：模板替换 -> 转义 -> UBB 白名单映射（输入框空文本时用 prompt，prompt 自带 UBB 样式）
  let text = isInput && !node.attrs.text ? node.attrs.prompt ?? "" : node.attrs.text ?? "";
  if (node.attrs.vars === "true") text = applyTemplate(text);
  if (isInput && node.attrs.password === "true" && node.attrs.text) {
    text = "\u2022".repeat(node.attrs.text.length);
  }
  text = esc(text);
  if (node.attrs.ubb === "true" || usingPrompt) text = renderUbb(text, ctx);
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}">${text}</div>`;
}
