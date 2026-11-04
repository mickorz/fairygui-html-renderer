// 编辑器五区布局骨架（Task 0）：顶栏 / 图层 / 画布 / 属性 / 状态栏
// Task 1 起逐区填充：GrapesJS 容器挂 region-canvas，React 只控制画布外围
import { useEffect, useRef } from "react";
import { createEditorInstance } from "./grapes/editor-instance";

export default function App() {
  const canvasHostRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (canvasHostRef.current) createEditorInstance(canvasHostRef.current);
  }, []);

  return (
    <div className="editor-layout">
      <header className="region region-top">TopToolbar</header>
      <aside className="region region-layers">LayerTree</aside>
      <main ref={canvasHostRef} className="region region-canvas" id="gjs-canvas-host" />
      <aside className="region region-props">PropertyPanel</aside>
      <footer className="region region-status">StatusBar</footer>
    </div>
  );
}
