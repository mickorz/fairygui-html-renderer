# 阶段 K 执行报告：P3 补充批次（movieclip 首帧 + gear 系列登记）

- 完成时间：2026-11-04
- 状态：验收通过（render 断言 78/78 + tsc + server/mcp/convert 套件全绿 + 浏览器实测确认；无回归）
- 计划依据：dev-docs/planning/2026-11-04-P3清单与执行计划.md（按 CC-Default 频率实测校准）

## 交付内容

| 项 | 实现 | 涉及文件 |
|---|---|---|
| movieclip（jta）首帧渲染 | jta 二进制解析（格式经 OpenFairy Migrate.ImportMovieClip 源码核实：uint16 长度前缀 + "yytou" 魔术串 + interval + 8 保留 + 尺寸 + 标志 + 帧数 + 帧表 12 字节/帧(addDelay,x,y,w,h,imageIndex 大端) + int16 图片数 + 每图 int32 长度 + PNG 字节）；帧图 data URL 内联（jta 内嵌 PNG 无独立文件通道，静态渲染不落盘）；帧矩形绝对摆放在动画画布内；帧号优先级 gearAni > frame 属性 > 0；color/gearColor 染色复用 feColorMatrix；尺寸缺省取动画画布尺寸 | src/parser/jta.ts（新增，带缓存）、nodes/jta-node.ts（新增） |
| gearLook | GEAR_KINDS 登记为 kind "look"；页值格式 "alpha,rotation,grayed[,touchable]"（经 GearLook.cs 字段核实）→ alpha 输出 opacity、rotation 输出 transform:rotate、grayed 输出 filter:grayscale(1)，并入 gearStyle 前缀传给全部节点渲染器 | gear.ts |
| gearText | 页值覆盖文本内容（渲染期，走完整模板/UBB 链路） | text-node.ts |
| gearFontSize | 页值覆盖字号 | text-node.ts |
| gearIcon | 页值覆盖 loader url（构建期，优先于 attrs.url，复用既有 image/component 解析通路） | scene-builder.ts |
| gearAni | 页值首段帧号作为 jta 渲染帧（与 movieclip 首帧协同） | jta-node.ts |
| gearDisplay2 | 登记为 kind "display2"，静态按页成员可见性近似（condition/伙伴 AND/OR 组合不实现，标注 ceiling） | gear.ts |

## 关键实现决策

1. **jta 帧图用 data URL 内联**：jta 内嵌 PNG 无独立文件（OpenFairy 需合成落盘成多张 PNG），静态渲染单帧用 data URL 零副作用，不污染包目录。
2. **帧矩形直接摆放不合成**：OpenFairy 把帧图合成到画布再导出；HTML 侧直接绝对定位摆放单帧图（left/top/width/height），语义等价且零图像处理。
3. **gearLook 并入 gearStyle 前缀**：一处改动覆盖全部 9 种节点渲染器；已知 ceiling：节点 attrs 同属性（alpha/rotation）时 baseStyle 后置覆盖 gear 值（罕见冲突，静态近似接受，代码内 ponytail 注释标注）。
4. **GButton/GLabel 独立分支划掉**：实测导出 XML 已展开为 component + 扩展设置，title 注入链路已工作，无需独立分支。

## 验收结果

| 标准 | 结果 |
|---|---|
| jta 节点渲染首帧/指定帧/gearAni 帧 | 通过（P3Fix：帧 0 整图矩形 61x53、frame="1" 局部矩形 5,10,30,26、gearAni 帧 1） |
| gearLook 默认页 alpha/rotation/grayed | 通过（opacity:0.54 + rotate(180deg) + grayscale(1)） |
| gearText/gearFontSize/gearIcon 默认页覆盖 | 通过（GEARED 文本、74px 字号、无 attrs.url 的 loader 渲染出 gearIcon 图片） |
| gearDisplay2 静态可见性 | 通过（首页不在 pages -> visibility:hidden） |
| 真实样本渲染 | 通过（Demo_MovieClip 六个 jta 节点全部 data URL 加载、未支持清单清零；Demo_Controller 未支持清零、gear 默认页语义正确） |
| 既有断言不退化 | 通过（render 78 项全绿 + tsc + server/mcp/convert 套件） |

## 新增测试资产

- tests/fixtures/workspace/assets/cycle/anim.jta（2 帧 1 图夹具，生成脚本 dev-examples/p3-smoke/gen-jta.ts，格式对照 OpenFairy 解析布局）
- tests/fixtures/workspace/assets/cycle/P3Fix.xml（gearLook/Text/FontSize/Icon/Ani/Display2 + jta 三态七合一夹具）
- package.xml 登记 movieclip m_a / component c_p3
- tests/render-check.ts：新增 10 项断言（render 套件累计 78 项）

## 遗留（按触发条件，见 P3 清单文档）

- text font 属性（CC-Default 10 次）：需包级字体资源收集 + @font-face，字体需求出现再做
- graph polygon/regularpolygon（2+2 次）：内联 SVG 方案待真实工程触发
- 其余零频项（clipSoftness/tileGridIndice/blendMode/滤镜/radial90-270/loader fill 对组件内容）维持 unsupported 如实上报
