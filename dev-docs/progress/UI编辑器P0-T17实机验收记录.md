# UI 编辑器 P0 —— T17 实机验收记录

- 验收人：用户（本机 FairyGUI Editor 6.1.4）
- 日期：2026-11-05
- 验收对象：demo-popup-pkg（P0 转换产物，静态检查已通过）
- 工程路径：`editor-dev/CC-Default/FairyGUI-cocoscreator-demo.fairy`（demo-popup-pkg 已在 `assets/` 内）
- 编辑器：FairyGUI Editor 6.1.4（本机 `D:\FairyGUI-Editor_6.1.4\FairyGUI-Editor\FairyGUI-Editor.exe`）

## 操作入口

打开 FairyGUI-Editor.exe -> 打开工程 `CC-Default/FairyGUI-cocoscreator-demo.fairy` -> 左侧资源树应出现 `demo-popup-pkg`（Root.xml / div_1.xml）。

## 六项验收清单

| # | 验收项 | 结果 | 备注 |
|---|--------|------|------|
| 1 | Package 能够正常导入（资源树出现 demo-popup-pkg，无报错） | 通过 | 导入前后发现包目录自嵌套（见下方「过程中发现的问题」），清理后导入正常 |
| 2 | Root 能够正常打开，画布尺寸 750×1334 | 通过 | |
| 3 | 弹窗组件层级正确（Root：遮罩 + div_1 引用；div_1：背景 + 5 文本 + 2 按钮底） | 通过 | |
| 4 | 标题和正文文字显示正常（「确认出售」28 号 #ffd666、正文 22 号 #e8dcc8） | 通过 | |
| 5 | 修改弹窗位置及文本后能够保存 | 通过 | |
| 6 | 关闭编辑器后重新打开，修改仍然保留 | 通过 | |

**验收结论：六项全部通过（2026-11-05）。P0 的 T17 实机验收完成，转换产物可进入 FairyGUI 原生编辑工作流（导入 / 编辑 / 保存 / 重开保留）。**

### 过程中发现的问题（非转换问题，已修复并沉淀）

复制包目录到工程时 `Copy-Item -Destination <不存在路径> -Recurse` 把源目录塞进了目标内部，FairyGUI
Editor 打开工程后继续递归复制，产生 `demo-popup-pkg/demo-popup-pkg/...` 多层嵌套（546 目录 / 1636 文件）。
已用 `robocopy /MIR` + 干净 zip 恢复，两处工程目录回到 3 文件。经验文档：
`dev-docs/experience/powershell-copy-item-nested-package-dir.md`。
**包本身无问题，嵌套是复制/导入方式造成的。**

**第 5、6 项是重点**：验证转换产物能否真正进入 FairyGUI 原生编辑工作流（可编辑、可保存），而不只是能显示。

## 结果处理

- 六项全过：本文件标注「全部通过」+ 日期，P0 正式关闭，进入 P1 规划（真实 AI 样本回归库 → Semantic Layer 方案）。
- 任一失败：记录现象 + 错误截图 / 组件树截图 + 修改后的导出 XML，交回开发侧定位 Converter 问题。

## 已知输出形态问题（P1 待办，接受当前形态）

**按钮不是 GButton，而是 graph（底）+ text（字）两个独立对象。**

- 根因：HTML 原稿无按钮语义（两个普通 div），Converter 只做结构映射（`image/text/graph/container/list`，唯一语义推断是 ≥3 同构兄弟折叠 GList），无 button 分支；
- 影响：显示正确、可编辑，但丢失 GButton 语义（up/over/down 状态切换、点击、title 绑定、Controller 驱动）；
- 结论：**属 P1 Semantic Layer 范围，非 P0 转换错误，接受当前形态进入 T17**（用户决定：先完成 T17，再做语义闭环）。

### P1 第一个可交付：GButton 最小语义闭环

```
HTML 节点标注 data-fgui-type="GButton" / data-fgui-title="确认"
  -> Adapter 保留并规范化 data-fgui-* 属性
  -> 编辑器属性面板显示 FairyGUI 属性（title/icon/状态）
  -> Converter 加 button 分支：输出 <button>（title + 底图引用 + 状态），不再产出 graph+text 两个裸对象
```

三处改动（Adapter / Converter button 分支 / 属性面板语义字段），比完整 Semantic Layer 小，直接解决「导出 UI 不可用」硬伤。**执行时机：T17 验收完成后。**

## 参考

- 静态检查结论：`dev-docs/meeting/2026-11-05-T17静态检查结论.md`
- 收口评审：`dev-docs/meeting/2026-11-05-UI编辑器P0-收口评审.md`
