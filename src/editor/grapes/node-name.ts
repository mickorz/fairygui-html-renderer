import type { Component } from "grapesjs";

// 图层显示名（Task 4）：四级优先级
// data-fgui-node-name > data-fgui-node-id / id > class 首项 > tag+序号
// 说明：不做任何 DOM 改写，仅读取属性生成显示名

export function nodeDisplayName(cmp: Component): string {
  const attrs = cmp.getAttributes() as Record<string, string | undefined>;
  const explicit = attrs["data-fgui-node-name"];
  if (explicit) return explicit;
  const nodeId = attrs["data-fgui-node-id"] || attrs["id"];
  if (nodeId) return nodeId;
  const cls = (attrs["class"] ?? "").split(/\s+/).filter(Boolean)[0];
  if (cls) return cls;
  const idx = (() => {
    try {
      return cmp.index();
    } catch {
      return 0;
    }
  })();
  return cmp.get("tagName") + "-" + idx;
}
