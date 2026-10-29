---
name: browser-selftest
version: 0.1.0
display_name: 浏览器自动化自测
display_name_en: Browser Self-Testing
description: >
  安装并配置 pi-browser-use 浏览器插件（pi 的 chrome-devtools-mcp 封装，自持 headless Chrome），
  并在 web 项目开发中使用浏览器自动化做端到端自测：导航、快照、点击、脚本断言、截图存档。
  Use when developing a web project or HTTP service that needs browser verification (navigate,
  click, screenshot, scripted assertions), or when first installing/configuring pi-browser-use
  on a machine.
description_zh: >-
  安装并配置 pi-browser-use 浏览器插件（pi 的 chrome-devtools-mcp 封装，自持 headless Chrome），
  并在 web 项目开发中使用浏览器自动化做端到端自测：导航、快照、点击、脚本断言、截图存档。
  适用场景：开发 web 项目或 HTTP 服务需要浏览器验证（导航、点击、截图、脚本化断言），
  或首次在新机器上安装配置 pi-browser-use。
description_en: >-
  Install and configure the pi-browser-use extension (pi's chrome-devtools-mcp wrapper with its own
  headless Chrome), and use browser automation for end-to-end self-testing during web project
  development: navigation, snapshots, clicks, scripted assertions, and screenshot archiving.
  Use when developing a web project or HTTP service that needs browser verification (navigate,
  click, screenshot, scripted assertions), or when first installing/configuring pi-browser-use
  on a machine.
---

# 浏览器自动化自测（pi-browser-use）

在 pi 中用浏览器自动化对 web 项目做端到端自测：打开页面、点按钮、填表单、跑断言、截图留档。
安装是一次性准备；日常开发主要用「自测工作流」一节。

## 边界

- 只做端到端验证（真实浏览器行为）；单元/回归断言仍由项目 check 脚本负责，互不替代
- 只操作本地或有权访问的服务；遇到登录墙/人机验证让用户手动过一次，不要重试循环
- CLI 优先：能用 curl / API 验证的就不要驱动浏览器

## 一、安装与配置（每台机器一次性）

1. 前置：Node.js >= 24、Chrome stable。

```bash
pi install npm:pi-browser-use
```

2. 默认即用：`persistent` 模式，自持 headless Chrome（profile 在 `~/.pi/browser-profile`），
   不弹窗不抢焦点。无需额外配置。
3. 需要登录态的站点：调用 `browser_setup` 打开有头窗口人工登录一次（profile 持久保存）。
4. 首次异常时先跑 `browser_doctor` 自诊断（模式/profile/上游工具状态），它不碰任何页面。

模式速查（settings 键 `pi-browser-use`，一般不需要改）：

| 模式 | 行为 | 用途 |
| --- | --- | --- |
| `persistent`（默认） | 自持 Chrome + 保存登录态 | 日常开发自测 |
| `fresh` | 一次性干净环境 | 匿名站点/不受登录态干扰的验证 |
| `existing` | 接管正在运行的 Chrome | 少用（有授权弹窗、抢焦点） |

安装是否成功：`pi mcp list` 里应出现浏览器相关 server 且 connected（本项目环境为 chrome-devtools）。

## 二、自测工作流（web 项目日常）

浏览器工具两套命名：pi-browser-use 的 `browser_*`，或 chrome-devtools-mcp 的 `chrome_devtools_*`，
能力等价。以下以 `chrome_devtools_*` 为例（`browser_*` 把 navigate/snapshot/click/evaluate_script
换成同名 browser 版即可）。

### 1. 启动并确认被测服务

```bash
# 后台起服务（示例：本项目 npm run serve）
(nohup npm run serve > dev-examples/serve.log 2>&1 &) && sleep 4
curl -s -o /dev/null -w "%{http_code}" http://localhost:7788/   # 期望 200
```

### 2. 导航 + 快照拿 uid

```text
chrome_devtools_navigate_page { url }
chrome_devtools_take_snapshot        # a11y 树，列出可交互元素的 uid
```

页面重渲染后 uid 会失效——每次操作前重新快照。

### 3. 交互

- 点击/填写：`chrome_devtools_click` / `chrome_devtools_fill`（用快照里的 uid）
- 快照描述不了的动态内容（同源 iframe、自定义事件）用脚本：

```js
// chrome_devtools_evaluate_script：同源 iframe 深入 + 派发点击
const doc = document.getElementById("frame").contentDocument;
const el = doc.querySelector('[data-fgui-name="n4"]');
el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
return { infoBar: doc.getElementById("fgui-info").textContent };
```

### 4. 断言（三种，按需组合）

1. 快照文本：`wait_for` / snapshot 内容包含期望文案
2. 脚本断言：`evaluate_script` 返回结构化 JSON（最可靠，模型不支持读图时的首选）
3. 截图文件大小：纯色空白页只有几百字节，有内容的截图通常 >10KB

### 5. 截图存档

```text
chrome_devtools_take_screenshot { filePath: "dev-examples/<stage>-shots/01-xxx.png", format: "png" }
```

约定：存 `dev-examples/`（沙盒目录，gitignore 不进 git），文件名带序号与场景。

### 6. 需要等待 JS 执行的截图

页面有加载后脚本（如高亮定位）时，用 Chrome headless CLI 的虚拟时间预算：

```bash
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --hide-scrollbars --screenshot=<输出.png> --window-size=1280,800 \
  --virtual-time-budget=3000 "<目标 URL>"
```

### 7. 结束：精确停服务

```bash
netstat -ano | grep ":7788" | grep LISTENING   # 找 PID
taskkill //F //PID <pid>                        # 只杀目标进程
```

严禁 `taskkill //F //IM node.exe` 这类全杀命令。

## 三、常见坑

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 浏览器工具报 profile already in use | 两个会话共享同一 profile | 用 `fresh` 模式或各自 `userDataDir` |
| uid 失效 / stale element | 快照后页面重渲染 | 重新 take_snapshot |
| 模型不支持读图 | 模型能力限制 | evaluate_script 返回数据做程序化断言 + 给用户截图链接 |
| 有头窗口抢焦点 | headed 模式 | 回 headless（macOS 无法隐藏有头窗口） |
| 服务是旧代码 | 改码后未重启 | 按端口精确杀进程后重启再测 |

## 四、验证完成标准

自测完成 = 服务存活确认 + 页面可达 + 关键交互断言通过（脚本返回值）+ 截图存档 + 服务按需停止。
