# 阶段 O 执行报告：S6 路径守卫加固 + S1 三栏可视化工作台

- 完成时间：2026-11-05
- 来源：egret 项目对比分析（dev-docs/research/2026-11-05-egret项目对比与同步分析.md）S6 + S1 两项
- 状态：验收通过（render 105 项 + 四套件全绿 + 浏览器全链路实测 + MCP 视觉确认）

## 交付内容

| 项 | 实现 | 文件 |
|---|---|---|
| S6 路径守卫加固 | safeResolve 补符号链接 realpath 复核（root 与目标都取 realpath，防穿越 + 规避盘符大小写差异）；不存在返回 null（404 通道） | src/server/server.ts |
| S1 选择器协议 | component-selector 升级：docid 驱动 postMessage 双向协议（点击 -> NODE_SELECTED；父发 SELECT_NODE/DESELECT_NODE；找不到 -> NODE_NOT_FOUND；CANVAS_READY）；独立打开行为不变 | src/selection/component-selector.ts |
| S1 editor 五模块 | editor-state（ED Store + fetchSeq 防过期 + key 索引）/ project-tree（包->组件懒加载 + 客户端搜索 + 定位）/ scene-tree（按需展开 + 展开/未支持徽章 + 反向定位）/ canvas-host（iframe + 缩放/Fit + postMessage 校验链）/ inspector（七组属性，空组隐藏，DOM API 安全） | src/editor/*.ts（新增目录） |
| S1 页面与路由 | 三栏页面（拖拽分隔条 + localStorage 布局记忆 + 顶栏缩放控件）；`/` 换挂 editorPageHtml，删除旧 index-html.ts | src/editor/editor-page.ts、src/server/server.ts |
| S1 view editor 模式 | renderHtml 增 editor 选项（bare 无信息条但保留选择器脚本）；/view 按 docid 参数切换 | src/renderer/html-renderer.ts、src/server/server.ts |

## 适配差异（egret -> fairygui）

| egret 数据源 | fairygui 对应 |
|---|---|
| /api/scene?file=（单级类索引） | /api/scene?component=（包内相对路径） |
| doc.rootKey + doc.stage | doc.nodes + doc.size（scene-json 无根合成，树直接列顶层节点） |
| /api/exml 全量列表 | /api/project + /api/packages/{name}/components 两级懒加载 |
| ui-assets 三模式搜索 | 客户端过滤（补拉全部包后合并；17+ 包规模可接受） |
| rel-bar 组件关系条 | 本批未移植（依赖 S3 组件图谱，后续批次） |
| native.attributes / bounds / asset / simulated | attrs / xy+size / src+url / unsupported（字段按 Scene JSON 实际形状映射） |

## 验收结果（浏览器实测）

| 标准 | 结果 |
|---|---|
| 打开组件：画布渲染 + Scene Tree 节点 + 顶栏尺寸 | 通过（Bag/BagButton 2 节点；Demo_Button 120 节点 21 展开徽章） |
| 树选 -> 画布高亮 + Inspector | 通过（image n1 高亮，分组 Basic/Transform/Image/Advanced） |
| 画布点 -> 树定位 + Inspector 同步 | 通过（jta n2：父窗口选中、Scene Tree 选中行、Inspector 标题一致） |
| 搜索 -> 平铺命中 -> 打开 | 通过（"Demo_Button" 命中 Basics/Demo_Button.xml） |
| Fit 缩放 | 通过（1136x570 组件适配可视区 10%） |
| MCP 视觉确认三栏布局 | 通过（三栏 + 顶栏 + 树徽章 + 画布渲染） |
| 既有断言不退化 | 通过（render 105 项 + server/convert/mcp 套件） |

## 遗留

- rel-bar 组件关系条：依赖 S3（组件图谱）后续批次接入
- 旧 index-html.ts 已删除（工作台替代；原三级导航不再保留）
