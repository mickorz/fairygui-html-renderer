import type { NodeRenderInput } from "../types.js";
import { renderProgressLike } from "./progress-node.js";

// GSlider 独立分支（挂在扩展层：extention="Slider"）
// OpenFairy 语义：Slider 与 ProgressBar 值填充同构（percent 公式 + title 格式化 + bar/bar_v 缩放），
// grip 保持设计位（烘焙不动 grip，运行时拖动才摆位）；拖动交互属运行时不实现

export function renderSliderNode(input: NodeRenderInput): string {
  return renderProgressLike(input, "Slider");
}
