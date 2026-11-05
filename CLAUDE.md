# CLAUDE.md

本仓库（fairygui-html-renderer）的开发过程文档管理规范。

## 开发文档目录：`dev-docs/`

`dev-docs/` 是本仓库专门保存开发过程文档的目录（纳入 git 管理，过程文档与代码同仓库追溯）。

> 边界：仓库根 `docs/` 是**读者向**文档（随项目分发、README 链接引用）；
> `dev-docs/` 只服务开发过程，两者不混放。

### 规则

1. **所有开发过程文档必须放在 `dev-docs/` 目录下**，不要散落在仓库根目录或其他位置。
2. **新建文档时先判断类型**，放入对应类型的子文件夹；子文件夹不存在时按需创建。
3. 子文件夹按文档类型分类，命名使用小写英文和连字符（kebab-case），例如：

   | 类型 | 子文件夹 | 说明 |
   |------|----------|------|
   | 设计方案 | `dev-docs/design/` | 架构设计、技术方案、接口设计 |
   | 会议记录 | `dev-docs/meeting/` | 会议纪要、讨论记录 |
   | 问题排查 | `dev-docs/troubleshooting/` | Bug 分析、故障排查、复盘 |
   | 调研笔记 | `dev-docs/research/` | 技术调研、选型对比、学习笔记 |
   | 任务计划 | `dev-docs/planning/` | 任务拆解、进度计划、里程碑 |
   | 执行进度 | `dev-docs/progress/` | 阶段性进度总结、里程碑状态 |
   | 执行报告 | `dev-docs/progress-result/` | 阶段完整执行报告、验收结果（区别于 progress 的持续进度表） |
   | 使用指南 | `dev-docs/guides/` | 操作手册、环境搭建、工作流说明 |
   | 经验沉淀 | `dev-docs/experience/` | 踩坑记录、问题解决方案、经验教训 |

4. 若现有分类不适用，可新建类型子文件夹，但需保持命名风格一致，并在本文件表格中补充登记。
5. 文档统一使用 Markdown 格式，文件名应能体现内容，例如 `2026-10-03-workflow-design.md`。
6. **自动归类，无需询问**：发现 `dev-docs/` 根目录下有未归类的文档时，直接按内容判断类型并移动到对应子文件夹，不要向用户确认。

## 进度文件夹：`dev-docs/progress/` 与报告文件夹：`dev-docs/progress-result/`

`dev-docs/progress/` 专门用于记录项目阶段性执行进度；`dev-docs/progress-result/` 专门用于沉淀阶段完整执行报告（区别于 progress 的持续进度表：progress 是滚动维护的状态，progress-result 是一次成稿的阶段报告）。

### 规则

1. **阶段完成必须记录**：每完成一个阶段/里程碑，必须更新进度文档，不得只提交代码不更新进度。
2. **双文件夹同步更新**：每次执行完一个里程碑，除更新 `dev-docs/progress/` 外，还必须同步更新 `dev-docs/progress-result/` 中的对应阶段执行报告（新建或追加）。两个文件夹缺一不可。
3. **每阶段独立报告文件**：阶段报告按阶段命名（`P0-执行报告.md`、`P1-执行报告.md`、`P2-执行报告.md`...），**新阶段内容必须写入新文件，禁止向其他阶段的报告文件追加**（含 `cat >>`）。已完成阶段的报告视为只读；报告内引用其他阶段（如"P2 方向"）允许，但不承载其他阶段的执行记录。
4. **进度文档要求维护到位**：更新 `dev-docs/progress/执行进度.md`（持续维护的总进度文档）中的里程碑状态表，并视情况为该阶段新建独立进度/验收文档；记录内容包括：完成时间、交付清单、commit 记录、经验索引、遗留问题。
5. **进行中也要反映**：阶段启动、中途重要节点（如架构决策、验收通过/失败）都应同步到进度文档，保证文档与仓库实际状态一致。
6. 新的进度文档放入本文件夹，命名体现阶段或日期，例如 `P0-验收报告.md`、`2026-10-03-执行进度.md`。

## 经验文件夹：`dev-docs/experience/`

`dev-docs/experience/` 专门用于沉淀开发过程中遇到的坑点和解决方案。

### 规则

1. **遇到坑必须记录**：开发中碰到坑（如环境问题、依赖冲突、隐蔽 Bug、反直觉行为等）并解决后，将问题现象、原因分析、解决步骤记录到 `dev-docs/experience/` 下，一篇文档记录一个问题。
2. **解决问题前先查经验**：每次遇到问题时，必须先到 `dev-docs/experience/` 下查找是否之前碰到过类似问题：
   - 若有记录，优先按已有经验尝试解决，解决后视情况补充更新原记录（如新的解决方法、适用版本变化）。
   - 若无记录，解决完成后再将完整过程沉淀为新文档。
3. 经验文档建议结构：**问题现象 → 排查过程 → 根因 → 解决方案 → 预防/注意事项**，文件名体现问题关键词，例如 `node-version-conflict.md`。

## XML 解析参考规范

遇到 FairyGUI XML 格式问题（属性语义、gear 系列 values/pages 编码、扩展组件子元素、未知类型等）时，
**第一步先查 `thirdparties/OpenFairy-SDK-uGUI` 源码**（`Assets/Plugins/OpenFairy/` 下 Editor 与 Runtime），
确认它是否已有同类解析实现，直接参考其行为后再写代码，不要靠猜测。

- 依据：gearSize/gearXY/gearColor 的 values 编码（`|` 分页、逗号分分量、`-` 用 default）即从该 SDK 源码验证破解；
  早期靠猜曾误判 gearColor「编码不匹配」。
- 注意：该仓库无 LICENSE，只参考解析行为与格式知识，禁止复制源码。

## 渲染器实现硬性规则（踩坑沉淀，详见 dev-docs/experience/）

以下规则来自真实踩坑（阶段 K 补丁系列），实现与排查时自动遵守：

1. **双引号 HTML 属性内禁用双引号**：拼进 `style="..."`、`src="..."` 等双引号属性内的任何值，内嵌引号必须换形（CSS url 用单引号 `url('...')`、文本走 esc()）。新写内联样式拼接时先审一遍内容里有没有 `"`。（坑：九宫格 url("...") 截断 style 属性自上线起一直失效，见 experience/2026-11-04-九宫格url引号截断style属性.md）
2. **字符串断言不能证明 HTML 合法**：render-check 的 includes/regex 断言只能证明"内容生成过"，不能证明"浏览器解析得了"。border-image/clip-path/filter/mask 等复杂值的链路必须配浏览器 computed style 实测收尾；纯字符串断言绿灯的视觉链路不可信。
3. **ui:// 解析三形态齐全**：loader/gearIcon/任何解析 `ui://` 的地方，目标资源必须覆盖三种：image / component / movieclip（kind "other" + type "movieclip"，渲染 jta 首帧）。新增解析分支时三者逐项核对。
4. **划掉独立分支要连带核对属性集**：判定某扩展组件（GButton/GLabel 等）"已展开不需要独立分支"时，必须逐属性 grep 真实样本词表，确认每个属性（title/icon/selected...）都有注入链路；机制复用不等于属性全覆盖。
5. **多渲染分支对称核对**：同一节点类型的多个渲染分支（img 路径 vs div+border-image 路径）新增分支时，对照旧分支核对公共兑底逻辑（尺寸兑底/对齐/染色）是否要复制。
6. **改代码不生效先查进程**：排查"改了代码页面没变化"，第一步确认 server 进程启动时间是否早于代码提交（netstat 查端口 PID）。区分"数据不生效"（XML 层 fresh 重解析覆盖）与"代码不生效"（必须重启进程）；长驻服务一律 tsx watch。
7. **九宫格 border-image 必须加 fill 关键字**：CSS `border-image-slice` 默认不画中心（四边四角之外的中间镂空），FairyGUI scale9grid 是画中心的（中心拉伸）。漏 `fill` 会镂空露出 stage 底色，看起来像"文本有灰背景"。（坑见 experience/2026-11-04-九宫格border-image漏fill中心镂空.md）
8. **渲染器节点文件一类型一文件**：`src/renderer/nodes/` 每种节点类型/扩展类型对应一个独立渲染文件（image/text/graph/jta/... 节点类型 + button/combobox/progress/slider 扩展分支），**禁止多类型共用同一渲染文件**。同族共用逻辑抽私有/导出函数（如 renderButtonLike/renderProgressLike），各类型文件做薄包装。依据：用户明确要求文件结构与概念一一对应（便于定位与扩展）。（节点类型 vs 扩展类型的挂载点区分见规则 4 相关经验）

## 看图与视觉验证（MCP 工具链）

**模型不能直接看截图/图片**（browser_take_screenshot 返回的图像会被模型忽略）。需要看图验证渲染效果时，用 zai MCP 图像分析工具链：

1. **看渲染效果**：`browser_save_artifact`（或 `browser_take_screenshot`）截图存文件 -> `zai_mcp_server_analyze_image` 传入截图路径 + 具体提问（如"按钮中心是否有贴图填充，还是镂空露出灰底"）。提问要具体到要验证的视觉断言，不要问泛泛的"图里有什么"。
2. **两图对比**（修复前后/预期 vs 实际）：`zai_mcp_server_ui_diff_check` 传两张截图。
3. **截图前先刷新**：tsx watch 重启 server 后，浏览器页面还持有旧 HTML，必须先 reload 再截图，否则分析的是旧页面（踩过：fill 修复后首张截图仍显示镂空）。
4. 截图默认存 `C:\Users\<user>\.pi\browser-artifacts\`，browser_take_screenshot 的 filePath 只能写 workspace roots 内的路径。

## 示例目录：`dev-examples/` —— 开发期沙盒

1. 开发中的脚本试验、联调配置与临时输出一律放 `dev-examples/`（一主题一子目录，kebab-case），
   **不对读者负责**，内容可随时失效或删除，不进 README 宣传、不被其他文档引用。
2. 运行产物一律 gitignore 不提交；详细约定见 `dev-examples/README.md`。
3. 毕业路径：`dev-examples/` 里验证通过 → 合入正式代码 → 必要时在 `docs/` 落地读者向文档 → 删除沙盒里对应目录。
