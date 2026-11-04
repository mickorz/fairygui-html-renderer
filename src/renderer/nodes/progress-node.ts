import type { NodeRenderInput } from "../types.js";
import { renderComponentCore } from "./component-node.js";

// GProgressBar/GSlider 独立分支（扩展层分发：extention="ProgressBar"/"Slider"）
// 值填充语义在构建期（scene-builder injectProgressProps：title 格式化 + bar/bar_v 按 percent 缩放），
// 渲染期职责：语义包装（data-fgui-ext / role / aria-valuenow 等）+ 未来进度渲染特化集中地

export function renderProgressNode(input: NodeRenderInput): string {
  const { node } = input;
  const ext = node.childComp?.comp.extension ?? "";
  // 定义级+实例级合并后的值（构建期已用同一规则算过，这里仅取值做 aria）
  const def = node.childComp?.comp.rootExtension?.[ext] ?? {};
  const inst = node.extensionProps?.[ext] ?? {};
  const num = (k: string, d: number) => {
    const raw = inst[k] ?? def[k];
    return raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : d;
  };
  const value = num("value", 50);
  const min = num("min", 0);
  const max = num("max", 100);
  const html = renderComponentCore(input);
  const semantics = [
    `data-fgui-ext="${ext}"`,
    `role="progressbar"`,
    `aria-valuemin="${min}"`,
    `aria-valuemax="${max}"`,
    `aria-valuenow="${value}"`,
  ].join(" ");
  return html.replace("<div ", `<div ${semantics} `);
}
