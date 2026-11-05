import type { NodeRenderInput } from "../types.js";
import { renderTextLike } from "./text-node.js";

// inputtext 节点（GTextInput）：静态呈现 text/prompt/password 圆点/maxlength（真实输入属运行时，N7）
export function renderInputTextNode(input: NodeRenderInput): string {
  return renderTextLike(input, "inputtext");
}
