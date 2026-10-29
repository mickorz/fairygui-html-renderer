import path from "node:path";
import { createApp } from "./server.js";

// 只读工作区服务启动入口：npm run serve
// 工程根：环境变量 FGUI_PROJECT_ROOT，默认 ./CC-Default；端口：PORT，默认 7788

const root = path.resolve(process.env.FGUI_PROJECT_ROOT ?? "CC-Default");
const port = Number(process.env.PORT ?? 7788);

createApp({ rootDir: root }).listen(port, () => {
  console.log(`FairyGUI 工作区已启动: http://localhost:${port}/  (工程根: ${root})`);
});
