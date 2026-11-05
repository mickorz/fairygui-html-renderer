# UI 编辑器 P0 —— T17 实机验收记录

- 验收人：（填写）
- 日期：（填写）
- 验收对象：demo-popup-pkg（P0 转换产物，静态检查已通过）
- 工程路径：`editor-dev/CC-Default/FairyGUI-cocoscreator-demo.fairy`（demo-popup-pkg 已在 `assets/` 内）
- 编辑器：FairyGUI Editor 6.1.4（本机 `D:\FairyGUI-Editor_6.1.4\FairyGUI-Editor\FairyGUI-Editor.exe`）

## 操作入口

打开 FairyGUI-Editor.exe -> 打开工程 `CC-Default/FairyGUI-cocoscreator-demo.fairy` -> 左侧资源树应出现 `demo-popup-pkg`（Root.xml / div_1.xml）。

## 六项验收清单

| # | 验收项 | 结果（通过/失败） | 备注（失败时附截图路径） |
|---|--------|------------------|--------------------------|
| 1 | Package 能够正常导入（资源树出现 demo-popup-pkg，无报错） | | |
| 2 | Root 能够正常打开，画布尺寸 750×1334 | | |
| 3 | 弹窗组件层级正确（Root：遮罩 + div_1 引用；div_1：背景 + 5 文本 + 2 按钮底） | | |
| 4 | 标题和正文文字显示正常（「确认出售」28 号 #ffd666、正文 22 号 #e8dcc8） | | |
| 5 | 修改弹窗位置及文本后能够保存 | | |
| 6 | 关闭编辑器后重新打开，修改仍然保留 | | |

**第 5、6 项是重点**：验证转换产物能否真正进入 FairyGUI 原生编辑工作流（可编辑、可保存），而不只是能显示。

## 结果处理

- 六项全过：本文件标注「全部通过」+ 日期，P0 正式关闭，进入 P1 规划（真实 AI 样本回归库 → Semantic Layer 方案）。
- 任一失败：记录现象 + 错误截图 / 组件树截图 + 修改后的导出 XML，交回开发侧定位 Converter 问题。

## 参考

- 静态检查结论：`dev-docs/meeting/2026-11-05-T17静态检查结论.md`
- 收口评审：`dev-docs/meeting/2026-11-05-UI编辑器P0-收口评审.md`
