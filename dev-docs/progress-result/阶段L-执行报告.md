# 阶段 L 执行报告：GButton 独立分支（扩展层分发）

- 完成时间：2026-11-04
- 状态：验收通过（render 88 项 + tsc + 四套件全绿 + Demo_Button 浏览器实测）
- 背景：用户偏好独立分支（推翻 P3 分析时"GButton 独立分支划掉"的决策，改为扩展层分支）。挂载点修正：XML displayList 无 button 节点类型，分支挂在 extention="Button" 扩展层。

## 交付内容

| 项 | 实现 | 涉及文件 |
|---|---|---|
| 按钮独立分支（渲染层） | component-node 分发器：childComp.comp.extension === "Button" -> button-node；语义包装（data-fgui-ext / role="button" / aria-pressed / data-fgui-mode），不改 DOM 结构与 component 渲染完全兼容；组件主体抽 renderComponentCore 供分支复用（避免分发死循环） | nodes/button-node.ts（新增）、nodes/component-node.ts |
| checked 选中态（数据层） | `<Button checked="1"/>` -> 子场景 button 控制器（固定名）切到 selectedOver 页（按页名找，语义依据 OpenFairy Button/Migrate StatePage 源码）；构建期切页，gearDisplay/gearColor 求值链自动生效 | scene-builder injectButtonProps |
| titleColor / titleFontSize（数据层） | 定义级属性注入 name="title" 文本（同 title/icon 机制） | scene-builder injectButtonProps |
| 页名保留（解析层） | Controller 补 pageNames（id/名成对保留，此前页名被丢弃；成对过滤修复空 id 错位风险） | component-parser |

## 关键实现决策

1. **挂载点在扩展层而非节点层**：FairyGUI 发布 XML 的 displayList 只有 10 种节点标签，按钮是 component + extention="Button" 的组合；RENDERERS 按 node.type 分发永远打不到"button"，分支只能在 component 渲染时按 childComp 扩展类型二次分发。
2. **语义属性注入在 div 开头**：button-node 把语义属性插到 `<div` 后首位（data-fgui-name 之前），断言正则要按此顺序写（本阶段断言初版方向写反，调试一度误判"分支未生效"——调试切片从 data-fgui-name 开始也放大了误判）。
3. **checked 属于数据层**：切页必须在构建期副本上做（gear 求值链在构建期/渲染期一致性），渲染层只做语义包装。

## 验收结果

| 标准 | 结果 |
|---|---|
| 按钮分支语义标记 | 通过（Demo_Button 21 按钮全部 data-fgui-ext="Button" + role="button"） |
| checked 选中态 | 通过（4 个 checked 按钮：n12/n18/n23/n38；n23（Tab1）selectedOver 皮肤 n3/n4 可见、up/down 皮肤隐藏） |
| titleFontSize 注入 | 通过（夹具 font-size:20px） |
| 未选中按钮 up 态 | 通过（bgUp 可见 bgSel 隐藏） |
| 既有断言不退化 | 通过（render 88 项 + tsc + 四套件） |

## 新增测试资产

- ButtonIcon.xml 升级为真按钮夹具（extention="Button" + button 控制器四页 + gearDisplay 三态背景）
- P3Fix 扩 btnChecked 实例（checked + titleFontSize）
- render-check 新增 4 项断言（85 -> 88 项）

## 遗留

- GLabel/ComboBox/ProgressBar/Slider 扩展：Label 已走通用链路（title 注入），ComboBox/ProgressBar/Slider 待触发（同扩展层分发模式，照 button-node 范式即可）
- Button downEffect（按下暗化/缩放）：运行时效果，静态无意义（见决策文档）
