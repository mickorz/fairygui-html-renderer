# 阶段 Q 执行报告：S4 场景 diff + S5 XML 写出器

- 完成时间：2026-11-05
- 来源：egret 项目对比分析 S4/S5（同步批次收官：S6 -> S1 -> S2/S3/S7 -> S4/S5 全部落地）
- 状态：验收通过（diff 8 项 + writer 13 项断言 + 七套件全绿 + 真实样本往返一致性）

## 交付内容

| 项 | 实现 | 文件 |
|---|---|---|
| S4 场景 diff | 两份构建场景的结构 diff：身份两层（id 主键优先 + 同父同类型顺序配对兜底，stableKey 兄弟索引敏感故降级为定位信息）；差异四分类（added/removed/moved/changed）；changed 到属性级（flatten 路径全量诚实报告，如 xy / attrs.text / component.file） | src/scene/scene-diff.ts（新增） |
| S4 接入 | GET /api/scene-diff?a=&b=（缺参 400）+ MCP diff_component_scenes | server.ts、mcp |
| S5 XML 写出器 | **合并写出**：语义 HTML 的属性覆盖应用到原组件解析模型 -> 序列化 XML 文本。不猜 DOM->XML 映射：一切结构来自解析模型（gear/controller/扩展元素/list items 全保留）；属性覆盖含结构化字段（xy/size/src/name）生效；装饰元素跳过；展开子树节点按 data-fgui-src 归属过滤（写到来源文件而非本文件）；无同 id 目标/重复 id 如实报诊断不静默 | src/writer/xml-writer.ts（新增） |
| S5 数据通道 | 渲染器 dataAttrs 增 data-fgui-attrs（原始属性全量 JSON，单引号包裹避双引号转义） | src/renderer/utils.ts |
| S5 接入 | POST /api/xml-write {component, html}（只返回文本不落盘，服务保持只读边界；16MB 请求体上限）+ MCP write_component_xml | server.ts、mcp（9 工具） |
| 测试资产 | 夹具 DiffA/DiffB + NoIdA/NoIdB（临时生成）；check:diff / check:writer 两套件挂 package.json | tests/ |

## 设计要点

- **为什么合并写出而不是从 HTML 重建**：FairyGUI 组件 XML 含 gear/controller/扩展元素等丰富结构，HTML 只有属性快照；从 HTML 重建必丢结构。合并模式保证未改动部分语义级保留（往返一致性测试：写出的 XML 重新解析后与原模型 diff 仅剩临时目录路径差异）
- **S4 身份两层与 egret 同构**：id 主键（FairyGUI 同文件 id 唯一、跨版本保留率高）+ 顺序配对兜底；已知边界（无 id 同类型兄弟中间插入的位置敏感性）明示
- **gear 标签对照表**：kind -> tag 逆映射（注意 gearXY 全大写 XY，初版首字母大写化曾产出 gearXy 错误标签——已修）
- **实例注入不回写**：构建期注入的 title/icon（如 ButtonIcon 实例的 title="Hello"）只存在于构建副本，写出器以解析模型为基准，注入值天然不进 XML 定义（测试断言）

## 验收结果

| 标准 | 结果 |
|---|---|
| diff 夹具（DiffA->DiffB） | 通过（根 size / n1 text / n2 xy 三处 changed；n5 removed；n6 added；无假 moved；统计守恒） |
| diff 无 id 顺序配对 | 通过（t2 文本 BBB->CCC） |
| diff 同组件为空 | 通过 |
| diff 路由 + 缺参 400 | 通过 |
| writer 语义提取 | 通过（节点数/装饰跳过计数/无 JSON 错误） |
| writer 往返一致性 | 通过（RenderFix + 真实样本 TreeItem：写出 XML 重解析 diff 仅 component.file 路径差异） |
| writer 属性覆盖 | 通过（text + xy 两处；回读生效——含结构化字段 xy） |
| writer 诊断 | 通过（未知 id warning 不静默） |
| 真实样本全形态 | 通过（controllers 空名页还原 pages="0,,1,"；gearDisplay/gearIcon；Button mode="Radio" 扩展元素；实例注入不回写） |
| XML 写出路由 | 通过（POST 覆盖生效返回 XML；缺 html 400） |
| 既有断言不退化 | 通过（render 105 + 全部七套件） |

## 已知边界（明示）

- 写出器只做属性级覆盖；结构增删移不在范围（HTML 语义不携带结构声明），如实报诊断
- 解析器未保留的根属性（bgColor/scrollBar 等）不会出现在输出（解析模型是唯一真源）
- 语义 HTML 输入需为渲染器产物形态（data-fgui-* 约定）；AI 生成 UI 按此约定书写
- 场景 diff 的无 id 顺序配对对中间插入敏感（从插入点起报属性变化链）；有 id 节点不受影响

## 同步批次总结（S6 -> S5 全收官）

| 批次 | 内容 | commit |
|---|---|---|
| S6 | 路径守卫符号链接加固 | 阶段 O |
| S1 | 三栏可视化工作台 | 阶段 O |
| S2+S3+S7 | 资产索引/组件图谱/MCP 三工具 + rel-bar | 阶段 P |
| S4+S5 | 场景 diff / XML 写出器 + MCP 2 工具 | 阶段 Q |
| S8 | benchmark 方法论 | 文档级（已随对比分析落 research，工作台主线验收时引用） |
