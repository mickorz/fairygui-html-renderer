// 顶部工具栏：Zoom In/Out/Fit + Undo/Redo + 画布缩放百分比 + 保存（会话 PUT）
// + 预览（GrapesJS 内建 preview 命令）+ 导出（服务端 convert 路由，P0 收尾接线）
import { useCallback, useState, type ReactElement } from "react";
import { getEditor } from "../grapes/editor-instance";
import { DEFAULT_CANVAS } from "../grapes/canvas-config";

const ZOOM_STEP = 10;
const ZOOM_MIN = 10;
const ZOOM_MAX = 300;

export default function TopToolbar({
  onSave,
  saveEnabled,
  onPreview,
  onExport,
  exportEnabled,
}: {
  onSave: () => void;
  saveEnabled: boolean;
  onPreview: () => void;
  onExport: () => void;
  exportEnabled: boolean;
}): ReactElement {
  const [zoom, setZoom] = useState(100);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const refreshUndoState = useCallback(() => {
    const um = getEditor().UndoManager;
    setCanUndo(um.hasUndo());
    setCanRedo(um.hasRedo());
  }, []);

  const setZoomAndRefresh = useCallback(
    (z: number) => {
      const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z)));
      getEditor().Canvas.setZoom(clamped);
      setZoom(clamped);
      refreshUndoState();
    },
    [refreshUndoState],
  );

  const zoomIn = useCallback(() => setZoomAndRefresh(zoom + ZOOM_STEP), [zoom, setZoomAndRefresh]);
  const zoomOut = useCallback(() => setZoomAndRefresh(zoom - ZOOM_STEP), [zoom, setZoomAndRefresh]);

  const fit = useCallback(() => {
    const host = document.getElementById("gjs-canvas-host");
    if (!host) return;
    const z = Math.min((host.clientWidth - 40) / DEFAULT_CANVAS.width, (host.clientHeight - 40) / DEFAULT_CANVAS.height) * 100;
    setZoomAndRefresh(Math.max(ZOOM_MIN, Math.round(z)));
  }, [setZoomAndRefresh]);

  const undo = useCallback(() => {
    getEditor().UndoManager.undo();
    refreshUndoState();
  }, [refreshUndoState]);

  const redo = useCallback(() => {
    getEditor().UndoManager.redo();
    refreshUndoState();
  }, [refreshUndoState]);

  const btn = "px-2 py-1 rounded bg-[#3a3a3a] hover:bg-[#4a4a4a] disabled:opacity-40 disabled:cursor-not-allowed text-sm";

  return (
    <div className="flex items-center gap-2 h-full px-2">
      <span className="text-sm font-bold text-[#e8b34b]">UI Editor</span>
      <button className={btn} onClick={undo} disabled={!canUndo} title="Ctrl+Z">
        撤销
      </button>
      <button className={btn} onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">
        重做
      </button>
      <button className={btn} onClick={zoomOut} title="缩小">
        缩小
      </button>
      <span className="text-xs w-12 text-center select-none">{zoom}%</span>
      <button className={btn} onClick={zoomIn} title="放大">
        放大
      </button>
      <button className={btn} onClick={fit} title="适应窗口">
        适应
      </button>
      <span className="flex-1" />
      <button className={btn} onClick={onPreview} title="全屏预览（Esc 关闭）">
        预览
      </button>
      <button className={btn} disabled={!saveEnabled} onClick={onSave} title="Ctrl+S">
        保存
      </button>
      <button className={btn} disabled={!exportEnabled} onClick={onExport} title="保存并转换为 FairyGUI 包">
        导出
      </button>
    </div>
  );
}
