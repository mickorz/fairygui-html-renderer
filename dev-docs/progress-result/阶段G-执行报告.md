# 阶段 G 执行报告：可重复转换流水线

- 完成时间：2026-10-29
- 状态：自动化部分验收通过（check:convert 12/12，累计 79 项断言全绿；三样本回读截图已存档）；**编辑器打开三个新包（Converted/FlexGrid/Nested）的人工验证待用户**（机制与已验证的 Converted 同构）

## 交付内容（对照阶段 G 执行计划）

| 模块 | 实现 |
|---|---|
| extractor.ts（browser-extractor） | **无人值守提取**：提取脚本注入样本 HTML（JSON 写入隐藏 `<pre id="__extract__">`）→ Chrome headless `--dump-dom` → Node 解析。零新依赖，可脚本化重复执行；提取发生在渲染后，Flex/Grid 自动导出计算后位置 |
| style-mapper.ts | 提取 JSON → FGNode 树：容器→component（递归子组件文件）、纯色背景容器/文字→先铺 graph 背景、img→image、opacity→alpha、rotate→rotation、rgb→hex；报告（total/byKind/skipped） |
| fairy-writer.ts | 确定性 id（djb2 base36，同内容同 id，重复导出不冲突）；容器→独立组件 XML 递归；安全边界保留（已存在目录拒绝覆盖）；修复组件写盘目录错误（曾错写到样本目录） |
| validator.ts | 回读对照：提取节点按 name 匹配回读场景，±1px 容差，输出逐节点偏差表 |
| transform.ts | 流水线编排 CLI：`npx tsx src/convert/transform.ts <样本.html> <输出包目录> [--force]`，一条命令完成 extract→map→write→validate 并输出报告 |

## 期间发现并修复的转换规则缺陷

1. **分类优先级**：有背景+子元素的容器曾被判为 graph（子树丢失）——改为「有子元素必为 container，背景挂容器节点」
2. **文字背景**：带背景色的文字元素现在输出 graph 背景 + text 双节点（背包格子类 UI 的普遍形态）
3. **alpha 透传遗漏**：opacity 提取了但 mapper 未写入 FGNode

## 验收结果（对照阶段 G 执行计划验收标准）

| 标准 | 结果 |
|---|---|
| 三样本一条命令全流程 + 报告 | ✅（每样本输出 total/byKind/跳过/回读偏差） |
| 重复执行产物一致 | ✅（确定性 id，package.xml 逐字节一致断言） |
| flex 样本回读坐标 ±1px | ✅（实际 0 偏差，Flex gap/padding 计算位置精确） |
| 嵌套样本生成子组件文件且父引用正确 | ✅（Root.xml 引用 panel.xml；容器背景 graph 落在子组件内；alpha/rotation 透传） |
| 既有 63 项断言不退化 | ✅ |
| 回读截图 | ✅ dev-examples/stage-g-shots/（G1-flex 网格、G2-nested） |

## 转换报告样例（flex-grid）

```json
{ "total": 16, "byKind": { "text": 8, "graph": 8 }, "skipped": [] }
回读对照: 8 节点匹配, 最大偏差 dx=0 dy=0
```

## 遗留问题

1. 三新包（Converted/FlexGrid/Nested）的编辑器人工验证待用户（Converted 已在 F 验证过同构机制）
2. 渐变/阴影/SVG 烘焙未实现（报告 skipped 明确告警，按需后续）
3. React 构建产物验证：机制上已覆盖（导出发生在渲染后），未用真实 React 工程实测
