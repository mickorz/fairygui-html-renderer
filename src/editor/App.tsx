// 编辑器五区布局（Task 4 接线完成）：顶栏 / 图层 / 画布 / 属性 / 状态栏
// React 只控制画布外围 UI，画布内部 DOM 全归 GrapesJS
import { useEffect, useRef } from "react";
import { createEditorInstance } from "./grapes/editor-instance";
import TopToolbar from "./components/TopToolbar";
import LayerTree from "./components/LayerTree";
import PropertyPanel from "./components/PropertyPanel";
import StatusBar from "./components/StatusBar";

export default function App() {
  const canvasHostRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (canvasHostRef.current) createEditorInstance(canvasHostRef.current);
    // Ctrl+S：阻止浏览器保存弹窗（保存动作 Task 5 接 PUT session）
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        console.log("[editor] 保存快捷键触发（Task 5 接 PUT session）");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="editor-layout">
      <header className="region region-top">
        <TopToolbar />
      </header>
      <aside className="region region-layers">
        <LayerTree />
      </aside>
      <main ref={canvasHostRef} className="region region-canvas" id="gjs-canvas-host" />
      <aside className="region region-props">
        <PropertyPanel />
      </aside>
      <footer className="region region-status">
        <StatusBar />
      </footer>
    </div>
  );
}
