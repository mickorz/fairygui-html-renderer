# 对比执行流程

前置检查与修复 -> web 截图 -> 编辑器截图（内容确认）-> 对比 -> 报告。逐步执行，任何一步失败按该步的错误策略处理，不静默跳过。

## 第 1 步 前置检查与修复

四项前置逐项检查，缺了先修复再复查一次；单轮修复仍失败 -> 如实报告缺失项并终止。

### 前置 1 目标工程安装了 agent-bridge 插件

检查（工程名按输入或 `/api/projects` 默认工程）：

```bash
ls projects/<工程>/plugins/agent-bridge/main.js projects/<工程>/plugins/agent-bridge/package.json
ls projects/<工程>/*.fairy   # 完整编辑器工程（插件随工程加载，无 .fairy 则编辑器开不了）
```

修复（等价 install.bat 的动作；cmd 引号问题直接手动复制）：

```bash
mkdir -p projects/<工程>/plugins/agent-bridge
cp thirdparties/fairygui-agent-bridge/plugin/main.js thirdparties/fairygui-agent-bridge/plugin/package.json projects/<工程>/plugins/agent-bridge/
```

注意：工程缺 `.fairy`/`settings/` 等编辑器工程文件时（只有 assets），插件装了也无处加载——如实报告「不是完整编辑器工程」，不要自行补工程文件（工程文件在原始工程目录，需用户确认复制来源）。

### 前置 2 项目接入了 fgui-bridge MCP

检查：

```bash
grep -A2 '"fgui-bridge"' .pi/mcp.json
```

修复：向 `.pi/mcp.json` 的 mcpServers 追加（与已有 `fairygui` 并列）：

```json
"fgui-bridge": {
  "command": "node",
  "args": ["thirdparties/fairygui-agent-bridge/mcp/server.mjs"],
  "description": "FairyGUI 编辑器操作桥"
}
```

注意：MCP 配置新增要**重启 pi 会话**才生效。当前会话看不到新工具时，如实告知用户重启会话后重跑本 skill，不要假装可用。

### 前置 3 编辑器桥在线

检查（任一）：

```bash
curl -s -m 3 -X POST http://localhost:7531/ -d '{"cmd":"ping"}'
```

或 MCP `discover_projects` 工具。

修复（桥不通 = 编辑器没开该工程）：先找编辑器路径（默认探测列表 C:/D: Program Files 常不中，按本机实际位置探测）：

```bash
ls /d/FairyGUI-Editor_*/FairyGUI-Editor/FairyGUI-Editor.exe 2>/dev/null   # 本机已知安装形态
```

再拉起（ensure 会开编辑器窗口、加载工程、轮询到 ping 就绪）：

```bash
FGUI_EDITOR_EXE="<编辑器exe的Windows路径>" node thirdparties/fairygui-agent-bridge/cli/fgui.mjs ensure '{"project":"E:/DesignProjects/fairygui-html-renderer/projects/<工程>"}'
```

### 前置 4 渲染服务在线

检查：

```bash
curl -s -m 3 http://localhost:7788/api/projects
```

修复（后台拉起，tsx watch；改了渲染代码无需重启，改了数据目录要杀整树重启）：

```bash
npm run serve   # 后台运行
```

## 第 2 步 web 渲染截图

```bash
curl -s "http://localhost:7788/api/screenshot?component=<组件相对路径>&project=<工程>"
```

响应含 `size`（应等于组件 size）与 `file`（`dev-examples/screenshots/<组件名>.render.png`）。404 = 组件路径写错（相对路径要含 `component`/`components` 层级）；size 与组件不符如实报告，不继续。

## 第 3 步 编辑器截图（内容确认）

编辑器截图反映**编辑器当前打开的文档视图**，不是指定组件。两步走：

1. MCP `screenshot` 工具，`{"path": "E:/DesignProjects/fairygui-html-renderer/dev-examples/screenshots/<组件名>.fgui.png"}`（编辑器进程写文件，给 Windows 风格绝对路径）
2. 立即用 `zai_mcp_server_analyze_image` 确认内容（提问具体到断言）：「这是 FairyGUI 编辑器窗口吗？当前视图打开的组件名是什么？舞台区可见哪些内容？」
   - 确认是目标组件 -> 继续
   - 不是目标组件 -> 提示用户在编辑器里打开目标组件文档，重截一次；仍不匹配 -> 报告如实标注「编辑器截图非目标组件视图」，继续时对比结论降级为参考性

## 第 4 步 对比

首选 `zai_mcp_server_ui_diff_check`（expected=`.fgui.png` 编辑器版，actual=`.render.png` 渲染版）。prompt 聚焦该组件的关键视觉断言（九宫格拉伸、文字与字号、图标位置、颜色、对齐），并注明两图构图差异（编辑器截图含编辑器框架、渲染截图是纯组件区域），要求逐项给出一致/差异。

降级条件：ui_diff_check 因尺寸/构图差异无法有效对比（返回内容明显失真或只报整体不同）。降级动作：`zai_mcp_server_analyze_image` 分别对两图做同一组断言提问（同一断言清单逐项问两图），逐项对照得出差异明细，报告注明「无法直接像素对比，采用逐图断言对照」。

## 第 5 步 报告产出

写 `dev-examples/screenshots/<组件名>-diff-report.md`（沙盒目录，gitignore 不入库）：

```markdown
# <组件名> 渲染对比报告

- 日期 / 工程 / 组件路径
- 前置状态：四项前置的实际状态（插件|MCP|桥|服务，各项 在线/修复后在线/失败）
- 两图：render.png（尺寸 = 组件 size NxM）/ fgui.png（编辑器窗口截图，编辑器视图状态）

## 对比结论
[一致 | 存在差异 | 无法直接对比（逐图断言参考结论）]

## 差异明细
| # | 断言项 | 编辑器版 | 渲染版 | 结论 |
逐项列出（无差异时写「断言清单全部一致」并列断言项）

## 回溯建议
差异项对应的排查路径：Inspector 查节点属性 -> 组件 XML 属性核对 -> 渲染器对应节点分支
```

报告写完即完成。截图文件保留供人工复核，不清理。
