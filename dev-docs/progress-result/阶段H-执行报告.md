# 阶段 H 执行报告：渲染器能力补齐第一批（P0：R01-R04）

- 完成时间：2026-11-04
- 状态：验收通过（render 断言 44/44 + server/mcp/convert 套件全绿 + 浏览器实测确认；无回归）
- 需求依据：dev-docs/planning/2026-11-04-渲染器能力补齐需求文档.md（P0 批次）
- 调研依据：dev-docs/research/2026-11-04 系列（8 篇三方对比调研）

## 交付内容（对照需求 P0 批次）

| 需求 | 实现 | 涉及文件 |
|---|---|---|
| R01 overflow 视口裁剪 | parser 解析组件级 `overflow` 属性（visible/hidden/scroll）；component 子场景 overflow=hidden/scroll 时输出 `overflow:hidden`（scroll 按首屏观感裁剪）；list 与根 stage 原有裁剪保持 | component-parser.ts、component-node.ts |
| R02 graph 归一与错形消除 | 旧编辑器拼写 `eclipse` 归一为椭圆（对齐 OpenFairy FairyXml 行为）；未支持形状类型（polygon 等）与未消费属性（corner/points/sides/startAngle/distances/skew）显式上报 unsupported，不再静默错形 | graph-node.ts |
| R03 text 排版 | vAlign（top/middle/bottom）垂直对齐 flex 列容器实现；行距按 FairyGUI 公式 `round(fontSize*1.25)+leading-1` 换算（缺省 leading=3）；letterSpacing 透传 | text-node.ts |
| R04 loader 包内 image url | scene-builder 构建期经 parseUiUrl 解析 `ui://<pkgId><resId>` 存入 `loaderRes`；渲染为容器 div（flex 对齐 align/vAlign，缺省 left/top）+ img；fill 六值语义映射：none 原尺寸 / scale 等比装入（max-width+max-height）/ scaleFree 拉伸 / scaleNoBorder 等比裁剪（object-fit:cover）/ scaleMatchHeight、scaleMatchWidth 单轴匹配；染色/灰化复用 feColorMatrix 链路；无内容时维持灰底占位与如实上报（url 指向组件或 jta 动画时上报原因） | scene-builder.ts、loader-node.ts、component-parser.ts（loaderRes 字段） |

## 关键实现决策

1. **loader url 解析放在构建期而非渲染期**：复用 expandList 的既有范式（buildGlobalIndex + parseUiUrl），渲染器只消费 `loaderRes`；跨包引用天然支持，且与"构建与缓存分离"架构一致。
2. **fill 语义对齐源码核实**：FillType 枚举与缩放规则取自 GLoader.cs（scale 取较小比例=装入、scaleNoBorder 取较大比例=裁剪），映射 CSS max-width/max-height/object-fit，不靠猜测。
3. **graph 上报而非实现**：P0 只消除静默错形（所有未消费属性/形状类型进 unsupported 清单），corner 圆角与描边留给 P1（R10）。
4. **词表以真实 XML 为准**：vAlign（非 valign）、letterSpacing、fill/align/vAlign 均先 grep CC-Default 实证拼写再实现。

## 验收结果（对照需求验收标准）

| 标准 | 结果 |
|---|---|
| overflow=hidden/scroll 组件超出视口的子节点被裁剪，visible 仍全显 | 通过（fixtures Clipped.xml 断言 + visible 反例断言） |
| 旧拼写 eclipse 椭圆正常渲染；corner/points 等出现在未支持清单 | 通过（RenderFix.xml 断言） |
| vAlign=middle 垂直居中；leading 行距一致 | 通过（行距公式断言 fontSize12 leading0 -> 14px） |
| 带包内图片 url 的 loader 渲染出图片且填充策略正确；跨包 url 可解析 | 通过（Demo_Loader 实测：n1/n2/n3 图片加载成功，fill=scale 装入 90x90、align center 偏移 22,21 正确） |
| 既有断言不退化 | 通过（render 44 项含全部历史断言；server/mcp/convert 套件全绿） |

浏览器实测补充（dev-examples/p0-smoke，沙盒不入库）：Demo_Loader 的 n4/n5 url 指向 jta 动画资源（hixt1v/t9fj5f 为 name=nlge1k.jta / pet.jta），按 R04 边界如实上报"指向非图片资源（组件或动画）或无法解析"，属 P1 R12 与不做清单范围。

## 新增测试资产

- tests/fixtures/workspace/assets/cycle/RenderFix.xml（eclipse 归一/corner 上报/vAlign+leading+letterSpacing/loader url+fill/overflow 组件节点五合一夹具）
- tests/fixtures/workspace/assets/cycle/Clipped.xml（overflow=hidden 裁剪夹具）
- tests/fixtures/workspace/assets/cycle/pic.png + package.xml 补登记（image i_a / component c_cl / c_rf）
- tests/render-check.ts 新增 8 项断言（render 套件累计 44 项）

## 遗留问题

- P1 批次待启动：R10（graph corner 圆角与 lineSize/lineColor 描边）、R11（list item title/icon 下发）、R12（loader url 指向组件展开）、R13（richtext/UBB/模板）、R14（image fillMethod）、R15（初始页规则对齐）
- text 描边口径补偿（strokeSize 放大 2 倍）未在本批做（属 R23 P2）
