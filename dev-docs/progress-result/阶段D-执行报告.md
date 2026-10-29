# 阶段 D 执行报告：MCP 与 AI 联动

- 完成时间：2026-10-29
- 状态：验收通过（`npm run check:mcp` 9/9；累计自动化断言 56 项全绿；截图产物已人工可查）

## 交付内容（对照阶段 D 执行计划）

| 任务 | 实现 |
|---|---|
| D1 workspace 模块 | listPackages / listComponents / searchWorkspace 抽取到 src/scene/workspace.ts，HTTP 服务与 MCP 共用同一实现 |
| D2 四工具 | src/mcp/tools.ts：list_components / locate_component / render_component / screenshot_component 纯函数；findNodeByKey 按稳定键全工程反查（返回节点实际所在子组件场景）；render 落盘系统临时目录 + file:/// 资源 URL（跨盘安全）；screenshot 用系统 Chrome headless `--screenshot` + `--virtual-time-budget` 等 focus 高亮执行，零新依赖 |
| D3 协议壳 | src/mcp/main.ts：stdio 换行分隔 JSON-RPC 2.0（initialize / tools/list / tools/call），约 130 行；`.pi/mcp.json` 项目级配置，pi 会话内以 `mcp__fairygui__*` 暴露 |
| D4 验收 | tests/mcp-check.ts：三类验收场景 + PNG 文件头断言 + 子进程协议冒烟（initialize → tools/list → tools/call 全流程） |

## 验收结果（v3 最终场景达成）

> locate_component 搜索 → render_component 得到 file:// URL 与结构化节点信息（含设计坐标 bounds）→ screenshot_component 出 PNG → AI 读图验证

- **同名组件重复出现**：Dup 两个 key 各自渲染定位互不串扰
- **嵌套三层以上**：closeButton 实例链 `rbw1tv9t.kcy10.n7~rbw1tv9t.dwwc3.n2` 反查成功，bounds={x:509,y:-9}（设计坐标），sourceFile 精确到 `assets/Bag/WindowFrame.xml`
- **修改 XML 后重新定位**：改节点 name → locate 即时返回新路径 → 还原恢复
- 截图产物 34KB（非空白），实例文件 dev-examples/stage-d-shots/04-screenshot_component产物.png
- 协议冒烟：子进程 stdio 全流程 toolCount=4、locate 返回 total>0
- 既有 check 27 + check:server 20 项不退化；tsc strict 通过

## 过程修复

- findNodeByKey 初版返回渲染入口根场景而非节点实际所在子场景（sourceFile 语义错误）——findInNodes 改为携带所在场景
- 修改 XML 场景初版改 text 属性（不参与搜索匹配），改为改节点 name 才符合场景语义
- 协议冒烟状态机初版在 tools/list 响应时提前 resolve——改为 tools/call 响应后统一 resolve
- tsc：MCP 接口类型无 index signature，callTool 返回类型放宽为 unknown

## 使用方式

```bash
npm run mcp                                    # 手动启动 stdio server（调试用）
pi mcp add fairygui -- npx tsx src/mcp/main.ts # 或使用仓库内 .pi/mcp.json（项目信任后自动接入）
FGUI_PROJECT_ROOT=<路径> npm run mcp           # 自定义工程根
```

AI 典型调用链：`locate_component("头像框")` → 取 key → `render_component(key)` 得预览 URL → `screenshot_component(key)` 得 PNG 路径 → 读图验证。

## 遗留问题

1. screenshot 依赖系统 Chrome（未装时返回明确错误并提示 CHROME_PATH）——pi-browser-use 环境已满足
2. render/screenshot 产物在系统临时目录（fairygui-mcp/），不自动清理；量大后可加 LRU 清理
3. 工具尚未在真实 pi 会话中通过 `mcp__fairygui__*` 调用验证（协议冒烟已覆盖传输层；接入后即可用）
