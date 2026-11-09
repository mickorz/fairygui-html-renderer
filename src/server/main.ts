import fs from "node:fs";
import path from "node:path";
import { createApp } from "./server.js";

// 只读工作区服务启动入口：npm run serve
// 端口：PORT，默认 7788
// 工作区发现（多工程切换 P0-A）：
//   1. ./projects/ 注册目录存在且含工程（子目录含 assets/） -> 多工程模式（?project= 白名单切换）
//   2. 否则回退单工程（现状）：FGUI_PROJECT_ROOT 环境变量（工程根，绝对或相对均可），默认 ./CC-Default

const port = Number(process.env.PORT ?? 7788);
const projectsDir = path.resolve("projects");
const useMulti =
  fs.existsSync(projectsDir) &&
  fs.readdirSync(projectsDir).some((n) => fs.existsSync(path.join(projectsDir, n, "assets")));

const app = createApp(useMulti ? { projectsDir } : { rootDir: process.env.FGUI_PROJECT_ROOT ?? "CC-Default" });
app.listen(port, () => {
  console.log(
    `FairyGUI 工作区已启动: http://localhost:${port}/  ` +
      (useMulti ? `(多工程注册目录: ${projectsDir})` : `(工程根: ${path.resolve(process.env.FGUI_PROJECT_ROOT ?? "CC-Default")})`),
  );
});
