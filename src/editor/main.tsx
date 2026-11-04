import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installFidelityHooks } from "./dev/fidelity-hooks";
import "grapesjs/dist/css/grapes.min.css"; // 编辑器工具层样式（badge/toolbar/resizer），缺失则 handle 0 尺寸不可交互
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 保真度验证钩子（check:grapes 用；幂等，常驻无副作用）
installFidelityHooks();
