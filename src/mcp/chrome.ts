import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// Chrome headless 截图（阶段 D）：零依赖，直接调用系统 Chrome 的 --screenshot 能力
// --virtual-time-budget 等待页面 focus 高亮 JS 执行完成后再截屏

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

/**
 * 用 Chrome headless 对 URL 截图并写入 outFile。
 * virtualTimeBudgetMs：虚拟时间预算，页面 JS（如 focus 高亮）执行后再截屏。
 */
export function screenshotUrl(htmlUrl: string, outFile: string, width: number, height: number, virtualTimeBudgetMs = 4000): void {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("未找到 Chrome，请安装 Chrome 或通过 CHROME_PATH 环境变量指定 chrome.exe 路径");
  }
  const r = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      `--screenshot=${outFile}`,
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${virtualTimeBudgetMs}`,
      htmlUrl,
    ],
    { timeout: 30_000, encoding: "buffer" },
  );
  if (!fs.existsSync(outFile)) {
    const stderr = r.stderr?.toString().split("\n").slice(-3).join(" ").slice(0, 300) ?? "";
    throw new Error(`截图失败（Chrome 退出码 ${r.status}）${stderr ? ": " + stderr : ""}`);
  }
}
