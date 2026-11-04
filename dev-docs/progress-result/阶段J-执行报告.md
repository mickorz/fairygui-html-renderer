# 阶段 J 执行报告：渲染器能力补齐第三批（P2：R20-R25）

- 完成时间：2026-11-04
- 状态：验收通过（render 断言 68/68 + tsc + server/mcp/convert 套件全绿 + 浏览器实测确认；无回归）
- 需求依据：dev-docs/planning/2026-11-04-渲染器能力补齐需求文档.md（P2 批次）
- 调研依据：dev-docs/research/2026-11-04 系列（8 篇三方对比调研）

## 交付内容（对照需求 P2 批次）

| 需求 | 实现 | 涉及文件 |
|---|---|---|
| R20 实例级页覆盖 | component 节点 `controller` 属性（name,pageId 逗号对，语义经 OpenFairy ConfigureInstanceControllers 源码核实）覆写子场景控制器初始页，gear 求值链自动生效；buildScene 返回 controllers 逐项副本（实例覆写不污染解析缓存）；loader 组件分支同样支持；Button 的 relatedController（单名无逗号对）天然不误触发 | scene-builder.ts |
| R21 group 透明容器 | group 节点渲染为空（无视觉无占位无上报）；成员靠 `group="id"` 属性引用，各自独立渲染；advanced 组成员坐标已烘焙进 XML，无需重排 | component-parser.ts（KNOWN_TYPES）、html-renderer.ts |
| R22 image 精度三件套 | 染色 8 位色 alpha 分量与节点 alpha 复合输出 opacity（后置覆盖 baseStyle 同名项）；nineSliceStyle 仅 scale=9grid/tile 启用（保留 scale9grid 未启用的按整图渲染，对齐 FairyGUI）；aspect="true" + 显式尺寸 -> object-fit:contain | utils.ts、image-node.ts |
| R23 text 排版细节包 | strokeSize 缺省 1（经 FairyXml 源码核实）+ CSS 居中口径 2 倍补偿；inputtext 节点类型（无 text 渲染 prompt UBB 占位、password 渲染圆点、data-fgui-input/password/maxlength 溯源属性）；shadowColor/shadowOffset -> text-shadow；bold/italic/underline -> font-weight/style/text-decoration；singleLine 与 autoSize=both -> white-space:nowrap、both 另输出 width/height:auto | text-node.ts、html-renderer.ts、component-parser.ts |
| R24 list 布局补齐 | flow_vt -> grid-auto-flow:column + grid-template-rows:repeat(N)；flow_hz/pagination 无 lineItemCount 时按视口宽与 item 尺寸推算每行列数；展开上限语义化：overflow=scroll 按视口推算可视容量 x2（多留一屏，对齐 overscan 思路），其余全量展开（安全上限 listItemCap 可配，缺省 200） | list-node.ts、scene-builder.ts（SceneOptions.listItemCap） |
| R25 pivot 旋转基点 | baseStyle 增加 transform-origin（pivot 0-1 归一化转百分比），全节点类型共享 | utils.ts |

## 期间发现并修复的存量 bug

- **tint 染色 filter 双前缀**：tintStyle 返回值自带 `filter:` 前缀，image-node/loader-node 拼接时再加一次，输出 `filter:filter:url(...)` 为非法 CSS，浏览器整条丢弃——**image/loader 的染色 filter 自 P1 起实际一直无效**（历史断言只查 SVG defs 存在，未查 filter 属性合法性）。根因修复：tintStyle 返回裸 url 引用，由调用方统一拼 filter 属性。R22 的 alpha 断言（opacity:0.502 + 合法 filter）间接暴露此 bug。

## 验收结果（对照需求验收标准）

| 标准 | 结果 |
|---|---|
| 实例 controller/page 覆写后 gear 按指定页求值 | 通过（P2Fix ovInst controller="c_ov,1" -> page1Dot 可见 / page0Dot 隐藏） |
| group 不产生占位/上报，成员正常显示 | 通过（groupMember 渲染、无 data-fgui-name="g"、无未支持项） |
| 染色 alpha / 九宫格启用判定 / aspect | 通过（opacity:0.502 复合；i_c(9grid) border-image、i_b(保留未启用) 无 border-image；object-fit:contain） |
| 输入框静态呈现 / 描边口径 / 阴影 / 样式布尔 | 通过（prompt UBB `<i>` + color:#999999、password 圆点 + data 属性、font-weight:bold + text-shadow:2px 3px、text-decoration:underline；实测 Demo_Text 阴影 3px 3px、描边 2px=1x2 补偿） |
| flow_vt / flow_hz 自动折行 / 展开窗口 | 通过（grid-auto-flow:column + repeat(2)；视口 70px/item 30px -> 2 列；overflow=scroll 50x50 视口 -> 仅展开 2 项；listItemCap=3 -> 3 项） |
| pivot transform-origin | 通过（50% 50% + rotation） |
| 既有断言不退化 | 通过（render 68 项全绿 + tsc + server/mcp/convert 套件） |

## 浏览器实测（真实样本）

- Demo_Clip&Scroll：group 节点不再产生 unsupported 占位，**未支持清单清零**，23 节点全部正常渲染。
- Demo_Text：text-shadow 3px 3px、-webkit-text-stroke 2px（strokeSize 缺省 1 x2 补偿）、bold 生效。

## 新增测试资产

- tests/fixtures/workspace/assets/cycle/P2Fix.xml（实例页覆盖/group 成员/输入框两态/样式布尔与阴影/aspect/染色 alpha/九宫格启用判定/pivot/flow_vt/flow_hz 自动折行/视口展开窗口十二合一夹具）
- OvChild.xml（页覆盖目标组件）、SmallItem.xml（小尺寸 item 组件）、图片资源 i_b/i_c（未启用 9grid / 启用 9grid 对照）
- tests/render-check.ts：新增 14 项断言（render 套件累计 68 项）

## 遗留问题（P3 暂缓项，按真实工程触发）

- graph polygon/regular_polygon（内联 SVG 方案）、字体体系（@font-face/位图字体）、list clipSoftness、gearFontSize/gearText/gearColor 描边段、image fillMethod radial90/180/270、loader fill/autoSize 对组件内容、GButton/GLabel 独立分支。
