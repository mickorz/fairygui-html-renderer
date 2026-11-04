# 九宫格 border-image 漏 fill 关键字：中心镂空露出灰底

## 问题现象

- Button.xml n1 九宫格背景图修复引号截断后仍观感不对：按钮只有四边有贴图，中心（文字所在区域）是灰色的背景底，看起来像"文本有灰色背景"，与 FairyGUI 原版中心有贴图填充不一致。

## 排查过程

1. DOM 检查 title 文本节点：`backgroundColor: rgba(0,0,0,0)` 完全透明——文本本身没有背景，排除文本渲染问题。
2. 怀疑点转向 n1 图片：computed `borderImageSlice: 7 11 4 8` 已生效、图片 URL 200、box 85×25 正确。
3. MCP 图像分析截图（zai_mcp_server_analyze_image）确认：按钮只画了四边和四角，**中心镂空**露出深灰 stage 底色（#5a5a5a）。
4. 对照 CSS 规范：`border-image-slice` **默认丢弃中心切片**，除非加 `fill` 关键字；FairyGUI 的 scale9grid 绘制全部 9 块（中心拉伸）——两边语义不一致。

## 根因

CSS 与 FairyGUI 的九宫格语义差：CSS border-image 默认只画 4 边 + 4 角（8 块），中心不画；FairyGUI scale9grid 画全部 9 块。用 border-image 复刻 FairyGUI 九宫格时漏了 `fill` 关键字，中心镂空透出 stage 灰底。灰底恰好出现在文字区域（按钮中心），被误读为"文本有背景色"。

## 解决方案

`border-image-slice:${y} ${right} ${bottom} ${x}` 后追加 ` fill` 关键字（utils.ts nineSliceStyle）。回归断言同步更新为 `border-image-slice:78 86 66 88 fill` 形态。MCP 图像分析复验：中心为浅色贴图填充，四边角无缝衔接。

## 预防/注意事项

- 用 CSS 复刻其他引擎/框架的图形语义时，逐条对照默认值差异（本例：CSS 默认不画中心 vs FairyGUI 默认画中心），"默认行为"最容易被忽略。
- "某区域有意外底色"类问题，先查该区域 computed backgroundColor 是否透明（排除节点自身背景），再想镂空/层叠露出底层（z-index、透明区域、切片缺失）。
- 文字区域的"灰背景"不一定是文本节点的问题——按钮贴图中心镂空时，灰底恰好出现在文字后面。定位视觉问题要按 z 序从上层往下排查。
