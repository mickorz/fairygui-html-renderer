// 图层树（Task 4）：递归渲染 GrapesJS 真实组件树（getWrapper 起始）
// 不做任何 DOM 结构美化改写；点击双向同步选中；展开/收起
import { useState, type ReactElement } from "react";
import type { Component } from "grapesjs";
import { getEditor } from "../grapes/editor-instance";
import { useEditorSnapshot } from "../grapes/use-editor";
import { nodeDisplayName } from "../grapes/node-name";

/** 结构性子组件（textnode 是文本叶子，不在图层树展示） */
function structuralChildren(cmp: Component): Component[] {
  return cmp
    .components()
    .filter((k: Component) => k.get("type") !== "textnode")
    .map((k: Component) => k as Component);
}

function selectComponent(cmp: Component): void {
  getEditor().select(cmp);
}

function TreeNode({ cmp, depth }: { cmp: Component; depth: number }): ReactElement {
  const snap = useEditorSnapshot();
  const [open, setOpen] = useState(depth < 2);
  const kids = structuralChildren(cmp);
  const selected = snap.selectedId === cmp.getId();

  return (
    <div className="layer-node">
      <div
        className={
          "flex items-center gap-1 cursor-pointer py-0.5 pr-1 rounded select-none " +
          (selected ? "bg-[#4a5a7a] text-white" : "hover:bg-[#333]")
        }
        style={{ paddingLeft: 4 + depth * 12 }}
        data-testid="layer-node"
        data-cmp-id={cmp.getId()}
        onClick={() => selectComponent(cmp)}
      >
        {kids.length > 0 ? (
          <button
            className="w-4 h-4 shrink-0 leading-none text-xs text-[#aaa] hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
            title={open ? "收起" : "展开"}
          >
            {open ? "-" : "+"}
          </button>
        ) : (
          <span className="w-4 shrink-0 text-center text-[10px] text-[#666]">
            &middot;
          </span>
        )}
        <span className="truncate text-xs">{nodeDisplayName(cmp)}</span>
      </div>
      {open && kids.map((k) => <TreeNode key={k.getId()} cmp={k} depth={depth + 1} />)}
    </div>
  );
}

export default function LayerTree(): ReactElement {
  useEditorSnapshot();
  let root: Component | null = null;
  try {
    root = (getEditor().getWrapper() ?? null) as Component | null;
  } catch {
    root = null;
  }
  if (!root) return <div className="p-2 text-xs text-[#888]">编辑器未初始化</div>;
  return (
    <div className="h-full overflow-auto py-1" data-testid="layer-tree">
      <TreeNode cmp={root} depth={0} />
    </div>
  );
}
