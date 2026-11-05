import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs, tintStyle } from "../utils.js";
import { parseJta } from "../../parser/jta.js";
import { pickGearValue } from "../gear.js";

// jta（movieclip）节点渲染：静态渲染单帧（frame 属性 / gearAni 默认页取值优先，缺省第 0 帧）
// 帧图以 data URL 内联（jta 内嵌 PNG 无独立文件通道）；帧图按帧矩形摆放在动画画布内

/** loader 内容对齐偏移（align/vAlign 相对 loader 尺寸，GLoader 语义）；非 loader 返回 [0,0] */
function alignOffset(node: import("../../parser/component-parser.js").ParsedNode, size: [number, number], cw: number, ch: number): [number, number] {
  if (node.type !== "loader") return [0, 0];
  const a = node.attrs.align ?? "left";
  const v = node.attrs.vAlign ?? "top";
  const dx = a === "center" ? Math.round((size[0] - cw) / 2) : a === "right" ? size[0] - cw : 0;
  const dy = v === "middle" ? Math.round((size[1] - ch) / 2) : v === "bottom" ? size[1] - ch : 0;
  return [dx, dy];
}

/** 渲染指定 jta 文件的首帧（loader/gearIcon 指向 movieclip 时复用；frameNo 越界则钳位） */
export function renderJtaFrame(input: NodeRenderInput, file: string, frameNo: number): string {
  const { node, comp, geo, gearStyle, colorOverride, unsupported, tints } = input;
  const attrs = dataAttrs(node, comp.file);
  let jta;
  try {
    jta = parseJta(file);
  } catch (e) {
    unsupported.push({ nodeId: node.id, reason: `jta 解析失败: ${(e as Error).message}` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}"></div>`;
  }
  const frame = jta.frames[Math.max(0, Math.min(jta.frames.length - 1, frameNo))];
  if (!frame) {
    unsupported.push({ nodeId: node.id, reason: `jta 无帧 ${frameNo}` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}"></div>`;
  }
  if (!geo.size) geo.size = [jta.width, jta.height];
  // loader 承载 movieclip 时按 align/vAlign 居中摆放整个动画画布（GLoader 内容定位语义）；
  // jta 节点自身尺寸即画布，偏移恒为 0
  const canvasOff = alignOffset(node, geo.size, jta.width, jta.height);
  // 染色（color/gearColor，复用 feColorMatrix 链路）
  const tint = tintStyle(colorOverride ?? node.attrs.color, tints).trim();
  const imgStyle = [
    `position:absolute;left:${canvasOff[0] + frame.x}px;top:${canvasOff[1] + frame.y}px;width:${frame.w}px;height:${frame.h}px`,
    tint ? `filter:${tint}` : "",
  ].filter(Boolean).join(";");
  return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}"><img src="data:image/png;base64,${frame.png.toString("base64")}" style="${imgStyle}" alt=""></div>`;
}

/**
 * jta 多帧播放（N10）：全部帧图叠放，用 CSS 离散动画逐帧切换（interval 为帧间隔）。
 * 每帧 img 共享同一 keyframes（可见窗口 = 总时长的 1/N），靠负 delay 错开 -> 单帧窗口精确为 interval。
 * interval<=0 或单帧时退化为静态首帧。
 */
function renderJtaAnimated(input: NodeRenderInput, file: string, startFrame: number): string | null {
  const { node, comp, geo, gearStyle, colorOverride, tints } = input;
  const attrs = dataAttrs(node, comp.file);
  let jta;
  try {
    jta = parseJta(file);
  } catch {
    return null;
  }
  const n = jta.frames.length;
  if (n <= 1 || jta.interval <= 0) return null;
  if (!geo.size) geo.size = [jta.width, jta.height];
  const tint = tintStyle(colorOverride ?? node.attrs.color, tints).trim();
  const total = n * jta.interval;
  // 起始帧：旋转帧序，播放从 startFrame 开始
  const order = jta.frames.map((_, i) => (i + startFrame) % n);
  const imgs = order.map((fi, i) => {
    const f = jta.frames[fi];
    const st = [
      `position:absolute;left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px`,
      tint ? `filter:${tint}` : "",
      `animation:fgui-jta-${n} ${total}ms steps(1,end) infinite`,
      `animation-delay:-${i * jta.interval}ms`,
    ].filter(Boolean).join(";");
    return `<img src="data:image/png;base64,${f.png.toString("base64")}" style="${st}" alt="">`;
  }).join("");
  // 每帧可见窗口：从负 delay 起点起 1/N 时长（step-end 保证离散切换）
  const step = 100 / n;
  const style = `<style>@keyframes fgui-jta-${n}{0%{opacity:1}${step}%{opacity:0}100%{opacity:0}}</style>`;
  return `${style}<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}">${imgs}</div>`;
}

export function renderJtaNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, colorOverride, unsupported, tints } = input;
  const attrs = dataAttrs(node, comp.file);
  const res = ctx.pkg.byId(node.src ?? "");
  if (!res || res.kind !== "other" || res.type !== "movieclip") {
    unsupported.push({ nodeId: node.id, reason: `jta 引用资源 ${node.src ?? "?"} 未找到或非 movieclip` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
  }
  // 帧号：gearAni 默认页取值（值格式 "frame,playing,..."）> frame 属性 > 0
  const gearAni = node.gears.find((g) => g.kind === "ani");
  const aniValue = gearAni ? pickGearValue(gearAni, comp.controllers.find((c) => c.name === gearAni.controller)) : null;
  const frameNo = Number((aniValue ?? "").split(",")[0] || node.attrs.frame || 0) || 0;
  // 显式 frame 属性（编辑器固定帧）优先于播放
  const animated = node.attrs.frame === undefined ? renderJtaAnimated(input, res.file, frameNo) : null;
  return animated ?? renderJtaFrame(input, res.file, frameNo);
}
