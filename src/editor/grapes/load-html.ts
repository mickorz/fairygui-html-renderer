import type { Editor } from "grapesjs";

// HTML/CSS 载入（Task 1 POC：直接 setComponents + setStyle）
// 导入保真度由 npm run check:grapes 结构化差异报告验证，不在此处做任何预处理改写

/** 载入 HTML/CSS 并等待画布就绪 */
export async function loadHtml(editor: Editor, bodyHtml: string, css: string): Promise<void> {
  editor.setComponents(bodyHtml);
  editor.setStyle(css);
  await waitForCanvas(editor);
}

/** 等待画布 iframe 就绪且组件树构建完成（轮询 + 渲染稳定延时） */
export async function waitForCanvas(editor: Editor, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frameEl = (editor.Canvas as unknown as { getFrame?: () => { view?: { el?: HTMLElement } } } | undefined)
      ?.getFrame?.()?.view?.el;
    if (frameEl && editor.getComponents().length > 0) {
      await new Promise((r) => setTimeout(r, 200)); // 渲染稳定延时
      return;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("画布未在超时时间内就绪");
}
