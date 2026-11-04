# UI 编辑器 P0 GrapesJS 兼容性报告（初版）

- 日期：2026-11-04
- GrapesJS 版本：v0.23.9（thirdparties/grapesjs submodule 锁定同版本，源码参考）
- 对应计划：[2026-11-04-UI编辑器P0执行计划.md](../planning/2026-11-04-UI编辑器P0执行计划.md) Task 1
- 状态：初版（Task 1 门禁通过）；Task 3（只改目标节点）与 Task 6（Converter 闭环）完成后补充对应问题结论，Task 7 定稿

---

## 一、四个核心问题的回答

### 问题 1：GrapesJS 能否无损导入现有 AI HTML？

**能（含条件）。** 五个样本（2 个编辑器样本 + 3 个现有 convert fixtures 交叉验证）经「导入 → 零操作 → 导出 → 回读对比」：semantic/geometry/asset 差异全部为零；仅 convert-hello 存在 3 条 css-format 级差异（CSS 文本表达变化，视觉等价，详见第四节）。

前提是必须使用第三节的关键配置——默认配置下导入导出会**静默丢失全部内联样式**（见第二节），不满足无损。

### 问题 2：能否保留原始 CSS 和 DOM 结构？

**能。**

- DOM 结构：节点数量、层级、tag、id、class 集合、文本内容（直接文本节点级）全部一致；
- CSS：规则级对比（原始 styles.css / style 标签 vs 导出 CSS）值全部等价；
- 已知表达差异（css-format，不阻断）：
  1. 浏览器 CSSOM 解析导致 shorthand 展开（`margin: 0` → `margin-top/right/bottom/left: 0px`）、颜色 hex → rgb()——两侧经同一解析管线后天然等价；
  2. GrapesJS 导出会额外生成与内联 style 同值的 `#id` 规则（冗余但无害：Converter 读 computed style，内联优先级最高）；
  3. 纯空白文本节点被序列化删除（absolute/块级容器内渲染等价）。

### 问题 3：拖动和缩放能否只修改目标节点？

**待 Task 3 验证**（按需提升策略落地后回填本节）。

### 问题 4：导出的 HTML 能否被现有 Converter 正确处理？

**待 Task 6 验证**（convert 闭环后回填本节）。静态有利条件：导出 HTML 保留 `#canvas` 结构、内联 style、原始相对资源路径，与现有 `extractFromHtml` 的输入约定完全一致。

---

## 二、关键发现：三个默认配置会导致静默样式丢失（最重要的结论）

GrapesJS v0.23.9 默认配置**不能**用于本项目场景，三个默认值叠加后，导入时内联样式全部静默丢失：

| 配置 | 默认值 | 危害机制（源码定位） | 修复 |
|---|---|---|---|
| `avoidInlineStyle` | `true`（config.ts:469） | `Component.getAttrToHTML()` 直接 `delete attrs.style`（Component.ts:1665-1667），toHTML 不输出内联样式 | `avoidInlineStyle: false` |
| `forceClass` | `true`（config.ts:450） | `Components.onAdd()` 把内联样式转为生成类（c752 等）规则并清空内联（Components.ts:423-432），但规则未正确落库 CSS Composer，导出即丢 | `forceClass: false` |
| `protectedCss` | `'* { box-sizing: border-box; } body {margin: 0;}'`（config.ts:455） | 注入画布并混入 getCss 导出，content-box 元素几何变化（border 计入宽高，如 2px 边框面板 564px → 560px） | `protectedCss: ""` |

最终生效配置（src/editor/grapes/editor-instance.ts）：`avoidInlineStyle: false` + `forceClass: false` + `protectedCss: ""`。

**验证对照**：默认配置下 convert-hello 样本 6 semantic + 12 geometry（全部元素 left/top/width/height/color/font-size 丢失）；修复后同样本全零。

教训：GrapesJS 的默认行为面向「从零搭建网页」场景，本项目面向「既有 HTML 保真编辑」，两者的导出语义相反，凡是影响序列化的默认值都要显式声明。

## 三、门禁工具与结果

- 工具：`npm run check:grapes`（tests/grapes-fidelity.ts），Playwright（系统 Chrome）驱动 Vite dev 页面，页面内完成导入/导出/双渲染快照，Node 侧分级对比；
- 报告：`editor-workspaces/fidelity/<sample>-noop-report.json`（gitignore）；
- 机器判定：semanticDiffs / geometryDiffs（1px 容差）/ assetDiffs 全零放行；cssFormatDiffs 仅记录。

| 样本 | 节点数 | semantic | geometry | asset | css-format | 结果 |
|---|---|---|---|---|---|---|
| sample-a-popup（750×1334 弹窗，外部 class 规则） | 7 | 0 | 0 | 0 | 0 | 通过 |
| sample-final-item（模拟 AI 产物道具弹窗，img+文本+按钮） | 7 | 0 | 0 | 0 | 0 | 通过 |
| convert-hello（内联 style 样本） | 3 | 0 | 0 | 0 | 3 | 通过 |
| convert-nested（嵌套 + opacity/rotate） | 3 | 0 | 0 | 0 | 0 | 通过 |
| convert-flexgrid（Flex 混合布局） | 8 | 0 | 0 | 0 | 0 | 通过 |

结果可重复：连续两轮输出完全一致（forceClass 关闭后无随机生成类）。

对比器说明（非 GrapesJS 缺陷，属验证方法）：textContent 对比采用直接文本节点并做空白归一化——HTML 源码缩进空白与序列化压缩在块级/absolute 布局下渲染等价；几何快照基于干净 iframe 双渲染，两侧同为 computed style 基准。

## 四、已知事项与遗留

1. **#id 冗余规则**：GrapesJS 解析时对带 id 的元素生成同值 CSS 规则随 getCss 输出（如 `#pic{left:24px;...}` 与内联 style 并存）。无害（内联优先级最高、Converter 读 computed style）；Task 5 导出后处理可评估剥离。
2. **shorthand 展开**：getCss 输出为 longhand 展开形式（浏览器 CSSOM 特性），体积增大但视觉等价。
3. **Sample E/F 覆盖范围**：flex 样本（convert-flexgrid）通过说明 Flex 容器的 computed 位置导入导出往返无损；但「编辑后再导出」路径（非零操作）留待 Task 3 验证。
4. **真实 AI 产物**：当前 sample-final-item 为手工模拟；拿到真实 AI 生成 HTML 后立即补入 check:grapes 样本清单复跑。
5. 画布渲染已通过 DOM 断言（画布 750×1334、图片加载、元素几何与设计坐标一致），截图存档 dev-examples/ui-editor-p0/（沙盒不进 git）。

## 五、复跑方式

```bash
npm run check:grapes   # 全样本回归，exit code 非零即门禁未过
```
