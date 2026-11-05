import type { NodeRenderInput } from "../types.js";
import { renderTextLike } from "./text-node.js";

// richtext 节点（GRichTextField）：ubb 属性驱动富文本映射（UBB 白名单，R13）
export function renderRichTextNode(input: NodeRenderInput): string {
  return renderTextLike(input, "richtext");
}
