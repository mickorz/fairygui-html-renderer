import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Chrome headless 截图（阶段 D）：零依赖，直接调用系统 Chrome 的 --screenshot 能力
// --virtual-time-budget 等待页面 focus 高亮 JS 执行完成后再截屏
// 每次独立临时 user-data-dir：避免与用户正在运行的 Chrome 争用默认 profile 锁
//
// 两个版本（P0 截图功能踩坑后拆分）：
//   screenshotUrl       —— 同步 spawnSync：目标必须是 file:// 或非本进程监听的 URL。
//                           若截图 URL 指向本服务（http://localhost:<本服务端口>），spawnSync 会阻塞
//                           事件循环，Chrome 的 /view 请求无人应答 -> Chrome 卡等资源 -> 超时 kill（自死锁）。
//   screenshotUrlAsync  —— 异步 spawn：事件循环不阻塞，Chrome 可正常请求本服务。HTTP 路由必须用这个。

const CANDIDATES: string[] = [
  process.env.CHROME_PATH ?? "",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function findChrome(): string | null {
  for (const c of CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function chromeArgs(outFile: string, width: number, height: number, virtualTimeBudgetMs: number, profileDir: string): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    `--user-data-dir=${profileDir}`,
    `--screenshot=${outFile}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${virtualTimeBudgetMs}`,
  ];
}

function failMessage(r: { status: number | null; stderr?: Buffer | null }): string {
  const stderr = r.stderr?.toString().split("\n").slice(-3).join(" ").slice(0, 300) ?? "";
  return `截图失败（Chrome 退出码 ${r.status}）${stderr ? ": " + stderr : ""}`;
}

/** 异步截图（事件循环不阻塞；目标 URL 可以是本服务自己提供的页面） */
export function screenshotUrlAsync(
  htmlUrl: string,
  outFile: string,
  width: number,
  height: number,
  virtualTimeBudgetMs = 4000,
): Promise<void> {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("未找到 Chrome，请安装 Chrome 或通过 CHROME_PATH 环境变量指定 chrome.exe 路径");
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgui-shot-"));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(chrome, [...chromeArgs(outFile, width, height, virtualTimeBudgetMs, profileDir), htmlUrl], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30_000,
    });
    let stderrTail = "";
    child.stderr?.on("data", (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).split("\n").slice(-3).join(" ").slice(-300);
    });
    child.on("error", (err) => reject(new Error(`截图失败（Chrome 启动异常）: ${err.message}`)));
    child.on("close", (code) => {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败忽略 */ }
      if (fs.existsSync(outFile)) resolve();
      else reject(new Error(failMessage({ status: code, stderr: Buffer.from(stderrTail) })));
    });
  });
}

/** 同步截图（仅限目标 URL 不依赖本进程事件循环时使用，如 file:// 临时 HTML） */
export function screenshotUrl(htmlUrl: string, outFile: string, width: number, height: number, virtualTimeBudgetMs = 4000): void {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("未找到 Chrome，请安装 Chrome 或通过 CHROME_PATH 环境变量指定 chrome.exe 路径");
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgui-shot-"));
  const r = spawnSync(chrome, [...chromeArgs(outFile, width, height, virtualTimeBudgetMs, profileDir), htmlUrl], {
    timeout: 30_000,
    encoding: "buffer",
  });
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败忽略 */ }
  if (!fs.existsSync(outFile)) {
    throw new Error(failMessage(r));
  }
}
