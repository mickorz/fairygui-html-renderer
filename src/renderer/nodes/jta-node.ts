import type { NodeRenderInput } from "../types.js";
import { baseStyle, dataAttrs, tintStyle } from "../utils.js";
import { parseJta } from "../../parser/jta.js";
import { pickGearValue } from "../gear.js";

// jta（movieclip）节点渲染：静态渲染单帧（frame 属性 / gearAni 默认页取值优先，缺省第 0 帧）
// 帧图以 data URL 内联（jta 内嵌 PNG 无独立文件通道）；帧图按帧矩形摆放在动画画布内

export function renderJtaNode(input: NodeRenderInput): string {
  const { node, comp, ctx, geo, gearStyle, colorOverride, unsupported, tints } = input;
  const attrs = dataAttrs(node, comp.file);
  const res = ctx.pkg.byId(node.src ?? "");
  if (!res || res.kind !== "other" || res.type !== "movieclip") {
    unsupported.push({ nodeId: node.id, reason: `jta 引用资源 ${node.src ?? "?"} 未找到或非 movieclip` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
  }
  let jta;
  try {
    jta = parseJta(res.file);
  } catch (e) {
    unsupported.push({ nodeId: node.id, reason: `jta 解析失败: ${(e as Error).message}` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)};border:1px dashed #ff4d4f"></div>`;
  }
  // 帧号：gearAni 默认页取值（值格式 "frame,playing,..."）> frame 属性 > 0
  const gearAni = node.gears.find((g) => g.kind === "ani");
  const aniValue = gearAni ? pickGearValue(gearAni, comp.controllers.find((c) => c.name === gearAni.controller)) : null;
  const frameNo = Math.max(0, Math.min(jta.frames.length - 1, Number((aniValue ?? "").split(",")[0] || node.attrs.frame || 0) || 0));
  const frame = jta.frames[frameNo];
  if (!frame) {
    unsupported.push({ nodeId: node.id, reason: `jta 无帧 ${frameNo}` });
    return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}"></div>`;
  }
  if (!geo.size) geo.size = [jta.width, jta.height];
  // 染色（color/gearColor，复用 feColorMatrix 链路）
  const tint = tintStyle(colorOverride ?? node.attrs.color, tints).trim();
  const imgStyle = [
    `position:absolute;left:${frame.x}px;top:${frame.y}px;width:${frame.w}px;height:${frame.h}px`,
    tint ? `filter:${tint}` : "",
  ].filter(Boolean).join(";");
  return `<div ${attrs} class="fgui-node" style="${gearStyle}${baseStyle(geo, node)}"><img src="data:image/png;base64,${frame.png.toString("base64")}" style="${imgStyle}" alt=""></div>`;
}
