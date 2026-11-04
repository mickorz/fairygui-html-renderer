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
  const attrs = dataAttrs(node, comp.file);
  const style = [`${gearStyle}${baseStyle(geo, node)}`];
  const autoSize = node.attrs.autoSize ?? "none";
  if (autoSize === "height" && geo.size) style.push("height:auto"); // 高度随内容自适应
  const fontSize = Number(node.attrs.fontSize ?? 12);
  style.push(`font-size:${fontSize}px`);
  // 行高：对齐 FairyGUI 排版公式（缺省 leading=3）
  const leading = Number(node.attrs.leading ?? 3);
  style.push(`line-height:${Math.round(fontSize * 1.25) + leading - 1}px`);
  if (node.attrs.letterSpacing !== undefined) style.push(`letter-spacing:${node.attrs.letterSpacing}px`);
  // gearColor 默认页覆盖 > 属性色
  style.push(`color:${colorOverride ?? toCssColor(node.attrs.color, "#000000")}`);
  // 描边（近似：FairyGUI 描边向外，CSS text-stroke 居中，视觉略细）
  if (node.attrs.strokeColor) {
    const size = node.attrs.strokeSize ? Number(node.attrs.strokeSize) : 2;
    style.push(`-webkit-text-stroke:${size}px ${toCssColor(node.attrs.strokeColor, "#000000")}`);
  }
  style.push("white-space:pre-wrap;overflow:hidden");
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
  // 文本内容：模板替换 -> 转义 -> UBB 白名单映射
  let text = node.attrs.text ?? "";
  if (node.attrs.vars === "true") text = applyTemplate(text);
  text = esc(text);
  if (node.attrs.ubb === "true") text = renderUbb(text, ctx);
  return `<div ${attrs} class="fgui-node" style="${style.join(";")}">${text}</div>`;
}
