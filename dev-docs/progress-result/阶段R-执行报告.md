# 阶段 R 执行报告：多工程切换 P0-A（服务端）+ P0-B（前端工作台）

- 完成时间：2026-11-09
- 依据：dev-docs/design/2026-11-09-多工程切换设计方案.md（v2 修订版，评审通过后的第一期）
- 状态：验收通过（P0-A：server-check 12 项断言 + 七套件全绿；P0-B：浏览器实测切换/URL 权威/双标签独立/资源链路 + MCP 视觉确认双工程完整渲染）

## 交付内容

| 项 | 实现 | 文件 |
|---|---|---|
| 工程注册与工厂 | ProjectEntry/Workspace 两种形态：multi（projects/ 注册目录，白名单 Map 查找，未知名 404 不静默回退）+ single（单工程根现状形态，宽容映射唯一工程，零行为变化）；discoverProjects 枚举（含 assets 的直接子目录即工程，名称即白名单）；defaultProjectRoot 供 MCP 等单工程消费方 | src/server/projects.ts（新增） |
| 服务端路由参数化 | AppOptions 增 projectsDir（优先于 rootDir）；route 签名收 Workspace，每请求白名单解析 ?project= -> root/assetsRoot；project 参数不参与任何路径拼接（只做 Map 查找，防注入） | src/server/server.ts |
| 资源链路携带工程（P0-1） | /view 的 toAssetUrl 生成资源 URL 带 ?project=（encodeURIComponent）；/api/assets 在 route 顶部统一解析后天然按所选工程 | src/server/server.ts |
| 工程清单路由 | GET /api/projects -> { mode, defaultProject, projects: [{name, packageCount}] }（先于工程解析，无需工程上下文）；/api/project 响应增 project 字段 | src/server/server.ts |
| 启动发现 | projects/ 注册目录存在且含工程 -> 多工程模式；否则回退单工程（FGUI_PROJECT_ROOT 环境变量或默认 CC-Default，现状不变）；MCP 默认根同样跟随发现（defaultProjectRoot） | src/server/main.ts、src/mcp/main.ts |
| 目录迁移 | CC-Default-orig -> projects/CC-Default（官方 Demo 21 包）；CC-Default（麻将内容）-> projects/fgui_game_42324（15 包）；.gitignore 收敛为 projects/ | 仓库根（纯目录移动） |
| 双工程夹具 | tests/fixtures/workspace2/projects/{a,b}：对称结构（同包名/组件/图片路径），仅内容不同（PROJ_a/PROJ_b 文本、PNG-DATA-PROJ-a/b 图片）——专测资源隔离 | tests/fixtures/workspace2/ |
| 测试断言 | server-check 新增 12 项（见验收结果） | tests/server-check.ts |

## 验收结果（12 项全绿）

| 断言 | 验证点 |
|---|---|
| 单工程模式兼容 | single 模式 + 唯一工程（fixtures 现状零变化） |
| 注册清单 | multi + a/b 两工程 + defaultProject=a |
| 切换不重启 | 同进程 ?project=a/?project=b 各自正确响应带工程名 |
| 缺省回退默认工程 | 不带 project -> a |
| 未知工程 404 | ?project=c -> 404（不静默回退） |
| 跨工程路径拒绝 | ?project=a&component=../b/... -> 404（safeResolve 以所选工程 assetsRoot 为界） |
| 资源隔离（P0-1 核心） | 同名图片路径各归各工程（a 内容 / b 内容） |
| 渲染资源 URL 带 project（P0-1） | /view 产物内资源地址 ?project=a / ?project=b 且文本各归各工程 |
| scene-diff 带工程 | 同工程内同组件 diff 为空 |
| xml-write 带工程 | POST query 上的 project；b 工程原样合并写出含 PROJ_b 不含 PROJ_a |
| 并发隔离 | a/b/a 三请求 Promise.all 交错，各自正确互不污染 |
| （套件回归） | tsc + render 105 + server/convert/mcp/ui-asset/scene-diff/xml-writer 全绿（6 套件路径跟进 projects/CC-Default） |

## 真实双工程实测（服务重启后）

- /api/projects：multi + CC-Default 21 包 + fgui_game_42324 15 包（默认 CC-Default）
- 官方 Demo 渲染：/view?project=CC-Default&component=Basics/Demo_Button.xml -> 200，九宫格等资源 URL 均带 ?project=CC-Default
- 麻将渲染：/view?project=fgui_game_42324&component=boxkawuxing_mah_game/BoxKaWuXingMahMainView.xml -> 200，atlas 图片 URL 均带 ?project=fgui_game_42324
- 未知工程 404；缺省回退 CC-Default

## 经验沉淀（本次新坑）

- tsx watch 只监听代码文件，数据目录 mv 不触发重启：编辑代码期间 watch 已自动重启并持"当时"的单工程快照；目录迁移后旧进程持过期 root 继续服务（/api/projects 返回构建时快照）。**数据目录大迁移后必须显式重启服务进程并核对 /api/projects**（杀 watch 父进程 + 子进程整树，仅杀子会被父重启）。

## P0-B：前端工作台多工程（2026-11-09 追加验收）

| 项 | 实现 | 文件 |
|---|---|---|
| 统一请求入口 | edApi(url, opts)：全部数据请求（含 POST）过这一处，自动携带 ?project= 与当前工程 abort signal；模块 fetch 直调清零（仅 edApi 实现与 /api/projects 工程发现两处合法直调） | src/editor/editor-state.ts |
| 工程上下文与切换生命周期 | ED.project/projectGen/abort；edSetProject：中止在途 -> 代际递增 -> 清空全部状态（含 docId，旧 iframe 在途消息失配丢弃）-> URL replaceState + localStorage -> notify；URL 为权威（三级解析：URL ?project= > localStorage > 服务端默认） | src/editor/editor-state.ts |
| 顶栏工程切换器 | select 下拉（/api/projects 驱动，选项带包数）；单工程模式自动隐藏；顶栏工程名随切换刷新（订阅 ED.project 变化查包数表） | src/editor/editor-page.ts |
| 工程树缓存挂工程 | project-tree 检测 ED.project 变化即清空包列表/组件缓存/搜索态重拉；慢回包按代际丢弃（abort 逃逸双保险） | src/editor/project-tree.ts |
| iframe 与 rel-bar | iframe src 带 project（工程上下文传给 /view）；loadRel 走 edApi + docRef 身份校验（慢回包不覆盖新文档）；顺带删除 loadRel 内无操作死代码 | src/editor/canvas-host.ts |

### 浏览器实测（browser-selftest skill 流程）

| 验证点 | 结果 |
|---|---|
| 顶栏切换器 | 两工程选项（CC-Default 21 包 / fgui_game_42324 15 包），下拉切换生效 |
| 切换生命周期 | URL 更新 + 包树重载 + 画布清空，无旧工程数据残留 |
| URL 权威 | /?project=fgui_game_42324 直达麻将工程；刷新保持 |
| 打开组件链路 | 官方 Demo BagWin 101 节点 / 麻将主视图 97 节点；iframe src 与图片/border-image URL 均带 ?project=（P0-1 闭环） |
| 双标签独立 | 标签 A 麻将（97 节点保持）/ 标签 B 官方 Demo（21 包），互不干扰 |
| MCP 视觉确认 | 双工程截图逐项断言通过（dev-examples/p0b-shots/01、02） |
| 修复 bug | 初测抓到顶栏工程名不随切换刷新（edSetProject 未刷 tb-project）——改为订阅 ED.project 变化查 PROJECTS 包数表 |

## 后续（待实施）

- P0-C：前端多工程回归断言固化（当前为浏览器手动实测）+ 手动验证指南已补前端章节
- P1：MCP list_projects + 9 工具 project 参数 + 每调用独立 ProjectContext
