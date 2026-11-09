# 对比执行流程

前置检查与修复 -> web 截图 -> 编辑器截图（实测链路）-> 对比 -> 报告。逐步执行，任何一步失败按该步的错误策略处理，不静默跳过。

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

注意：MCP 配置新增要**重启 pi 会话**才生效。当前会话看不到新工具时，桥的 HTTP（localhost:7531）与 MCP 工具等价，curl 直调即可，不要假装 MCP 可用。

### 前置 3 编辑器桥在线

检查（**ping 超时失败不代表编辑器没开**，见下方失焦停摆处理）：

```bash
curl -s -m 3 -X POST http://localhost:7531/ -d '{"cmd":"ping"}'
```

ping 失败时先查编辑器进程再决定动作（编辑器失焦时帧驱动停摆，桥超时但窗口还开着；此时 ensure 会重复拉起第二个编辑器实例，且第二实例抢不到 7531 端口，两边都不可用）：

```bash
powershell -NoProfile -Command 'Get-Process FairyGUI-Editor -ErrorAction SilentlyContinue | Select-Object Id,StartTime'
```

- **进程在 + 桥无响应 = 编辑器失焦停摆**：请用户点一下编辑器窗口（激活后帧恢复），ping 放宽 10 秒重试 2 次；通了继续；**禁止此时 ensure**
- **进程不在 = 编辑器真没开**：ensure 拉起。先找编辑器路径（默认探测列表 C:/D: Program Files 常不中，按本机实际位置探测 `ls /d/FairyGUI-Editor_*/FairyGUI-Editor/FairyGUI-Editor.exe`），再：

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

响应含 `size`（应等于组件 size）与 `file`（`dev-examples/screenshots/<组件名>.render.png`）。404 = 组件路径写错（相对路径通常含 `component`/`components` 层，包根组件没有该层）；size 与组件不符如实报告，不继续。

## 第 3 步 编辑器截图（实测链路，五小步）

编辑器截图是**画布区域**（与 web 截图同尺寸对比），链路：open_doc -> 缩放 80% -> PrintWindow -> PIL 精裁 -> zai 验证。脚本在本 skill 的 `scripts/` 下（ps1 是 UTF-8 BOM 编码，勿重写丢失 BOM）。

**关键事实**（踩坑实测，见 experience/2026-11-09-编辑器画布截图链路.md）：
- 桥的 `screenshot` 命令用的编辑器 ScreenCapture API 在裁剪版编辑器不可用 -> PrintWindow PW_RENDERFULLCONTENT 降级（无需前台、遮挡也能截 D3D 内容）
- `viewScale` 属性直设**不触发渲染**（工具栏值变了但画布渲染不缩）-> 必须 SendInput 真 Ctrl+滚轮（正规缩放通道；AttachThreadInput 破前台锁）
- 编辑器 UI 缩放 1.25（本机 DPI）-> 画布缩放 80% 时物理恰好=组件源尺寸 1:1（SendInput 缩 1 档）
- 桥的 `canvas_rect` 命令返回的 LocalToGlobal 坐标链**不含渲染缩放**（rect 不随缩放变）-> 只做粗定位参考，精定位靠 PIL 颜色突变扫描

### 3.1 打开目标组件文档

```bash
curl -s -m 20 -X POST http://localhost:7531/ -d '{"cmd":"open_doc","args":{"pkg":"<包名>","name":"<组件名>"}}'
```

### 3.2 缩放画布到 80%（物理 1:1）

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/fgui-render-diff/scripts/zoom-input.ps1 -Steps -1
```

### 3.3 截全窗口

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/fgui-render-diff/scripts/capture-editor.ps1 -OutPath "E:/DesignProjects/fairygui-html-renderer/dev-examples/screenshots/<组件名>.win.png"
```

输出 `saved WxH offset=X,Y client=WxH`（offset 是客户区原点在全窗口位图中的偏移）。

### 3.4 PIL 精裁画布

```bash
cd dev-examples/screenshots && python ../../.agents/skills/fgui-render-diff/scripts/crop-canvas.py <组件名>.win.png <组件名>.fgui.png <组件宽> <组件高> <粗略x> <粗略y>
```

粗略 x/y 从 zai 分析 win.png 估（±50 内即可，脚本从画布外向内颜色突变扫描+多线中位精定位，抗内容干扰）。**尺寸校验偏差大时如实报告**（缩放状态可能不对），不要硬裁。

### 3.5 zai 验证裁剪质量

`zai_mcp_server_analyze_image` 传 .fgui.png，逐项断言：边缘干净（无编辑器 UI 残留）/ 内容完整 / 底色均匀。注意组件内容本身可能溢出画布（编辑器可见、裁剪图按画布边界裁）——这与 web 渲染裁剪行为一致，不是裁剪错误。

## 第 4 步 对比

首选 `zai_mcp_server_ui_diff_check`（expected=`.fgui.png` 编辑器版，actual=`.render.png` 渲染版）。prompt 聚焦该组件的关键视觉断言（布局/贴图/字体/颜色/对齐），并注明底色差异不计（编辑器画布底色 vs 渲染 stage 底色），要求逐项给出一致/差异。

降级条件：ui_diff_check 因尺寸/构图差异无法有效对比（返回内容明显失真或只报整体不同）。降级动作：`zai_mcp_server_analyze_image` 分别对两图做同一组断言提问（同一断言清单逐项问两图），逐项对照得出差异明细，报告注明「无法直接像素对比，采用逐图断言对照」。

## 第 5 步 报告产出

写 `dev-examples/screenshots/<组件名>-diff-report.md`（沙盒目录，gitignore 不入库）：

```markdown
# <组件名> 渲染对比报告

- 日期 / 工程 / 组件路径
- 前置状态：四项前置的实际状态（插件|MCP|桥|服务，各项 在线/修复后在线/失败）
- 两图：render.png（尺寸 = 组件 size NxM）/ fgui.png（编辑器画布截图，链路备注）

## 对比结论
[一致 | 存在差异 | 差异来源于渲染器已知边界（注明边界项）]

## 差异明细
| # | 断言项 | 编辑器版 | 渲染版 | 结论 |
逐项列出（无差异时写「断言清单全部一致」并列断言项）

## 回溯建议
差异项对应的排查路径：/api/scene 查节点 unsupported -> Inspector 查节点属性 -> 组件 XML 属性核对 -> 渲染器对应节点分支；
已知边界项（loader3D/GLoader3D 等不做清单）注明决策文档出处
```

报告写完即完成。截图文件保留供人工复核，不清理。
