// React 与 GrapesJS 的桥（Task 4）：
// 编辑器单例事件 -> 外部 store 快照 -> useSyncExternalStore 订阅；
// React 只读快照重渲染，永不触碰画布内 DOM
import { useSyncExternalStore } from "react";
import type { Component, Editor } from "grapesjs";
import { getEditor } from "./editor-instance";

export interface EditorSnapshot {
  /** 任何编辑器变更递增（选中/组件更新/undo/redo），驱动 React 重渲染 */
  tick: number;
  /** 当前选中组件 id（GrapesJS getId），未选中为 null */
  selectedId: string | null;
}

let snapshot: EditorSnapshot = { tick: 0, selectedId: null };
const listeners = new Set<() => void>();

function getSnapshot(): EditorSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  snapshot = { ...snapshot, tick: snapshot.tick + 1 };
  listeners.forEach((l) => l());
}

/** 外部主动触发快照更新（如重新加载 HTML 后刷新图层树） */
export function refreshEditorSnapshot(): void {
  emit();
}

/** 读取当前选中组件 id（不抛错：编辑器未初始化返回 null） */
function currentSelectedId(): string | null {
  try {
    return getEditor().getSelected()?.getId() ?? null;
  } catch {
    return null;
  }
}

let bound = false;

/** 绑定编辑器事件到快照（幂等，createEditorInstance 后调用一次） */
export function bindEditorEvents(ed: Editor): void {
  if (bound) return;
  bound = true;
  const bump = () => {
    snapshot = { tick: snapshot.tick + 1, selectedId: currentSelectedId() };
    listeners.forEach((l) => l());
  };
  // 选中变化
  ed.on("component:selected", bump);
  ed.on("component:deselected", bump);
  // 组件/样式变化（componentFirst=true 时 addStyle 走组件内联，触发 component:update）
  ed.on("component:update", bump);
  ed.on("styleable:change", bump);
  // 拖动/缩放结束（样式落库）
  ed.on("component:drag:end", bump);
  ed.on("component:resize:end", bump);
  // 撤销/重做
  // 撤销/重做：UndoManagerModule 无 on 声明，但内部转发 undo/redo 为 editor 事件
  // （undo_manager/index.ts:154）；新增撤销步骤必然伴随 component:update，已由上面覆盖
  ed.on("undo", bump);
  ed.on("redo", bump);
  // 重新载入（setComponents 后的组件挂载）
  ed.on("component:mount", bump);
}

/** 订阅编辑器快照（选中/更新/undo 计数变化即重渲染） */
export function useEditorSnapshot(): EditorSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 当前选中组件（随快照变化；编辑器未初始化/未选中返回 null） */
export function useSelectedComponent(): Component | null {
  useEditorSnapshot();
  try {
    return getEditor().getSelected() ?? null;
  } catch {
    return null;
  }
}
