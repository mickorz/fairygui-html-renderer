# 阶段 B 执行报告：只读工作区服务

- 完成时间：2026-10-29
- 状态：验收通过（自动化断言 15/15 + pi-browser-use 浏览器自动化自测 + 用户确认）

## 交付内容（对照阶段 B 执行计划）

| 任务 | 实现 |
|---|---|
| B1 数据模型收敛 | instancePath/stableKey 计算从 html-renderer 迁移到 buildScene 构建时填充（ParsedNode 新增字段）；渲染器只读预计算值——「Scene Tree 是核心数据模型」落地，查 JSON 即查画布 |
| B2 Scene Tree JSON | src/scene/scene-json.ts：toSceneJson 输出 type/id/name/path/key/xy/size/attrs/gears/unsupported + component 元信息与 children 拍平；支持相对路径化 |
| B3 服务 | src/server/server.ts：Node 原生 http（零新依赖）。统一守卫 safeResolve（解码后 resolve，必须仍落在工程根内，根自身不放行）；非 GET 一律 405（只读边界）。路由：/api/project、/api/packages/:pkg/components、/api/scene、/api/assets/*、/view、/ |
| B4 前端 | src/server/index-html.ts 内嵌零构建页面：三级导航（包 → 组件 → iframe 画布），选择器在 iframe 内直接可用 |
| B5 验收测试 | tests/server-check.ts：自起服务 → fetch 断言 → close，无测试框架 |

## 验收结果（对照确认过的验收方案）

- 安全组 5 项：相对穿越 / URL 编码穿越 / 绝对路径注入 / 资源穿越全部 4xx；不存在组件 404
- 枚举 2 项：包列表含全部包；Bag 组件清单带唯一键与 scene 参数
- 一致性 2 项：scene JSON 节点数 == 渲染 DOM data-fgui-key 数（查 JSON = 查画布）
- 刷新生效 3 项：改 fixture XML → 同请求返回新内容 → 还原恢复（审查 #2 回归保护落地）
- 双模式 1 项：服务 /view 与 CLI renderHtml 的节点 key 序列完全一致（CC-Default BagWin 45 节点）
- 既有 `npm run check` 27 项不退化；tsc strict 通过

## 过程修复

- fixtures 重组为 `tests/fixtures/workspace/assets/cycle`（匹配服务 root/assets 布局），render-check 路径同步
- 双模式测试初版误用 workspace 服务实例（无 Bag 包）——改为为 CC-Default 单独起服务实例再比对
- countNodes 泛型收窄导致 tsc 报错——放宽 children 结构类型

## 使用方式

```bash
npm run serve                # 默认 http://localhost:7788/，工程根 ./CC-Default
FGUI_PROJECT_ROOT=<路径> PORT=<端口> npm run serve   # 自定义
npm run check:server         # 服务端 15 项断言
```

## 遗留问题

1. listPackages 枚举每次全量解析 17 个 package.xml（目录少可接受；阶段 D 若成瓶颈加 mtime 缓存）
2. 前端组件列表基于 package.xml 注册条目，未注册组件（如临时试验 XML）不显示——需要时加「扫描目录」开关
3. 搜索高亮是阶段 C（下一阶段），当前前端尚无搜索框
