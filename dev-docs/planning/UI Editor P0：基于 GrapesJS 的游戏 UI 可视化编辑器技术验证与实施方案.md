# UI Editor P0：基于 GrapesJS 的游戏 UI 可视化编辑器技术验证与实施方案

- 项目：fairygui-html-renderer
- 阶段：UI Editor P0
- 优先级：P0
- 技术方案：React + TypeScript + GrapesJS + Vite
- 日期：2026-11-04
- 状态：待执行
- 前置条件：当前 XML → HTML、HTML → FairyGUI XML 转换链路已具备可用基础

---

# 一、项目背景

## 1.1 当前项目目标

fairygui-html-renderer 当前已经实现了 FairyGUI 与 HTML 之间的双向转换基础。

目前的核心链路：

1. FairyGUI XML → HTML：解析现有 FairyGUI 工程，在浏览器中预览 UI。
2. HTML → FairyGUI XML：通过浏览器提取 DOM、Computed Style、资源等信息，生成 FairyGUI 原生 XML。
3. 转换结果能够在真实 FairyGUI 编辑器中打开、编辑和保存。

当前还缺少一个关键环节：

AI 生成 HTML 后，用户无法方便地通过可视化界面调整 UI，需要反复通过聊天要求 AI 修改，再重新生成和转换。

这会产生以下问题：

- 简单的坐标调整也需要调用 AI。
- AI 修改一个元素时，可能影响其他元素。
- 无法直观查看和调整元素的 X/Y/W/H。
- 缺少图层管理和元素选择能力。
- 缺少人工调整与 AI 自动生成之间的协作机制。

因此，需要新增一个独立的 HTML 可视化编辑器。

## 1.2 P0 的核心目标

基于 GrapesJS 实现一个专门服务于游戏 UI 的可视化编辑器。

用户可以：

1. 加载 AI 已生成的 HTML/CSS。
2. 在固定设计尺寸的画布中查看 UI。
3. 点击元素进行选中。
4. 拖动元素调整位置。
5. 拖动控制点调整尺寸。
6. 通过右侧属性面板修改元素属性。
7. 导出修改后的 HTML/CSS。
8. 将导出结果交给现有 Converter 转换成 FairyGUI XML。

核心流程：

AI 生成 HTML → 导入编辑器 → 人工调整 → 导出 HTML → FairyGUI Converter → FairyGUI XML。

## 1.3 本阶段明确不做

P0 不是完整的 Figma 或 FairyGUI 编辑器。

暂不实现：

- 从零拖拽创建 UI。
- 完整组件素材库。
- 多人协作。
- 云端项目管理。
- AI 自动修改节点。
- AI 视觉标注。
- 复杂动画编辑。
- 完整响应式布局编辑。
- FairyGUI XML 直接编辑。
- 直接修改现有 FairyGUI 工程。
- 完整的资源管理系统。

这些能力留给 P1、P2。

---

# 二、技术选型

## 2.1 编辑器核心

选择 GrapesJS。

仓库：[https://github.com/GrapesJS/grapesjs](https://github.com/GrapesJS/grapesjs)

官方文档：[https://grapesjs.com/docs/](https://grapesjs.com/docs/)

选择原因：

- 支持 HTML/CSS 导入。
- 提供可视化编辑画布。
- 提供 DOM 组件树。
- 支持元素选择。
- 支持拖拽和缩放。
- 支持样式属性编辑。
- 支持图层管理。
- 支持撤销和重做。
- 支持 HTML/CSS 导出。
- 支持 Project JSON 保存和恢复。

不选择 Craft.js 作为 P0 基础。

原因：

Craft.js 更适合开发者自行构建 React 组件编辑器，而当前输入主要是 AI 生成的 HTML/CSS，GrapesJS 更接近现有工作流程。

## 2.2 技术栈


| 模块     | 技术                |
| ------ | ----------------- |
| 编辑器引擎  | GrapesJS          |
| 前端框架   | React             |
| 开发语言   | TypeScript        |
| 构建工具   | Vite              |
| UI 组件  | shadcn/ui 或项目现有组件 |
| 图标     | Lucide            |
| 浏览器自动化 | Playwright        |
| 后端     | 当前 Node.js Server |
| 数据存储   | 本地文件系统            |


注意：

React 负责编辑器外部界面，GrapesJS 负责画布内部 DOM 和编辑状态。

不能让 React 和 GrapesJS 同时控制同一棵 DOM 树。

## 2.3 架构原则

1. 不修改现有 Parser、Renderer、Converter 的核心职责。
2. 新增独立 Editor 前端。
3. 通过 Adapter 对接 GrapesJS 和现有服务。
4. HTML 是设计和编辑源文件。
5. FairyGUI XML 是最终交付格式。
6. 本地文件系统是权威数据源。
7. 编辑器不得直接修改 FairyGUI 原始工程。
8. 不引入 OPFS、IndexedDB 作为工程数据存储。

---

# 三、整体架构

```
AI Generated UI
       |
       v
HTML / CSS / Assets
       |
       v
Editor Import Adapter
       |
       |-- HTML Parser
       |-- Node Identity
       |-- CSS Validation
       |-- Asset Validation
       |
       v
GrapesJS Editor Engine
       |
       |-- Canvas
       |-- Component Manager
       |-- Layer Manager
       |-- Resizer
       |-- Style Manager
       |-- Undo Manager
       |
       v
Editor Export Adapter
       |
       |-- HTML Export
       |-- CSS Export
       |-- Project JSON
       |-- Export Validation
       |
       v
Existing HTML -> FairyGUI Converter
       |
       v
FairyGUI XML + Assets
       |
       v
Validation
```

编辑器只负责 HTML 编辑，不负责 FairyGUI XML 的生成。

---

# 四、编辑器界面需求

## 4.1 整体布局

采用游戏 UI 编辑器风格，深色主题。

整体分为五个区域：

1. 顶部工具栏。
2. 左侧图层面板。
3. 中间设计画布。
4. 右侧属性面板。
5. 底部状态栏。

```
+-------------------------------------------------------+
| Logo | Undo | Redo | Zoom | Preview | Save | Export   |
+----------+----------------------------+---------------+
|          |                            |               |
| Layers   |                            | Properties    |
|          |                            |               |
| Panel    |       Design Canvas        | Transform     |
|  |- BG   |                            | X / Y         |
|  |- Icon |       750 x 1334           | W / H         |
|  |- Text |                            |               |
|  |- Btn  |                            | Appearance    |
|          |                            | Typography    |
|          |                            |               |
+----------+----------------------------+---------------+
| Selected Node | Position | Zoom | Saved / Unsaved     |
+-------------------------------------------------------+
```

## 4.2 顶部工具栏

P0 必须支持：


| 功能         | 说明          |
| ---------- | ----------- |
| 返回         | 返回工作台或项目入口  |
| Undo       | 撤销          |
| Redo       | 重做          |
| Zoom In    | 放大画布        |
| Zoom Out   | 缩小画布        |
| Fit Canvas | 适应窗口        |
| Preview    | 切换预览模式      |
| Save       | 保存编辑状态      |
| Export     | 导出 HTML/CSS |


不实现复杂的快捷键管理系统，但应支持常用快捷键：

- Ctrl+Z：撤销。
- Ctrl+Shift+Z：重做。
- Ctrl+S：保存。

## 4.3 左侧图层面板

展示当前 HTML 的 DOM 层级。

例如：

```
InventoryPanel
  Background
  Header
    Title
    CloseButton
  Content
    ItemIcon
    ItemName
    ItemDescription
  Footer
    ConfirmButton
```

P0 功能：

- 显示节点层级。
- 点击图层选中画布元素。
- 点击画布元素同步选中图层。
- 展开和收起父节点。
- 显示节点名称和类型。
- 显示当前选中状态。

节点名称优先使用：

1. data-fgui-node-name。
2. HTML id。
3. class。
4. 标签名 + 节点序号。

暂不实现：

- 图层拖拽排序。
- 隐藏图层。
- 锁定图层。
- 图层分组。
- 图层批量操作。

注意：图层面板需要展示真实 DOM 层级，不能为了界面显示而随意改变 DOM 结构。

## 4.4 中间设计画布

这是 P0 最重要的模块。

### 固定画布

支持配置：

```
interface GameCanvasConfig {
  width: number;
  height: number;
  backgroundColor?: string;
  zoom?: number;
}
```

默认测试尺寸：

```
{
  "width": 750,
  "height": 1334,
  "backgroundColor": "#808080"
}
```

要求：

- 画布保持固定设计尺寸。
- 不随浏览器窗口改变设计坐标。
- 浏览器窗口只影响画布显示缩放。
- 画布居中显示。
- 支持缩放。
- 不允许缩放影响最终导出坐标。

### 元素选中

支持：

- 鼠标点击元素选中。
- 选中元素显示边框。
- 显示控制点。
- 显示元素名称。
- 点击空白区域取消选中。
- 选中父子节点时能够正确区分。

### 元素拖动

支持：

- 鼠标拖动改变 X/Y。
- 显示当前位置。
- 保持元素宽高。
- 拖动过程中实时预览。
- 拖动结束后保存修改。

第一版使用绝对定位模式。

禁止无意中改变父级 Flex/Grid 布局。

### 元素缩放

支持：

- 左上、右上、左下、右下控制点。
- 调整元素宽度。
- 调整元素高度。
- 实时更新画布。
- 不改变其他节点的位置。

保持原始图片的拉伸规则，除非用户主动修改。

---

# 五、右侧属性面板

## 5.1 Transform

必须实现：


| 属性       | 类型     | 说明   |
| -------- | ------ | ---- |
| X        | number | 水平坐标 |
| Y        | number | 垂直坐标 |
| Width    | number | 宽度   |
| Height   | number | 高度   |
| Rotation | number | 旋转角度 |


要求：

- 支持直接输入数值。
- 支持上下调整。
- 输入后实时更新画布。
- 拖动后同步更新数值。
- 坐标使用设计画布坐标。

## 5.2 Appearance

P0 实现：


| 属性               | 类型     |
| ---------------- | ------ |
| Opacity          | 0～1    |
| Background Color | 颜色     |
| Border Color     | 颜色     |
| Border Width     | number |
| Border Radius    | number |


## 5.3 Typography

仅对文本节点显示。

P0 实现：


| 属性           | 类型     |
| ------------ | ------ |
| Text Content | string |
| Font Size    | number |
| Font Color   | color  |
| Font Weight  | select |
| Text Align   | select |
| Line Height  | number |


文本修改不能破坏原始 DOM 层级。

## 5.4 Image

仅对图片节点显示。

P0 实现：

- 显示当前图片路径。
- 显示图片预览。
- 修改图片引用路径。
- 检查图片是否存在。

第一版可以通过输入资源路径替换图片，不强制实现完整资源管理器。

---

# 六、HTML 导入机制

## 6.1 输入数据

编辑器接收：

```
interface EditorInput {
  html: string;
  css: string;
  assets: string[];
  canvas: GameCanvasConfig;
  sourceRevision: string;
}
```

HTML、CSS 和 Assets 来自 AI 生成结果。

## 6.2 导入处理

导入前执行：

1. 检查 HTML 文件。
2. 检查 CSS 文件。
3. 检查资源路径。
4. 检查画布尺寸。
5. 解析 DOM 层级。
6. 识别不支持的 CSS。
7. 为节点补充稳定 ID。
8. 生成导入诊断报告。

## 6.3 节点身份

新增稳定节点 ID：

```
<div data-fgui-node-id="node_001">
  <img data-fgui-node-id="node_002" />
  <div data-fgui-node-id="node_003">
    稀有装备
  </div>
</div>
```

要求：

- 节点 ID 在编辑会话内唯一。
- 不允许因为拖动或修改属性而改变 ID。
- 不允许每次保存重新生成全部 ID。
- 原始 HTML 有稳定 ID 时优先保留。
- 新节点 ID 生成规则由 Adapter 统一管理。

节点 ID 是编辑器与后续 FairyGUI Converter 的协作基础。

## 6.4 CSS 兼容

重点检查：

- position。
- left / top。
- width / height。
- transform。
- opacity。
- z-index。
- background。
- border。
- font。
- overflow。
- flex。
- grid。

第一版不要求支持全部 CSS，但必须：

- 明确记录不支持的属性。
- 不允许静默丢弃关键样式。
- 不允许导入失败后仍显示为成功。
- 导入诊断报告可以在界面查看。

特别注意：Flex/Grid 如果存在，不能直接把父子节点都转换成独立绝对定位，否则可能改变原有布局。

P0 的第一批样本以固定定位 HTML 为主。

---

# 七、HTML 导出机制

## 7.1 导出数据

```
interface EditorOutput {
  html: string;
  css: string;
  projectData: object;
  assets: string[];
  sourceRevision: string;
  nodeIdentityVersion: number;
}
```

## 7.2 导出要求

- 保留原始 DOM 层级。
- 保留节点 ID。
- 保留资源引用。
- 保留 CSS 规则。
- 导出修改后的 X/Y/W/H。
- 导出文本、颜色、字体修改。
- 不允许出现重复节点 ID。
- 不允许出现资源路径丢失。

## 7.3 Project JSON

保存 GrapesJS 原生项目状态。

用于：

- 重新打开编辑器。
- 恢复图层状态。
- 恢复组件模型。
- 恢复编辑器内容。

不能只依赖 Project JSON，也不能只依赖 HTML。

HTML/CSS 是转换器输入，Project JSON 是编辑器恢复数据。

两者需要保持一致。

## 7.4 无操作导入导出验证

必须单独测试：

原始 HTML → GrapesJS 导入 → 不做任何修改 → 导出 HTML/CSS。

然后比较：

- 节点数量。
- 节点层级。
- 节点 ID。
- 资源引用。
- 计算后坐标。
- 计算后尺寸。
- 截图视觉差异。

如果 GrapesJS 导入导出会导致关键 CSS 丢失或布局变化，需要先解决，不能直接进入后续功能开发。

---

# 八、编辑器与现有 Converter 集成

P0 必须完成一次真实转换闭环。

```
AI Generated HTML
       |
       v
Editor Import
       |
       v
Visual Editing
       |
       v
Editor Export
       |
       v
Existing Converter
       |
       v
FairyGUI XML
       |
       v
Renderer
       |
       v
Browser Preview
```

要求：

1. 编辑器导出的 HTML/CSS 能直接交给现有 Converter。
2. 不新增第二套 FairyGUI XML Writer。
3. 不重复实现 Extractor。
4. 不改变现有 Style Mapper 的核心规则。
5. 转换结果写入测试工程的隔离包。
6. 不允许覆盖现有 FairyGUI 包。
7. 转换失败不能破坏原工程。

## 8.1 转换报告

复用现有转换报告机制，记录：

- 输入 HTML。
- 节点总数。
- 成功转换节点数。
- 不支持节点数。
- 资源清单。
- 转换错误。
- 验证结果。

---

# 九、本地文件与项目管理

P0 暂时不做完整项目管理系统。

使用本地文件系统。

建议目录：

```
workspace/
  task-001/
    source/
      index.html
      styles.css
      assets/

    editor/
      project.json
      index.html
      styles.css

    output/
      fairygui/
      validation-report.json
```

规则：

1. source 保存 AI 原始产物，不允许编辑器覆盖。
2. editor 保存编辑后的产物。
3. project.json 保存编辑器状态。
4. output 保存 FairyGUI 转换结果。
5. 保存采用临时文件 + 原子替换。
6. 通过 sourceRevision 检测源文件冲突。
7. 编辑器默认只操作当前会话目录。

不引入 OPFS、IndexedDB。

---

# 十、HTTP 接口

沿用当前 Node Server，新增编辑器接口。


| 方法   | 路由                           | 用途              |
| ---- | ---------------------------- | --------------- |
| POST | /api/editor/session          | 创建编辑会话          |
| GET  | /api/editor/session/         | 获取编辑会话          |
| PUT  | /api/editor/session/         | 保存编辑结果          |
| GET  | /api/editor/session//project | 获取 Project JSON |
| POST | /api/editor/session//export  | 导出 HTML/CSS     |
| POST | /api/editor/session//convert | 调用现有 Converter  |


接口要求：

- 限制会话目录访问范围。
- 拒绝目录穿越。
- 限制文件大小。
- 校验资源路径。
- 保存时检查 sourceRevision。
- 错误返回结构化信息。
- 不允许通过接口任意修改 FairyGUI 工程文件。

接口的具体 Request/Response Schema 在实施前根据当前 Server 架构确定，不得凭空新增与现有系统冲突的接口。

---

# 十一、测试方案

## 11.1 测试样本

至少准备以下五个样本：


| 样本       | 测试内容           |
| -------- | -------------- |
| Sample A | 简单游戏弹窗         |
| Sample B | 多层嵌套布局         |
| Sample C | 图片 + 文本        |
| Sample D | 透明度、旋转、边框      |
| Sample E | Flex/Grid 混合布局 |


Sample E 主要用于兼容性探查，不作为第一版全部支持的强制要求。

## 11.2 功能测试


| 编号  | 测试内容         | 预期结果     |
| --- | ------------ | -------- |
| T01 | 加载 HTML      | 正确显示     |
| T02 | 点击节点         | 正确选中     |
| T03 | 图层点击         | 画布同步选中   |
| T04 | 拖动节点         | X/Y 正确改变 |
| T05 | 缩放节点         | W/H 正确改变 |
| T06 | 修改 X/Y       | 画布实时更新   |
| T07 | 修改颜色         | 样式正确更新   |
| T08 | 修改文字         | 内容正确更新   |
| T09 | 替换图片         | 图片正确显示   |
| T10 | Undo         | 恢复修改前状态  |
| T11 | Redo         | 恢复修改后状态  |
| T12 | 保存项目         | 文件正确落盘   |
| T13 | 重新加载         | 状态正确恢复   |
| T14 | 导出 HTML      | 文件完整     |
| T15 | Converter 转换 | 成功生成 XML |
| T16 | Renderer 回读  | 正常显示     |
| T17 | FairyGUI 打开  | 可以编辑和保存  |


## 11.3 视觉回归测试

使用 Playwright：

1. 加载原始 HTML。
2. 截取原始截图。
3. 导入 GrapesJS。
4. 不操作直接导出。
5. 使用独立浏览器加载导出 HTML。
6. 截取导出截图。
7. 对比视觉差异。

同时检查：

- DOM 节点数量。
- 节点层级。
- 节点坐标。
- 节点尺寸。
- 图片资源。
- CSS Computed Style。

视觉差异不能只依赖单一像素指标，文本抗锯齿等差异需要单独处理。

## 11.4 P0 验收指标


| 指标        | 验收要求            |
| --------- | --------------- |
| HTML 导入   | 5 个测试样本完成导入诊断   |
| 元素选中      | 100% 正确选中测试节点   |
| 拖动        | 坐标误差 ≤ 1px      |
| 缩放        | 尺寸误差 ≤ 1px      |
| 属性修改      | X/Y/W/H、颜色、文字正确 |
| Undo/Redo | 基本操作正确恢复        |
| 保存恢复      | 内容和节点 ID 不丢失    |
| 资源引用      | 无丢失、无错误路径       |
| 无操作导出     | 不产生不可接受的视觉差异    |
| Converter | 至少一套完整样本成功转换    |
| FairyGUI  | 转换结果可打开、编辑、保存   |
| 安全性       | 不修改原始工程和原始 HTML |


特别说明：

如果 GrapesJS 导入导出导致视觉变化，必须记录具体原因和影响范围。不能通过放宽验收标准掩盖导入兼容性问题。

---

# 十二、P0 开发任务拆分

建议按以下顺序执行。

## Task 1：项目结构和 GrapesJS POC

- 新建 editor 前端工程。
- 安装 GrapesJS。
- React 集成 GrapesJS。
- 创建最简单的编辑器界面。
- 加载一份固定 HTML/CSS。
- 显示画布。

验收：可以正常启动并显示 HTML。

## Task 2：固定画布和坐标系统

- 实现固定设计尺寸。
- 实现缩放显示。
- 实现画布居中。
- 验证设计坐标。
- 验证浏览器缩放不影响设计坐标。

验收：750×1334 画布正确显示。

## Task 3：元素选择和拖动

- 点击选中元素。
- 显示选择边框。
- 实现绝对定位拖动。
- 实现尺寸调整。
- 验证坐标和尺寸。

验收：元素可以独立移动和缩放。

## Task 4：图层和属性面板

- 实现左侧图层树。
- 图层与画布双向同步。
- 实现 X/Y/W/H。
- 实现颜色和透明度。
- 实现文本修改。

验收：不依赖代码即可完成常见 UI 调整。

## Task 5：导入和导出 Adapter

- 实现 HTML 导入。
- 实现 CSS 导入。
- 实现节点身份。
- 实现 Project JSON 保存。
- 实现 HTML/CSS 导出。
- 实现导入诊断。

验收：编辑器可以保存并恢复项目，导出内容完整。

## Task 6：Converter 集成

- 调用现有 Converter。
- 生成 FairyGUI XML。
- 使用 Renderer 回读。
- 使用真实 FairyGUI 编辑器打开。
- 记录转换报告。

验收：完成完整的编辑到 FairyGUI 交付闭环。

## Task 7：自动化验收

- 编写 Playwright 测试。
- 增加无操作导入导出视觉回归。
- 增加节点坐标检查。
- 增加资源路径检查。
- 输出 P0 验收报告。

验收：测试可以重复执行。

---

# 十三、P0 与后续阶段的边界


| 功能          | P0  | P1  | P2  |
| ----------- | --- | --- | --- |
| HTML 导入     | 是   | 是   | 是   |
| 固定设计画布      | 是   | 是   | 是   |
| 元素拖动        | 是   | 是   | 是   |
| 元素缩放        | 是   | 是   | 是   |
| 属性面板        | 基础  | 完整  | 完整  |
| 图层树         | 基础  | 完整  | 完整  |
| 资源管理        | 基础  | 完整  | 完整  |
| 对齐吸附        | 否   | 是   | 是   |
| 多选          | 否   | 是   | 是   |
| AI 节点理解     | 否   | 否   | 是   |
| AI 局部修改     | 否   | 否   | 是   |
| 视觉标注        | 否   | 否   | 是   |
| 自动截图比较      | 基础  | 完整  | 完整  |
| FairyGUI 转换 | 是   | 是   | 是   |


---

# 十四、最终验收场景

使用一套真实的 AI 生成游戏 UI。

例如：道具详情弹窗。

初始 HTML 包含：

- 背景面板。
- 道具图片。
- 道具名称。
- 品质文本。
- 道具描述。
- 数量。
- 确认按钮。

用户完成以下操作：

1. 打开 HTML 编辑器。
2. 加载道具详情弹窗。
3. 选择道具图片。
4. 将图片向右移动 20px。
5. 修改道具名称颜色。
6. 将确认按钮宽度增加 30px。
7. 保存项目。
8. 重新打开编辑器，检查状态。
9. 导出 HTML/CSS。
10. 调用现有 Converter。
11. 生成 FairyGUI XML。
12. 使用 Renderer 回读。
13. 使用真实 FairyGUI 编辑器打开生成的 UI。
14. 独立修改图片、文本、按钮并保存。

必须确保：

- 修改前后的节点身份保持稳定。
- 未修改元素不发生意外变化。
- 不产生重复资源 ID。
- 资源引用完整。
- 原始 HTML 不被覆盖。
- 原始 FairyGUI 工程不被破坏。

只有这条链路完整通过，才能认为 UI Editor P0 成功。

---

# 十五、实施原则

1. 先 POC，再扩展功能。
2. 先验证 HTML 导入导出，再开发完整界面。
3. 不为了追求编辑器功能完整而重写现有转换器。
4. 不引入第二套 FairyGUI XML Writer。
5. 不引入浏览器数据库存储工程。
6. 不允许编辑器修改原始 HTML。
7. 所有转换结果先进入隔离目录。
8. 通过真实 FairyGUI 编辑器验证，不以 HTML 预览成功代替最终验收。
9. 每个 Task 都要有自动化测试和执行报告。
10. 如果 GrapesJS 的导入保真度不满足要求，先评估修复成本，再决定是否继续，不允许无条件扩大开发投入。

# 十六、P0 完成后的下一步

P0 完成后，再进入两个方向：

**P1：完善人工 UI 编辑能力**

- 图层管理。
- 多选。
- 对齐和吸附。
- 完整属性面板。
- 图片资源管理。
- 更完整的视觉回归。

**P2：AI 与编辑器联动**

借鉴 W&amp;B OpenUI 的交互理念：

[https://github.com/wandb/openui](https://github.com/wandb/openui)

实现：

- AI 获取当前画布结构。
- AI 理解用户选中的元素。
- 用户通过自然语言要求修改指定元素。
- AI 修改指定 DOM 节点。
- 画布实时更新。
- 人工确认后转换为 FairyGUI。

最终目标：

自然语言需求 + 参考图 → AI 生成 HTML → 人工可视化编辑 → AI 局部修改 → FairyGUI XML。

这才是 fairygui-html-renderer 最终要服务的 AI 游戏 UI 工作台。