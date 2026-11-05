// 编辑器五区布局（Task 5 接线会话）：顶栏 / 图层 / 画布 / 属性 / 状态栏
// React 只控制画布外围 UI，画布内部 DOM 全归 GrapesJS
// 会话流（?session=<id>）：GET 恢复（projectData 优先 + 一致性对比）→ 编辑 → 保存（PUT 乐观锁）
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createEditorInstance, getEditor } from "./grapes/editor-instance";
import { loadSessionIntoEditor, saveSession, type ConsistencyDiff } from "./grapes/session";
import TopToolbar from "./components/TopToolbar";
import LayerTree from "./components/LayerTree";
import PropertyPanel from "./components/PropertyPanel";
import StatusBar from "./components/StatusBar";

type SessionState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; id: string; revision: string }
  | { status: "inconsistent"; id: string; revision: string; diffs: ConsistencyDiff[] }
  | { status: "error"; message: string };

export default function App(): ReactElement {
  const canvasHostRef = useRef<HTMLElement>(null);
  const [session, setSession] = useState<SessionState>({ status: "none" });
  const [saveMessage, setSaveMessage] = useState("");
  const [convertMessage, setConvertMessage] = useState("");
  const sessionRef = useRef<SessionState>({ status: "none" });
  sessionRef.current = session;

  // 等编辑器初始化完成（编辑器由 fidelity-hooks 轮询挂载，先于本 effect 亦可）
  const waitEditor = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          getEditor();
          clearInterval(timer);
          resolve(true);
        } catch {
          if (Date.now() - start > 15000) {
            clearInterval(timer);
            resolve(false);
          }
        }
      }, 50);
    });
  }, []);

  // 会话载入（?session=<id>）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("session");
    if (!id) return;
    setSession({ status: "loading" });
    void (async () => {
      const ready = await waitEditor();
      if (!ready) {
        setSession({ status: "error", message: "编辑器初始化超时" });
        return;
      }
      const result = await loadSessionIntoEditor(getEditor(), id);
      if (result.status === "ok") setSession({ status: "ok", id, revision: result.info.sourceRevision });
      else if (result.status === "inconsistent")
        setSession({ status: "inconsistent", id, revision: result.info.sourceRevision, diffs: result.diffs });
      else setSession({ status: "error", message: "会话不存在或导入被阻断：" + id });
    })();
  }, [waitEditor]);

  // 保存（Save 按钮 / Ctrl+S）
  const doSave = useCallback(async () => {
    const s = sessionRef.current;
    if (s.status !== "ok" && s.status !== "inconsistent") return;
    const result = await saveSession(getEditor(), s.id, s.revision);
    if (result.status === "saved") {
      setSession({ status: "ok", id: s.id, revision: result.sourceRevision });
      setSaveMessage("已保存（" + result.sourceRevision + "）");
    } else if (result.status === "conflict") {
      setSaveMessage("版本冲突：本地 " + result.expected + "，服务端 " + result.actual + "，请刷新重试");
    } else if (result.status === "export-blocked") {
      setSaveMessage("导出被阻断：" + result.reasons.join("；"));
    } else {
      setSaveMessage("保存失败：" + result.message);
    }
  }, []);

  // 预览：GrapesJS 内建 preview 命令（全屏 iframe，右上角关闭返回）
  const doPreview = useCallback(() => {
    getEditor().runCommand("preview");
  }, []);

  // 导出：先保存（convert 读磁盘保存态），再调服务端 convert 路由生成 FairyGUI 包
  const doExport = useCallback(async () => {
    const s = sessionRef.current;
    if (s.status !== "ok" && s.status !== "inconsistent") return;
    setConvertMessage("保存中...");
    await doSave();
    setConvertMessage("转换中...");
    const pkgName = s.id + "-pkg";
    try {
      const r = await fetch("/api/editor/session/" + encodeURIComponent(s.id) + "/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outPkgName: pkgName }),
      });
      const d = (await r.json()) as { error?: { code?: string }; pkgId?: string; report?: { nodeTotal: number; skippedCount?: number } };
      if (r.status === 400 && d.error?.code === "PKG_EXISTS") {
        setConvertMessage("包已存在（不覆盖）：" + pkgName);
        return;
      }
      if (!r.ok) {
        setConvertMessage("转换失败：" + (d.error?.code ?? r.status));
        return;
      }
      setConvertMessage("已转换 " + pkgName + "（" + (d.report?.nodeTotal ?? "?") + " 节点，跳过 " + (d.report?.skippedCount ?? 0) + "）");
    } catch (e) {
      setConvertMessage("转换失败：" + String(e));
    }
  }, [doSave]);

  // 「以恢复态为准并重新保存」：清不一致标记后保存
  const keepRestoredAndSave = useCallback(async () => {
    const s = sessionRef.current;
    if (s.status !== "inconsistent") return;
    setSession({ status: "ok", id: s.id, revision: s.revision });
    await doSave();
  }, [doSave]);

  useEffect(() => {
    if (canvasHostRef.current) createEditorInstance(canvasHostRef.current);
    // Ctrl+S：保存会话（无会话时仅阻止浏览器保存弹窗）
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (sessionRef.current.status === "ok" || sessionRef.current.status === "inconsistent") void doSave();
        else setSaveMessage("无会话，保存不可用（需 ?session=<id> 打开）");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  const banner =
    session.status === "inconsistent" ? (
      <div className="bg-[#7a3a3a] text-white text-xs px-3 py-2 flex items-center gap-2 flex-wrap" data-testid="consistency-banner">
        <span>恢复状态与磁盘导出文件不一致（{session.diffs.map((d) => d.kind + "：" + d.detail).join("；")}）</span>
        <button className="px-2 py-0.5 rounded bg-[#3a5a7a] hover:bg-[#4a6a9a]" onClick={() => void keepRestoredAndSave()}>
          以恢复态为准并重新保存
        </button>
        <button className="px-2 py-0.5 rounded bg-[#555] hover:bg-[#666]" onClick={() => setSaveMessage("已取消：保持恢复态，不覆盖磁盘文件")} data-testid="consistency-cancel">
          取消
        </button>
      </div>
    ) : null;

  return (
    <div className="editor-layout">
      <header className="region region-top">
        <TopToolbar
          onSave={doSave}
          saveEnabled={session.status === "ok" || session.status === "inconsistent"}
          onPreview={doPreview}
          onExport={() => void doExport()}
          exportEnabled={session.status === "ok" || session.status === "inconsistent"}
        />
      </header>
      {banner}
      <aside className="region region-layers">
        <LayerTree />
      </aside>
      <main ref={canvasHostRef} className="region region-canvas" id="gjs-canvas-host" />
      <aside className="region region-props">
        <PropertyPanel />
      </aside>
      <footer className="region region-status">
        <StatusBar />
        {saveMessage ? (
          <span className="text-[#e8b34b]" data-testid="save-message">
            {saveMessage}
          </span>
        ) : null}
        {convertMessage ? (
          <span className="text-[#7ac0e8]" data-testid="convert-message">
            {convertMessage}
            {convertMessage.startsWith("已转换") && (session.status === "ok" || session.status === "inconsistent") ? (
              <a
                className="ml-2 underline text-[#9ad0f0]"
                href={"/view?component=" + encodeURIComponent(session.id + "-pkg") + "/Root.xml&bare=1"}
                target="_blank"
                rel="noreferrer"
              >
                回读预览
              </a>
            ) : null}
          </span>
        ) : null}
      </footer>
    </div>
  );
}
