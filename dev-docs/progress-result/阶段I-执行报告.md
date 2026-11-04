# 阶段 I 执行报告：渲染器能力补齐第二批（P1：R10-R15）

- 完成时间：2026-11-04
- 状态：验收通过（render 断言 54/54 + tsc + server/mcp/convert 套件全绿 + 浏览器实测确认；无回归）
- 需求依据：dev-docs/planning/2026-11-04-渲染器能力补齐需求文档.md（P1 批次）
- 调研依据：dev-docs/research/2026-11-04 系列（8 篇三方对比调研）

## 交付内容（对照需求 P1 批次）

| 需求 | 实现 | 涉及文件 |
|---|---|---|
| R10 graph 圆角与描边 | corner 解析（顺序 tl,tr,bl,br 经 GGraph/Shape 源码核实；1 值扩展 4 角对齐 OpenFairy radii[min(i,len-1)]）映射 border-radius 四长属性；lineSize>0 时 rect/ellipse 输出 border（box-sizing:border-box 保证不扩外），其他形状仍上报 | graph-node.ts |
| R11 list item 属性下发 | parser 捕获 `<item>` 逐项属性（items）；expandList 对每项场景副本下发 title（复用 applyTitle）与 icon（写入 name="icon" loader 并解析 url，支持跨包 image/component） | component-parser.ts、scene-builder.ts |
| R12 loader 组件分支 | url 指向包内 component 时 expandLoaderComponent 展开为 childComp（循环防护 + 稳定键 `~pkgId.resId` 续接，复用 component 范式）；渲染委托 renderComponentNode（含 overflow 裁剪） | scene-builder.ts、loader-node.ts |
| R13 richtext/UBB/模板 | richtext 注册复用 text 渲染；模板占位替换（vars：`\{` 转义、`{}` 字面、`{name=default}` 取 default、`{name}` 置空，对齐 TextTemplateCompiler）；UBB 白名单映射（b/i/u/strike/sup/sub/color/size/font/align/img/url，对齐 UBBParser 标签表，先 esc 再替换，未知标签按原文降级）；[img]ui:// 构建期预解析为绝对路径、渲染期 toAssetUrl 转 URL | text-node.ts、scene-builder.ts、html-renderer.ts、component-parser.ts |
| R14 image fillMethod | hz/vt 用 clip-path inset（origin 左右/上下起）；radial360 用 conic-gradient mask（origin 下/右/上/左 -> 180/90/0/270deg，clockwise 缺省顺时针，逆时针取补弧）；amount>=100 完整显示；radial90/180/270 显式上报未支持 | image-node.ts |
| R15 初始页规则对齐 | controller.selected 改为 homePage 规则（homePageType=specific 时取 homePage 页，缺省第一页，对齐 OpenFairy InitialPage）；selected 为编辑器残留态不再参与 | component-parser.ts |

## 期间发现并修复的根因 bug

1. **controller pages 空页名破坏交替关系**：`pages="0,,1,,2,"`（页名为空，FairyGUI 常见）经 `split(",").filter(Boolean)` 后 id/name 交替被破坏，页 id 解析成 `[0,2]`（应为 `[0,1,2]`）。修复：先取偶数位再去空 id。由 gearColor 断言失败暴露。
2. **数字字符引用未解码**：文本属性中的 `&#xA;`（换行）等数字实体 fast-xml-parser 不解码，渲染为字面 `&#xA;`。修复：attrsOf 统一解码 `&#xHH;` / `&#DDD;`（命名实体 parser 已处理）。
3. **BagWin 断言语义更新**：CloseButton 控制器 selected="3"（编辑器残留）此前被当作初始页；R15 后按首页渲染，gearXY n4 取值 (0,10)、c1 首页节点 n1/n3 可见——与 FairyGUI 运行时行为一致。

## 基础设施改进

- globalIndex 按工程 root 缓存（module 级 Map，clearCache 同步失效）：loader/list/UBB img 的 ui:// 解析共用，避免逐节点全工程扫描。

## 验收结果（对照需求验收标准）

| 标准 | 结果 |
|---|---|
| corner 1 值/4 值圆角正确渲染 | 通过（P1Fix corner="2,4,6,8" 四长属性断言） |
| rect/ellipse 描边不再上报，视觉与 FairyGUI 基本一致 | 通过（border:2px solid + ellipse border-radius:50% 并存断言） |
| 带 title/icon 的列表项与编辑器预览一致 | 通过（Demo_List 实测：titles 100/1/2/99/4/5 下发，6/6 icon 图片加载） |
| loader url 指向组件展开子场景 | 通过（P1Fix compLoader 断言 + 实测 overflow:hidden） |
| UBB 渲染出样式、未知标签按原文输出 | 通过（Demo_Text 实测：[color][b] 嵌套、[size] span、[img] 加载、[url] data-href） |
| 模板 {name=default} 静态替换 | 通过（"hi world {} {esc}" 断言） |
| fillMethod 填充形态正确 | 通过（hz 50% clip-path 命中测试左半命中/右半穿透；radial360 逆时针 25% conic 断言） |
| 初始页 homePage 规则 | 通过（homePage=specific 指定页可见性断言 + BagWin 首页断言更新） |
| 既有断言不退化 | 通过（render 54 项全绿 + tsc + server/mcp/convert 套件） |

## 新增测试资产

- tests/fixtures/workspace/assets/cycle/P1Fix.xml（homePage 控制器/corner 四值/描边/polygon 上报/fillMethod hz+radial360/模板/UBB/loader 组件分支/gearDisplay 首页九合一夹具）
- GearColorText.xml 改为 homePageType=specific 驱动（原 selected 属性不再参与初始页）
- tests/render-check.ts：新增 12 项断言 + BagWin 三项按 R15 语义更新（render 套件累计 54 项）

## 遗留问题

- P2 批次（R20 实例页覆盖 / R21 group / R22 image 精度 / R23 text 排版细节 / R24 list 布局补齐 / R25 pivot）待按需排期
- loader fill/autoSize 对组件内容未实现（renderComponentNode 复用，需要时按 GLoader 语义补）
- radial90/180/270 填充未实现（显式上报；需扇形遮罩时再补）
- UBB [url] 降级为 data-href 下划线 span（无跳转交互，符合静态渲染定位）
