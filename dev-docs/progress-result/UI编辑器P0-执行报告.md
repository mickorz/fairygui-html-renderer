# UI 编辑器 P0 执行报告（基于 GrapesJS 的游戏 UI 可视化编辑器技术验证）

- 阶段：UI Editor P0（技术验证）
- 执行窗口：2026-11-04 ～ 2026-11-05
- 分支：`mickorz/editor-dev`
- 验证命题：GrapesJS 能否在不破坏 AI 生成 HTML 的前提下，成为 FairyGUI 的可视化编辑层
- 结论先行：**命题成立**。链路「AI 生成 HTML → 编辑器人工调整 → 导出 HTML → Converter → FairyGUI XML」
  已端到端打通并有自动化验收护栏，Converter 与 GrapesJS 核心均零改动。

## 一、交付清单

### 1. 编辑器前端（src/editor/）

| 模块 | 说明 |
|------|------|
| `grapes/editor-instance.ts` | GrapesJS 实例化与配置组合（见二.1，本阶段最关键结论） |
| `grapes/load-html.ts` | AI HTML 无损装载（`avoidInlineStyle:false + forceClass:false + protectedCss:""`） |
| `grapes/canvas-config.ts` | 固定画布尺寸（按 meta canvas） |
| `grapes/drag-enhance.ts` | 拖动按需提升（`fgui-origin-layout` 快照 + `fgui-layout-changed` 标记） |
| `grapes/session.ts` | 会话客户端：载入/projectData 恢复/重导出一致性对比/保存（不一致 banner 二选一） |
| `grapes/use-editor.ts` | React 桥：编辑器事件 → 外部 store 快照 → `useSyncExternalStore`（React 永不碰画布内 DOM） |
| `adapter/` | 编辑态数据与 HTML 互转（node-id/normalize/import/export，断言 23/23） |
| `components/` | LayerTree（递归树双向选中）/ PropertyPanel（四分节直连 component API）/ TopToolbar / StatusBar |
| `App.tsx` | `?session=<id>` 会话流 + Ctrl+S/保存按钮接线 |

### 2. 服务端（src/server/）

| 模块 | 说明 |
|------|------|
| `editor-session.ts` | 6 类路由：POST 会话 / GET / PUT（sourceRevision 乐观锁 409）/ GET project / POST export / GET asset 资源流（拒绝跨目录） / **POST convert**（Task 6：`<link>` 组装输入 → runPipeline → 隔离新包 + 报告落盘，已存在 400 PKG_EXISTS） |
| `server.ts` | convert 输出根接线（`<工程assets>/<pkg>`） |

### 3. 测试护栏（check:* 套件，统一入口 `npm run check:e2e`）

| 套件 | 断言数 | 覆盖 |
|------|--------|------|
| check | - | 渲染器既有回归 |
| check:server | - | 服务端既有回归 |
| check:convert | +5 | 新增 sessionlike 样本（会话形态输入：body 片段 + `<link>` styles.css + assets/ 子目录）零改动走流水线 |
| check:adapter | 23/23 | 编辑态数据与 HTML 互转 |
| check:canvas | 5/5 | 画布尺寸/坐标/zoom/resize/滚动 |
| check:drag | 18/18 | 拖动/undo/按需提升/缩放八方向/**滚动容器内拖动**/**zoom 换算** |
| check:props | 15/15 | 图层树/属性面板/文本内容刷新/快捷键 |
| check:grapes | 门禁 | 五样本无操作导入导出保真度（semantic/geometry/asset 全零） |
| check:editor | 39/39 | API 24（会话 CRUD/乐观锁/资源路由/convert 8 条）+ 浏览器 15（图片加载/CSS url/替换/保存/重开恢复/不一致 banner/**convert bare 回读截图**） |

复跑方式：`npm run check:e2e`（九套件链式，全绿）。

### 4. 文档

- 兼容性报告（定稿）：`dev-docs/progress-result/UI编辑器P0-GrapesJS兼容性报告.md`
- 经验沉淀（本阶段 4 篇）：componentFirst 内联覆盖、cmpdrag 合成事件残留、canvas base href 资源路由、
  滚动拖动 sorter 残留（另有 Windows submodule/长路径 1 篇）

## 二、关键结论

### 1. 三个默认配置组合决定成败（兼容性报告第二节详述）

`avoidInlineStyle: false` + `forceClass: false` + `protectedCss: ""` 保全 AI HTML 内联样式与结构；
`selectorManager: { componentFirst: true, appendTo: "" }`（Task 3 补）使编辑写入直达内联 style——
五个开关共同决定「编辑写入目标」，改任何一个必须复查组合效果。

### 2. 四个核心问题全部回答「能」（兼容性报告第一节）

1. 无损导入：五样本 semantic/geometry/asset 全零（门禁）；
2. 保留原始 CSS/DOM：类规则经渲染后提取，快照属性兜底；
3. 拖动缩放只改目标节点：按需提升策略，父/兄弟零位移；
4. 导出可被 Converter 处理：**Converter 零改动**（两路验证：check:editor convert 断言 + sessionlike 样本）。

### 3. 会话一致性边界已闭环

projectData 为唯一编辑态；重开时 projectData 恢复 + 与磁盘重导出对比，不一致时 banner 二选一
（取消不覆盖 / 以恢复态为准），乐观锁 sourceRevision 防并发覆盖。

## 三、架构边界（执行中验证成立）

- React 永不碰画布内 DOM（外部 store + useSyncExternalStore，只读重渲染）；
- GrapesJS 永不碰画布外 UI（面板/工具栏全部 React 实现）；
- Converter 零改动（会话资源布局 `editor/assets/` 与其相对解析规则对齐，`<link>` 组装输入）；
- thirdparties 全部 submodule 只读参考（未改一行上游源码，扩展全在编辑器实例层）。

## 四、commit 记录

| commit | 内容 |
|--------|------|
| e4d498f | Task 0 依赖安装与工程基建 |
| f57269f | Task 1 POC 与保真度门禁通过 |
| 063988f | Task 1.5 Adapter 前置验证（23/23） |
| 3675793 | Task 2 固定画布与坐标系统（5/5） |
| 8e02af5 | Task 3 选择/拖动/缩放（16/16） |
| d214d34 | Task 4 图层树与属性面板（15/15） |
| 80f26e9 | Task 5 服务端会话（29/29） |
| a75761a | Task 6 Converter 集成闭环（37/37 + sessionlike） |
| （本次） | Task 7 自动化验收与报告（drag 18/18、editor 39/39、check:e2e 链式） |

## 五、遗留事项与后续

1. **T17 真实 FairyGUI 编辑器人工验收**：转换产物需用户在 Unity/ FairyGUI 编辑器实机导入确认（自动
   化无法覆盖人工验收）；建议拿真实项目包名/组件名跑一轮。
2. **真实 AI 生成 HTML 样本**：check:grapes 门禁目前使用五个人工样本；拿到真实 AI 产线 HTML 后补入
   样本集复跑（执行计划已预留）。
3. **逐像素画布对照未做（有意）**：编辑器画布与 FairyGUI 渲染是两条渲染管线，字体/抗锯齿必然差异，
   P0 以结构对照（回读 matched 节点坐标 ±1px）为验收口径；如需视觉对照建议后续做关键元素包围盒对齐
   的松散对照。
4. **滚动容器拖动的 sorter 残留**：GrapesJS 内部状态残留（详见经验文档），P0 在自动化层以 reload 规
   避；若真实用户高频交替「滚动区拖动 → 画布拖动」出现漂移，再评估在 drag 结束事件补全清理。
5. **P1 候选**（执行计划已列）：多页/多画布、资源上传路由、撤销历史持久化、组件库面板等。

## 六、经验索引

- `dev-docs/experience/grapesjs-componentFirst-inline-style-override.md`
- `dev-docs/experience/grapesjs-cmpdrag-synthetic-event-residue.md`
- `dev-docs/experience/grapesjs-canvas-base-href-asset-route.md`
- `dev-docs/experience/grapesjs-scroll-drag-sorter-residue.md`
- `dev-docs/experience/windows-git-clone-longpaths-and-cross-drive-submodule.md`
