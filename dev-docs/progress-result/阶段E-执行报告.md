# 阶段 E 执行报告：视觉还原度提升（未支持清单驱动）

- 完成时间：2026-10-29
- 状态：验收通过（check 34 + check:server 20 + check:mcp 9 = 63 项断言全绿；BagWin 未支持清单清零；截图存档 dev-examples/stage-e-shots/）

## 交付内容（对照阶段 E 执行计划）

| 任务 | 实现 |
|---|---|
| E1 gearColor | **编码破解（纠正此前误判）**：与 gearSize 同构——`\|` 分页、每页 `color,stroke` 逗号分隔、`-` 用 default。早期手动分割漏数一个 `\|` 导致误判「编码不匹配」；本次按规范读 SDK 后重数确认。resolveGear 按默认页覆盖 text 颜色 / image 染色 / graph 填充 |
| E2 文本描边 | strokeColor/strokeSize → `-webkit-text-stroke`（近似：FairyGUI 描边向外、CSS 居中，视觉略细） |
| E3 标题注入 | component 节点解析扩展子元素（`<Label title="Bag"/>` → extensionProps）；buildScene 注入子场景 `name="title"` 的 text 节点（副本上修改，延续 A2 隔离原则） |
| E4 list 静态渲染 | workspace 新增 buildGlobalIndex/parseUiUrl（`ui://<pkgId><resId>` 无分隔符，pkgId 最长前缀消歧）；buildScene 为 list 按 item 子元素数展开实例场景（keyPrefix 含 `#i` 防重）；渲染器 flex 布局近似（row/pagination-wrap/column）；item 携带自身包（跨包 byId 正确性） |
| E5 loader | 无 url（运行时填充）→ 灰底占位框标注 Loader，**移出未支持清单** |

## 关键修复：gear 页索引语义

pickGearValue/applyGear 原用 `controller.pageIds.indexOf(selected)` 作 values 索引——在 gear.pages 与 controller 页布局不一致时越界回退 default（单页 gear 必现）。修正为 `gear.pages.indexOf(selected)`（gear.values 与 gear.pages 一一对应）。

## 验收结果

- BagWin 未支持清单**清零**：标题显示「Bag」（窗口标题 0 残留）、list 展开 BagGridSub×20 + dot×3、描边生效、loader 占位 21 个不再上报
- gearColor fixture 断言：c1 默认页文本覆盖为黑色生效
- 既有 check 27 + check:server 20 + check:mcp 9 项全部不退化（含 A 阶段幂等/循环隔离等）
- tsc strict 通过；截图 05-bagwin.png（27KB）

## 遗留问题

1. text-stroke 为近似实现（宽度视觉略细）；需要精确还原时可换 paint-order+多阴影方案
2. list 布局为 flex 近似（pagination 网格按 wrap 流）；与编辑器像素级对齐需逐样本校准
3. icon 注入（`<Label icon="..."/>`）暂无样本，未实现
4. gearColor 仅覆盖 color 段；stroke 段（文本描边变色）暂未应用
