// 状态栏（Task 4）：选中节点名 + 组件计数（随编辑器快照刷新）
import { type ReactElement } from "react";
import { useEditorSnapshot } from "../grapes/use-editor";
import { getEditor } from "../grapes/editor-instance";
import { nodeDisplayName } from "../grapes/node-name";
import type { Component } from "grapesjs";

// 组件计数（递归全部子组件，不含 wrapper 自身）
function countComponents(): number {
  try {
    const wrapper = getEditor().getWrapper();
    if (!wrapper) return 0;
    const count = (c: Component): number => {
      const kids = Array.from(c.components()) as Component[];
      return kids.reduce((acc: number, k) => acc + 1 + count(k), 0);
    };
    return count(wrapper as unknown as Component);
  } catch {
    return 0;
  }
}

export default function StatusBar(): ReactElement {
  useEditorSnapshot();
  let selectedName = "-";
  try {
    const sel = getEditor().getSelected();
    selectedName = sel ? nodeDisplayName(sel) : "-";
  } catch {
    selectedName = "-";
  }
  return (
    <div className="flex items-center gap-3 h-full px-2 text-[11px] text-[#999]" data-testid="status-bar">
      <span>
        选中：<span className="text-[#ddd]">{selectedName}</span>
      </span>
      <span>
        组件：<span className="text-[#ddd]">{countComponents()}</span>
      </span>
      <span className="flex-1" />
      <span>Ctrl+Z 撤销 / Ctrl+Shift+Z 重做</span>
    </div>
  );
}
