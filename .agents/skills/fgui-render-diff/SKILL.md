---
name: fgui-render-diff
version: 0.1.0
display_name: FairyGUI 渲染对比
display_name_en: FairyGUI Render Diff
description: >
  对同一 FairyGUI 组件取两张截图做视觉一致性对比并输出分析报告：web 渲染器截图
  （/api/screenshot，尺寸精确对齐组件 size）与 FairyGUI 编辑器截图（fgui-agent-bridge MCP 的
  screenshot 工具，编辑器窗口截图），用 ui_diff_check 比对差异、必要时逐图断言降级，
  产出 markdown 差异报告。执行前自动做前置检查与修复（编辑器插件安装 / fgui-bridge MCP
  配置 / 桥在线 / 渲染服务在线）。Use when verifying visual consistency between the HTML
  renderer and the FairyGUI editor, comparing renderer screenshots against editor screenshots,
  or producing a render-diff report for a FairyGUI component.
description_zh: >-
  对同一 FairyGUI 组件取 web 渲染器截图与 FairyGUI 编辑器截图做视觉一致性对比并输出分析报告。
  web 侧走 /api/screenshot（尺寸精确对齐组件 size，输出 .render.png）；编辑器侧走 fgui-agent-bridge
  MCP 的 screenshot 工具（窗口截图，输出 .fgui.png）；对比用 zai ui_diff_check，构图差异过大时降级
  逐图断言。自动检查并修复四项前置：工程安装 agent-bridge 插件、项目接入 fgui-bridge MCP、
  编辑器桥在线、渲染服务在线。适用于渲染一致性验证、渲染差异排查、组件渲染对比报告。
description_en: >-
  Take two screenshots of the same FairyGUI component and produce a visual-consistency diff
  report: a web renderer screenshot (/api/screenshot, size exactly matching the component) and
  a FairyGUI editor screenshot (fgui-agent-bridge MCP screenshot tool, window capture). Compare
  with ui_diff_check, falling back to per-image assertions when composition differs too much.
  Automatically checks and repairs four preconditions: agent-bridge plugin installed in the
  project, fgui-bridge MCP configured, editor bridge online, renderer service online.
  Use when verifying renderer-vs-editor visual consistency or producing render-diff reports.
---

# FairyGUI 渲染对比（fgui-render-diff）

对同一组件取「web 渲染截图」与「FairyGUI 编辑器截图」，对比差异，输出 markdown 分析报告。
本仓库（fairygui-html-renderer）的渲染一致性验证与差异排查都用这个流程。

## 边界

- 只做**同一组件的双截图对比与报告**；不修改任何渲染器/编辑器代码，不修复渲染差异本身
  （差异回溯建议写进报告，修复是另一个任务）
- 只操作本仓库 projects/ 下已接入的工程；编辑器截图依赖编辑器进程活着（免费版无 headless）
- 对比结论以 zai 图像工具的逐项断言为准，不凭肉眼描述下结论

## 前置事实（两张截图的形态差异，先知道再对比）

| 侧 | 通道 | 截图形态 | 尺寸 |
|---|---|---|---|
| web 渲染 | `GET /api/screenshot?component=<assets相对路径>&project=<工程>` | 组件区域纯净渲染（bare 模式，0,0 铺满，无滚动条/高亮） | = 组件 size（PNG IHDR 有硬断言） |
| 编辑器 | 实测链路（流程见 compare-flow 第 3 步）：open_doc + SendInput Ctrl+滚轮缩 80% + PrintWindow + PIL 精裁（脚本在本 skill scripts/） | 画布区域（编辑器画布底色+编辑态内容；组件内容溢出画布部分两侧行为一致均按画布裁剪） | = 组件 size（80% 缩放物理 1:1，见经验文档） |

注意：桥的 `screenshot` 命令（ScreenCapture）在裁剪版编辑器不可用，**不要走那条通道**；`canvas_rect` 命令的 LocalToGlobal 坐标链不含渲染缩放，只做粗定位参考。

两图构图天然不同（编辑器截图含编辑器 UI 框架）——对比策略必须走「内容确认 + ui_diff_check + 失败降级」，见流程第 5 步。产物按配对约定存 `dev-examples/screenshots/`：`<组件名>.render.png` 与 `<组件名>.fgui.png`，报告 `<组件名>-diff-report.md` 同目录。

## 输入

| 输入 | 必填 | 说明 |
|---|---|---|
| 组件相对路径 | 是 | assets/ 下相对路径（如 `boxkawuxing_mah_common/component/mahHandSelf.xml`） |
| 工程 | 通常默认 | projects/ 下工程名（缺省用 `/api/projects` 的默认工程） |

## 输出（完成标准）

1. 两张配对截图落盘（`.render.png` / `.fgui.png`）
2. `<组件名>-diff-report.md`：基本信息 / 前置状态 / 两图 / 对比结论（一致|差异|无法直接对比）/ 差异明细（逐项）/ 回溯建议（Inspector 与 XML 属性核对点）
3. 差异结论有逐项断言依据（zai 工具回答），不是泛泛描述

## 执行流程

进入 [references/compare-flow.md](references/compare-flow.md) 按步骤执行：前置检查与修复（四项）-> web 截图 -> 编辑器截图（内容确认）-> 对比（首选 ui_diff_check，降级逐图断言）-> 报告产出。

## 策略摘要

- 前置缺失先修复再重查，单轮修复仍失败则如实报告终止（不静默跳过前置）
- 编辑器截图若不是目标组件视图（截到别的文档/面板）：提示用户在编辑器打开目标组件，重截一次；仍不匹配则在报告中如实标注
- 尺寸/构图差异导致 ui_diff_check 不可用时降级为 zai analyze_image 两图分别断言 + 逐项对照，报告注明「无法直接像素对比」
- 报告里的每个差异结论都要能回溯到组件 XML 属性（Inspector/`/api/scene`）
