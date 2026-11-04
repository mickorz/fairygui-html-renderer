// 拖动「按需提升」策略（Task 3，评审修订）：
// - 编辑器 dragMode=absolute（editor-instance 配置）：仅用户主动拖动的节点改定位属性
// - 拖动开始快照目标节点原始布局属性（fgui-origin-layout，进 projectData 可持久化）
// - 快照不覆盖：保留最早一次的原始布局（多次拖动仍可追溯初态）
// - 拖动结束标记布局模式变化（fgui-layout-changed），供诊断/导出报告使用
// - Undo 由 GrapesJS UndoManager 原生覆盖（setStyle/set 均入栈）

import type { Editor } from "grapesjs";

export const ORIGIN_LAYOUT_KEY = "fgui-origin-layout";
export const LAYOUT_CHANGED_KEY = "fgui-layout-changed";

interface DragEventOpts {
  target?: { get?: () => unknown };
  component?: unknown;
}

/** 从 drag 事件参数中取目标组件（事件参数为 { target, parent, index } 对象） */
function targetOf(opts: DragEventOpts): { get: (key: string) => unknown; set: (key: string, v: unknown) => unknown } | null {
  const t = opts?.target ?? (opts as unknown as { component?: { get?: unknown } }).component;
  if (t && typeof (t as { get?: unknown }).get === "function") {
    return t as { get: (key: string) => unknown; set: (key: string, v: unknown) => unknown };
  }
  return null;
}

export function setupDragEnhancements(editor: Editor): void {
  editor.on("component:drag:start", (opts) => {
    const comp = targetOf(opts as DragEventOpts);
    if (!comp) return;
    if (comp.get(ORIGIN_LAYOUT_KEY)) return; // 保留最早快照
    const el = (comp as unknown as { getEl?: () => HTMLElement | null }).getEl?.();
    if (!el) return;
    const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
    comp.set(ORIGIN_LAYOUT_KEY, {
      position: cs?.position ?? "",
      display: cs?.display ?? "",
      left: el.style.left ?? "",
      top: el.style.top ?? "",
      capturedAt: "drag:start",
    });
  });

  editor.on("component:drag:end", (opts) => {
    const comp = targetOf(opts as DragEventOpts);
    if (!comp) return;
    const origin = comp.get(ORIGIN_LAYOUT_KEY) as { position?: string } | undefined;
    const el = (comp as unknown as { getEl?: () => HTMLElement | null }).getEl?.();
    const cs = el ? el.ownerDocument.defaultView?.getComputedStyle(el) : null;
    if (origin && origin.position !== "absolute" && cs?.position === "absolute") {
      // 布局模式发生了 static -> absolute 的提升，标记供诊断/导出报告
      comp.set(LAYOUT_CHANGED_KEY, true);
    }
  });
}
