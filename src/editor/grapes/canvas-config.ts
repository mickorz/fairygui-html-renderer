// 固定设计画布配置（Task 2）：
// - 画布保持固定设计尺寸，不随浏览器窗口改变设计坐标
// - 窗口只影响显示缩放（Canvas zoom，transform 实现），导出坐标不受影响
// - 画布框架样式经 GrapesJS canvas.frameStyle 注入（iframe 文档级 style，不进 CSS Composer 不污染导出）
//   加 !important 防止样本 CSS 的 body 规则干扰画布框架（画布背景是编辑器配置，不随样本变化）

export interface GameCanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
}

export const DEFAULT_CANVAS: GameCanvasConfig = {
  width: 750,
  height: 1334,
  backgroundColor: "#808080",
};

/** 画布 iframe 文档级样式（frameStyle 覆盖 GrapesJS 默认的 body 背景 #fff） */
export function canvasFrameStyle(config: GameCanvasConfig = DEFAULT_CANVAS): string {
  return (
    "body{" +
    "width:" + config.width + "px!important;" +
    "height:" + config.height + "px!important;" +
    "margin:0!important;" +
    "background:" + config.backgroundColor + "!important;" +
    "overflow:hidden!important" +
    "}"
  );
}
