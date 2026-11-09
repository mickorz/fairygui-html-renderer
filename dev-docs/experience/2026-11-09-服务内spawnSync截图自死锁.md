# 服务内同步 spawn 截图自死锁（spawnSync + 自身 URL）

## 问题现象

- 新路由 `/api/screenshot`（组件区域截图）调用 `screenshotUrl`（spawnSync 同步起 Chrome headless）截图 `http://localhost:7788/view?...`（本服务自己的页面），每次 30s 超时失败：`截图失败（Chrome 退出码 null）` + stderr 里 Google Update named pipe 拒绝访问（噪音，红鲱鱼）。
- 同参数手动 `chrome.exe` 直跑、独立 node 脚本 spawnSync、`cmd /c node`、后台 nohup node 全部秒级成功。
- MCP 的 screenshot_component（同样 spawnSync）一直成功——它截的是 file:// 临时 HTML。

## 排查过程

1. 手动 CLI 复现成功 -> 排除 Chrome/参数/URL 问题
2. 独立 node spawnSync 成功 -> 排除 spawnSync 本身
3. cmd /c、后台无 TTY 复现全成功 -> 排除 shell/控制台环境
4. 加独立 `--user-data-dir`（防默认 profile 锁）+ 重启服务进程 -> 仍失败
5. 关键差异收敛：成功的都是"截图 URL 的服务端不是本进程"；唯一失败的是"截图 URL 指向本服务自己"

## 根因

**自死锁**：Node 服务进程单线程。`spawnSync` 同步阻塞事件循环直到 Chrome 退出；Chrome headless 加载 `http://localhost:7788/view?...` 需要向**本服务**发 HTTP 请求拿页面与图片资源；服务的请求处理循环正被 spawnSync 占死，Chrome 的请求永远无人应答；Chrome 卡在等资源直到 30s 超时被 kill，PNG 永远写不出来。退出码 null（超时 kill）。

MCP 一直成功的原因：它先渲染 HTML 写临时文件用 `file://` 打开，资源也是 fileUrl 直连——全程零 HTTP 请求，不依赖本进程事件循环。

## 解决方案

`src/server/chrome.ts` 拆两个版本：

- `screenshotUrlAsync`（spawn + Promise，事件循环不阻塞）：**目标 URL 是本服务页面时必须用它**。HTTP 路由 `/api/screenshot` 用它（await 后 Chrome 的 /view 请求能被本服务正常处理）。
- `screenshotUrl`（spawnSync 同步版）：仅限目标 URL 不依赖本进程事件循环（file:// 临时 HTML 等）；MCP screenshot_component 继续用它。

## 预防/注意事项

- **服务进程内同步 spawn 子进程去访问本服务自己的 URL = 死锁**。规则：Node 单线程 HTTP 服务里凡是"起子进程抓本服务资源"的链路一律异步 spawn。
- 排查这类"间歇性/环境相关"的挂起时，先问一句"子进程的目标资源由谁提供"——提供者如果是本进程且被同步阻塞，就是死锁，不是环境问题。
- Chrome stderr 里 Google Update named pipe 拒绝访问是常见噪音（手动成功时也有），不要被它带偏排查方向。
- （同轮连带坑）tests/convert-check 的 root 是 fairy-writer 的**输出**工程根而非官方 Demo 数据根：屏蔽官方 Demo 后硬编码路径让 fairy-writer 的 mkdirSync 复活了一个残缺 projects/CC-Default（3 包），污染了"跟随数据位置"的测试解析链。测试的输出根应独立沙盒（tmp-convert/），不得寄生在真实数据工程里。
