# 阶段 N 执行报告：N1 可滚容器 + N5 树骨架

- 完成时间：2026-11-04
- 状态：验收通过（render 101 项 + tsc + 四套件全绿 + 真实样本浏览器实测）
- 决策来源：用户确认决策文档 N1（可滚容器）与 N5（树形静态）转为做；边界分析文档 research/2026-11-04-原版UI类覆盖与不做边界分析.md

## 交付内容

| 项 | 实现 | 涉及文件 |
|---|---|---|
| N1 可滚容器（组件级） | overflow=scroll -> CSS overflow:auto（滚动条外观与 FairyGUI 不一致，接受）；overflow=hidden 仍裁剪不回归 | nodes/component-node.ts |
| N1 可滚容器（根组件） | 根组件 overflow=scroll 时 stage 可滚（此前 stage 硬编码 overflow:hidden，根滚动组件被静默裁剪——顺带修复的老问题） | html-renderer.ts（stage 双处：CSS 类 + 内联） |
| N5 树骨架（GTree） | extention="Tree" 分支：tree-node.ts 语义包装（data-fgui-ext="Tree" / role="tree"）+ 未支持如实上报"树数据无 XML 通道"（TreeNode 纯运行时 API 构建，源码核实 UIPackage/GTree）；骨架内 list 按既有逻辑展开 | nodes/tree-node.ts（新增）、component-node.ts 分发 |

## 关键结论（N5 形态修正）

原决策文档 N5 预想"树形列表展开（缩进 + 箭头 + 收起态）"；源码核实后修正：**树数据（TreeNode 结构）不在发布 XML 里**（GTree.treeView 运行时构建，UIPackage 仅把 component extension 字节映射为 ObjectType.Tree）——缩进/层级/展开态没有输入来源，可做的只有骨架渲染 + 语义包装。树形 UI 真实工程出现且编辑器导出含树数据时再扩展。

## 验收结果

| 标准 | 结果 |
|---|---|
| overflow=scroll 可滚（夹具） | 通过（scroller overflow:auto） |
| overflow=hidden 不回归 | 通过（clipped 仍 hidden） |
| 根组件可滚（真实样本 Demo_Component 根 overflow=scroll） | 通过（stage overflow:auto，内容 823 > 视口 570 可滚） |
| Tree 语义标记 + 骨架展开 + 未支持上报 | 通过（夹具三项断言） |
| 既有断言不退化 | 通过（render 96 -> 101 项 + 四套件） |

## 新增测试资产

- ScrollFix.xml（根级 overflow=scroll 夹具）、TreeFix.xml（extention="Tree" + 内 list 骨架）+ package.xml 登记 + P4Fix 两实例
- render-check 新增 5 项断言

## 决策表更新

N1、N5 已勾选为已做；其余维持（N4/N8/N13/N14 永久不做，N2/N3/N6/N7/N9/N10/N11 待触发）。
