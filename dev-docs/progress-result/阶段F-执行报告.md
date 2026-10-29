# 阶段 F 执行报告：HTML → FairyGUI XML 转换 POC

- 完成时间：2026-10-29
- 状态：自动化部分验收通过（check:convert 11/11；视觉对比 99-100% 匹配）；**FairyGUI 编辑器打开/编辑/保存验证待用户执行**（F 验收门槛的人工环节）

## 前置探查结论（F0）

`.fairy` 工程文件为**纯 XML 且极简**（仅 `<projectDescription id type version/>`），不含包列表——包由 `assets/` 目录扫描发现。**写入目标工程 = 新建 `assets/<包名>/` 目录即可，无需修改 .fairy**。registry/ 为编辑器元数据（JSON），POC 未生成，留待编辑器打开验证确认是否自动生成。

## 交付内容（对照 F1-F6）

| 任务 | 实现 |
|---|---|
| F1 最小样本 | tests/fixtures/convert/hello.html：400x300 画布，absolute 图片 + 两段文本（约定 #canvas 为画布根） |
| F2 浏览器提取 | chrome_devtools evaluate_script：getBoundingClientRect（相对画布根，已排除 body margin）+ computed style → 提取 JSON（fixture 固化 tests/fixtures/convert/hello.extract.json） |
| F3 映射 | div/img → component/image/text；rgb()→#hex；fontSize 透传；坐标即设计坐标 |
| F4 XML Writer | src/convert/transform.ts：package.xml（component+image 登记，PNG IHDR 读原始尺寸）、组件 XML（原版格式）、图片复制；id 生成器（FairyGUI 风格 5 位） |
| F5 隔离写入 | 输出到 CC-Default/assets/Converted/ 隔离新包；**已存在目录直接抛错拒绝覆盖**（断言覆盖） |
| F6 回读验证 | 渲染器回读（新增 `/view?bare=1` 纯净模式：无信息栏/脚本/内边距）+ Chrome headless 截图 + zai ui_diff_check 对比 |

## 验收结果

- 转换-回读像素级一致：**99-100% 匹配，无可辨认差异**（图片位置/尺寸/透明通道、两段文字内容/颜色/字号/位置、画布尺寸背景全部对齐）
- check:convert 11 项：rgb→hex、PNG IHDR、package.xml 登记、节点坐标样式、图片复制、拒绝覆盖既有包、实际产物回读一致性
- 既有 56 项断言不退化；tsc strict 通过

## 过程修正

- 视觉对比初报「全局坐标偏移 13-40px」——核实为**截图基准差**（原 HTML 画布原点在 body margin (8,8)，渲染器 padding (16,16)），bare 模式对齐后差异归零。转换坐标本身正确（提取时已相对画布根）
- 样本 HTML 背景色一度为对齐对比而改动，已还原（样本保持真实性；对比只看画布区域）

## F 验收门槛状态（v3）

| 门槛 | 状态 |
|---|---|
| 转换产物写入目标工程隔离新包 | ✅ |
| 渲染器回读出 HTML 且与原 HTML 像素级一致 | ✅（99-100%） |
| 资源引用完整、无重复 ID、顺序坐标正确 | ✅（check:convert 断言） |
| 未支持样式明确列出 | ✅（映射范围声明见下） |
| **FairyGUI 编辑器打开、选中、编辑文本/图片、保存后再次打开** | ⏳ 待用户执行 |

映射范围声明（本 POC 明确支持）：absolute 定位的 img 与带文本元素；图片 png；颜色 rgb()/hex。明确不支持：Flex/Grid（浏览器计算位置可导出，本样本未覆盖）、嵌套容器→子组件、交互/动画、非 PNG 图片。

## 使用方式

```bash
# 1. 浏览器打开目标 HTML，执行提取脚本（skill/会话内完成），保存 JSON
# 2. 转换并写入目标工程
npx tsx src/convert/transform.ts tests/fixtures/convert/hello.extract.json tests/fixtures/convert CC-Default/assets/Converted Hello.xml
# 3. 渲染回读验证
npm run serve  # http://localhost:7788/view?component=Converted/Hello.xml&bare=1
npm run check:convert
```

## 遗留问题

1. 编辑器人工验证未完成前，F 不应宣布通过（v3 明确：不能把可行性视作既定事实）
2. 提取脚本目前依赖 AI 会话内 evaluate_script；G 阶段若需无人值守，再封装 Playwright 提取
3. registry/ 元数据未生成——若编辑器打开报缺失，补研究其 JSON 格式
