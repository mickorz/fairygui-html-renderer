# 阶段 A 执行报告：修正核心数据结构

- 完成时间：2026-10-29
- 状态：验收通过（自动化断言 27/27，含新增 12 项；tsc strict 通过；三样本渲染回归正常）

## 交付内容（对照阶段 A 执行计划 A1-A4）

| 任务 | 实现 |
|---|---|
| A1 有序解析 | component-parser 改用 fast-xml-parser preserveOrder 模式，displayList 保留 XML 原始混排顺序；修复审查 #4 潜伏 z 序 bug（混排时同类节点全部前置的遮挡错误） |
| A2 构建与缓存分离 | buildScene（原 buildChildren）每次生成全新节点副本，getComponent 缓存的解析结果为不可变原始数据；循环引用在首次重现处截断，根组件入栈覆盖组件自引用 |
| A3 唯一实例标识 | 新增 data-fgui-key 实例链稳定键 `pkgId.resId.nodeId~pkgId.resId.nodeId~...`（层间 `~` 避开 HTML 转义），与可读 data-fgui-path 并存；resourceIdOf 按文件反查资源 id |
| A4 缓存失效接口 | getComponent 支持 `{ fresh: true }` 绕过缓存重解析；导出 clearCache()，为阶段 B 每请求重解析预留 |

## 回归测试（tests/render-check.ts，27 项）

新增 12 项：

- **混排 z 序**：Demo_Image 全序 12 节点逐一比对 DOM 先后（修复前该断言必失败——原实现按标签聚合）
- **重复构建幂等**：同组件连续 buildScene 两次 JSON 全等
- **缓存无污染**：构建后缓存内原始树无 childComp/unsupported 残留
- **循环引用隔离**：tests/fixtures/cycle 构造 A↔B 互引，从 A 入口与从 B 入口各自正确截断、互不影响
- **稳定键**：BagWin 三层实例链 `rbw1tv9t.kcy10.n7~rbw1tv9t.dwwc3.n2~rbw1tv9t.dwwc4.n4`；同名节点（Dup.xml 两个 name="dup"）键不同
- **失效接口**：clearCache 生效、fresh 绕过缓存

## 过程修复

- preserveOrder 重写时遗漏 ParsedNode.childComp 字段定义（tsc 抓出）
- 循环检测初版根组件未入栈，自引用/互引要在第二次进入才截断（断言暴露后修正为根入栈）
- 稳定键层间分隔符 `>` 会被 HTML 转义为 `&gt;`，改用 `~`

## 经验沉淀

- fast-xml-parser preserveOrder 输出为 `{标签:子内容}` 数组、属性挂 `:@` 键，遍历需跳过属性伴随项
- CLI 单次进程掩盖了缓存失效类问题；服务化（阶段 B）必须默认每请求重解析

## 遗留问题

- 无阻塞项。阶段 B（只读工作区服务）可直接基于本阶段的数据结构接口启动
