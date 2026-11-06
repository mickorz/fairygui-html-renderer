# 阶段 P 执行报告：S2 资产索引 + S3 组件图谱 + S7 MCP 工具

- 完成时间：2026-11-05
- 来源：egret 项目对比分析 S2/S3/S7（+ rel-bar 接入工作台）
- 状态：验收通过（ui-asset 22 项断言 + 五套件全绿 + 浏览器 rel-bar 实测 + MCP 视觉确认）

## 交付内容

| 项 | 实现 | 文件 |
|---|---|---|
| S2 资产索引 | 全工程逐包逐组件元数据（包/资源 id/尺寸/节点数/控制器数）+ 引用边（src 同包资源 / loader url / list defaultItem，ui:// 跨包解析，悬空引用如实保留）+ 解析失败诊断不静默 | src/scene/ui-asset-index.ts（新增） |
| S2 检索/反向引用 | searchUiAssets（文件/组件名/包名/pkgId.resId 子串）+ findComponentUsages（id 或 file 二选一 -> 引用方清单） | 同上 |
| S3 组件图谱 | 引用边收集（kind=component）-> Tarjan SCC 环检测（迭代式防深递归；尺寸>1 分量 + 自环）-> 出入度统计 -> 枢纽排行 Top20 -> 未引用清单（入口组件正常形态）+ classNeighborhood 邻域（uses/usedBy 带对方组件名与跳转文件 + inCycle） | src/scene/component-graph.ts（新增） |
| HTTP 三路由 | /api/ui-assets（检索）/ api/ui-assets/usage（反向引用）/ api/component-graph（全图或邻域） | src/server/server.ts |
| S7 MCP 三工具 | search_ui_assets / find_component_usages / get_component_graph（4 -> 7 工具；与 HTTP 同一服务函数） | src/mcp/tools.ts、src/mcp/main.ts |
| rel-bar 接入 | 工作台画布上方组件关系条：打开组件即拉邻域，"引用了/被引用"两排芯片（组件名 + 边类型·路径），点芯片跳转对应组件；环警告红色提示 | src/editor/canvas-host.ts、editor-page.ts |
| scene-json 补字段 | doc.resourceId（rel-bar 拼邻域 key 用） | src/scene/scene-json.ts |

## 设计要点

- **引用只算本文件声明的边**：索引遍历 displayList 原始节点（getComponent 解析层），不含构建期展开子树——被引用组件自身的引用在其自己的索引条目里，天然无重复计数
- **悬空引用保留原文**（ui:// 无法解析时 to 保留原 URL），图谱层跳过但索引层如实可见
- **图节点身份 = pkgId.resId**（与 ui:// 寻址一致），graphIdOf 支持 pkgId.resId 或工程相对路径二选一
- **索引每请求 fresh 构建**（21 包 168 组件实测 274ms，不做缓存；对齐 egret "索引按需构建"决策）
- **迭代式 Tarjan**（显式栈帧，避免深递归栈溢出）

## 验收结果

| 标准 | 结果 |
|---|---|
| 夹具断言（cycle 包 20 组件） | 通过（22 项：索引/检索/反向引用/图谱/邻域/环检测） |
| 真实样本 CC-Default | 通过（168 组件索引零解析失败；枢纽 Button10.xml 入度 21；Button3 被 Demo_Button 引用） |
| HTTP 路由 | 通过（检索命中/邻域/全图 181 边 0 环） |
| MCP 协议 | 通过（7 工具；stdio 冒烟） |
| rel-bar 实测 | 通过（Button.xml：引用了=无，被引用=Demo_Button 芯片；点击跳转 Basics/components/Button.xml；MCP 视觉确认芯片分组） |
| 既有断言不退化 | 通过（render 105 + server/convert/mcp 套件） |

## 与 egret 版的差异

| egret | fairygui | 原因 |
|---|---|---|
| 类名索引（thm 优先）单级 | pkgId.resId 二级 | FairyGUI 资源寻址模型 |
| 边三类：tag/itemRenderer/skinName | src/url/defaultItem | FairyGUI 引用形态（无皮肤类概念） |
| 孤儿皮肤报告 | 未引用清单（入口组件正常形态） | FairyGUI 入口组件（Demo_*/Main）天然无人引用 |

## 遗留

- S4 场景 diff、S5 XML 写出器：后续批次
- rel-bar 目前只显示邻域；全图可视化（枢纽排行浏览）待需要时加
