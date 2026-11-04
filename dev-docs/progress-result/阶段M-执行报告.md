# 阶段 M 执行报告：ComboBox/ProgressBar/Slider 扩展分支

- 完成时间：2026-11-04
- 状态：验收通过（render 96 项 + tsc + 四套件全绿 + 真实样本浏览器实测）
- 背景：用户要求补齐 ComboBox/ProgressBar/Slider（阶段 L 只做了 GButton）。语义依据 OpenFairy ProgressBar/Slider/ComboBox/Migrate 源码。

## 交付内容

| 项 | 实现 | 涉及文件 |
|---|---|---|
| ProgressBar/Slider 值填充（数据层） | percent = clamp01((value-min)/(max-min))（缺省 50/100/0）；title（name="title"）文本按 titleType 四格式（percent "N%" / valueAndmax "v/m" / value / max）；bar（name="bar"）宽 = round(设计宽*percent)，reverse 反向平移；bar_v 同理纵向 | scene-builder injectProgressProps |
| SetFillAmount 路径 | bar 自带 fillMethod（如 CircleProgress radial360 圆环）时改写 fillAmount = percent*100 而非缩宽（复用 R14 conic mask 链路） | scene-builder injectProgressProps |
| Slider grip | 保持设计位不动（OpenFairy 烘焙不动 grip，运行时拖动才摆位） | - |
| ComboBox 选项静态化（数据层） | 实例 `<ComboBox><item title icon/></ComboBox>` 取首项（selectedIndex 缺省 0）：title 写入 title 文本、icon 下发 icon loader；下拉弹层属运行时不渲染 | scene-builder injectExtensionProps |
| 定义级/实例级合并 | 根扩展元素（定义级，如 `<ProgressBar value="67"/>`）与实例级同名属性合并，实例级覆盖（OpenFairy 语义）；extensionItems 嵌套在扩展元素内的 item 子元素单独收集（此前同级扫描收不到） | component-parser（rootExtension/extensionItems） |
| ProgressBar/Slider 渲染分支 | 语义包装 data-fgui-ext / role="progressbar" / aria-valuemin/max/now | nodes/progress-node.ts（新增） |
| ComboBox 渲染分支 | 复用 button 分支（OpenFairy ComboBox : Button），role="combobox" | nodes/button-node.ts（扩为 Button/ComboBox 通用） |

## 关键实现决策

1. **bar/bar_v 缩放用设计尺寸**：OpenFairy barMaxWidthDelta = 组件宽 - bar 设计宽，fullWidth 即 bar 设计宽——percent=1 时 bar 保持设计宽，与我们"改节点 size"等价且更简单。
2. **SetFillAmount 优先于缩宽**：bar 带 fillMethod 时按 OpenFairy SetFillAmount 分支改写 fillAmount（复用 R14 链路），缩宽分支跳过。
3. **item 收集改嵌套扫描**：`<item>` 实测嵌套在 `<ComboBox>` 内部而非同级，parseExtensionProps 补扩展元素内部扫描。

## 验收结果（真实样本 CC-Default）

| 标准 | 结果 |
|---|---|
| Demo_ProgressBar 7 实例 | 通过（aria-valuenow 50/78/80/75/80/67/30 全对；横 bar 按值缩宽 n1=70px；n9 圆环 30% -> conic 108deg；valueAndmax 标题 "78/100"） |
| Demo_ComboBox 4 实例 | 通过（role=combobox，首项 title "Item 1" 静态化） |
| 夹具断言 8 项 | 通过（ComboBox 语义/首项 title/icon、percent 填充/标题/aria、reverse+valueAndmax、Slider 填充+grip 不动） |
| 既有断言不退化 | 通过（render 88 -> 96 项 + tsc + 四套件） |

## 新增测试资产

- ComboFix/ProgressFix/SliderFix.xml（三个扩展组件夹具）+ P4Fix.xml（实例容器）+ package.xml 登记 5 个资源
- render-check 新增 8 项断言

## 遗留

- ComboBox 下拉弹层 / Slider 拖动 / ProgressBar TweenValue：运行时行为（见运行时能力决策文档 N3/N6）
- Label 扩展：title 注入已走通用链路（renderComponentCore），无独立分支需求（OpenFairy Label 仅 title/titleColor/titleFontSize，injectButtonProps 已覆盖 titleColor/titleFontSize）
