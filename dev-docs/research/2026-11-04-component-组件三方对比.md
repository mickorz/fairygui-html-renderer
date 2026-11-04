# Component 组件三方对比调研：FairyGUI 原版 / OpenFairy UGUI / 当前 HTML 渲染器

- 日期：2026-11-04
- 调研方式：实际阅读三方源码（FairyGUI 原版 C#、OpenFairy UGUI 转换 SDK、本仓库 HTML 渲染器），本文所有结论均来自源码行为核对，未参考外部文章。
- 声明：OpenFairy-SDK-uGUI 仓库无 LICENSE，本文只描述行为与格式知识，引用源码不超过 3 行，禁止复制。

---

## 1. 组件定位

GComponent 是 FairyGUI 所有组件的容器基座：窗口（Window）、根舞台（GRoot）、列表（GList）、按钮（GButton）等全部继承或内嵌 GComponent。**一个 FairyGUI 组件本身就是一棵完整场景**——组件 XML 的 displayList 里有 image/text/graph/component/group 等混排节点，组件对内是场景树的容器，对外是一个可被上层引用的普通显示对象。

围绕"容器"这一角色，GComponent 集成了六套机制：

1. **子节点管理**：AddChild/RemoveChild/SetChildIndex、sortingOrder 插序、childrenRenderOrder 三种绘制顺序。
2. **Controller**：组件内嵌的页面状态机，驱动子对象按页显隐/变位/变色，组件间可跨级联动。
3. **Transition**：组件内嵌的动效序列（本文只列出，不展开）。
4. **ScrollPane**：overflow=scroll 时自动挂载的滚动容器。
5. **Relations**：子对象与父/兄弟的布局关联，父或目标变化时自动重排。
6. **GGroup**：高级组，把散落在 displayList 里的一批子对象按逻辑分组，提供组级排列/拉伸/显隐。

对静态渲染器来说，"组件即场景"意味着：只要能递归展开组件引用并还原每层子对象的绝对定位，就能渲染出完整画面；Controller/ScrollPane/Relations/GGroup 决定的是"动态形态"与"响应式布局"，静态场景下可以先用默认页/缺省布局近似。

## 2. FairyGUI 原版实现要点（GComponent.cs / Controller.cs / ScrollPane.cs / GGroup.cs / Relations.cs）

### 2.1 场景树与构造流程（ConstructFromResource）

GComponent 的显示结构是双层 Container：`rootContainer`（根，gOwner 指回自己）与 `container`（内容层）。默认两者合一；当 margin 非零、overflow=hidden 或 scroll 时才创建独立内容层——裁剪矩形挂在 rootContainer，内容层在里面偏移/滚动。

组件从二进制包数据构造（`ConstructFromResource`），顺序严格：

1. 读 sourceWidth/sourceHeight（设计尺寸）、min/max 约束、pivot、margin。
2. 读 overflow：Scroll 走 `SetupScroll`（建内容层 + ScrollPane），Hidden 走 `SetupOverflow`（建内容层 + rootContainer.clipRect），Visible 不处理。
3. 段 1：逐个创建 Controller 并 Setup。
4. 段 2：逐个读子项类型/src/pkg → `UIObjectFactory.NewObject` → 嵌套组件递归 `ConstructFromResource` → `Setup_BeforeAdd` → 挂入 `_children`。
5. 段 3：读自身 relations，再逐子项读 relations 与 `Setup_AfterAdd`。
6. 段 4：opaque（整块命中，缺省 true）、mask（指定子节点作遮罩）、hitTest（像素/形状命中区）、进出舞台音效。
7. 段 5：逐个创建 Transition。
8. 最后 `ApplyAllControllers()`（把初始页广播给全部子对象）+ `BuildNativeDisplayList()`。

### 2.2 子节点管理与绘制顺序

- `_children` 列表顺序即逻辑序；sortingOrder 非 0 的子项按 `GetInsertPosForSortingChild` 插到第一个 order 更大的兄弟之前（order==0 保持插入序在前），维护 `_sortingChildCount` 保证排序块总在尾部。
- childrenRenderOrder 三种：Ascent（正序）、Descent（倒序）、Arch（apexIndex 前正序后倒序，用于牌堆式叠放）。切换或增删子项时重建原生显示列表。
- 可见性是链式的：`internalVisible`（自身 + 祖先）不满足时 displayObject 不加入 container。
- 查找族 API：GetChild(name)/GetChildByPath("a.b")/GetChildInGroup(group, name)/GetChildById。

### 2.3 Controller 机制（Controller.cs）

Controller 是纯数据对象（非显示对象），核心字段：页 id 表 `_pageIds`、页名表 `_pageNames`、`_selectedIndex`、动效表 `_actions`（ChangePageAction / PlayTransitionAction）。

- `selectedIndex` setter：记 previousIndex → `parent.ApplyController(this)` → 遍历 `_children` 调 `HandleControllerChanged`（各对象内部按自己挂的 gear 查表响应）→ `RunActions()`（跨组件/动效联动）→ 派发 onChanged。
- 初始页：Setup 里按 homePageIndex 决定（缺省第一页；版本 2 起支持 specific 页 id、branch、variable 三种指定方式）。
- `AdjustRadioGroupDepth`：单选按钮组切换时调整兄弟层级，保证选中项置顶。
- 子对象通过 gear（gearDisplay/gearXY/gearSize/gearColor/gearLook/gearText 等十余种）订阅控制器：gear 记录 controller 名 + pages + 每页值，`HandleControllerChanged` 时按当前页取值应用（可选 tween 缓动）。

### 2.4 ScrollPane（ScrollPane.cs）

overflow=scroll 的组件由 `SetupScroll` 自动创建 ScrollPane：

- 结构：`_maskContainer` 挂在 rootContainer 下，原内容层 `_container` 移入其中被裁剪；滚动条（GScrollBar，vt/hz）、header/footer（下拉刷新/上拉加载）按配置创建。
- 交互：接管 rootContainer 的 mouseWheel/touchBegin/Move/End，实现拖拽（`draggingPane` 全局单例）、惯性 tween（TweenUpdate）、回弹（bounceback）、页面模式（pageMode，翻页吸附 + pageController 联动）、item 吸附（GetSnappingPositionWithDir）。
- 内容尺寸：组件 `UpdateBounds` 计算子项包围盒 → `SetBounds` → `scrollPane.SetContentSize`；owner 尺寸变化走 `OnOwnerSizeChanged` 重设视口。
- 定位 API：percX/percY、SetPosition（ani 可缓动）、ScrollToView、IsChildInView/GetFirstChildInView。

### 2.5 Relations 布局关联（Relations.cs / RelationItem.cs）

- 每个显示对象持有一个 Relations，内含 RelationItem 列表；每个 item 一个 target（父对象或兄弟对象）+ 一组 RelationDef（type + percent）。
- 27 种 RelationType：Left_Left … Bottom_Bottom（九宫对齐）、Center/Middle（居中）、Width/Height（尺寸跟随）、Size（=Width+Height）、LeftExt/RightExt/TopExt/BottomExt（拉伸外沿）。
- 触发路径：target 位置变化（ApplyOnXYChanged：按对齐点差值平移 owner）、target 尺寸变化（ApplyOnSizeChanged：percent 模式按 `target 新尺寸/旧尺寸` 比例缩放 owner 偏移，非 percent 模式按差值平移；尺寸规则直接改 owner 宽高）、owner 自身尺寸变化（ApplyOnSelfSizeChanged：右/下对齐点补偿自身位置）。
- item 内部记录 `_targetData` 基准（target 加入时的位置/尺寸），所有计算基于基准差值。
- 二进制 Setup 里 targetIndex==-1 表示对父组件的关联。

### 2.6 GGroup（GGroup.cs）

高级组是"逻辑分组"而非容器：组成员仍留在组件的 displayList 里，通过 `child.group` 反向指回组对象（组自己扫 parent._children 找成员，不持有列表）。

- layout：None / Horizontal / Vertical + lineGap/columnGap；excludeInvisibles 排除隐藏成员；mainGridIndex/mainGridMinSize 指定"主格子"吃剩余空间。
- 求值时机：SetBoundsChangedFlag → 帧首（UpdateContext.OnBegin）EnsureBoundsCorrect。
- HandleLayout：沿主轴把成员 `xMin/yMin` 依次排列累加 gap（零尺寸成员定位但不占位）。
- UpdateBounds：成员包围盒 → 组自身 SetXY/SetSize（组矩形跟随成员）。
- ResizeChildren：组尺寸变化时按 `_sizePercentInGroup` 百分比拉伸成员（remainPercent 递减分配），主格子优先吃超额空间。
- 组 alpha/显隐向成员传播（HandleAlphaChanged/HandleVisibleChanged 遍历成员）。

### 2.7 GRoot 与 XML component 格式

GRoot 继承 GComponent，是 UI 根：单例 inst、窗口栈管理（ShowWindow/HideWindow）、模态层（GGraph 画半透明矩形 + Size 关联贴根）、popup/toast 队列。

组件 XML（编辑器导出的 .xml，与二进制同构）顶层属性：`size`、`extention`（Button/Label/ComboBox 等扩展类型）、`overflow`（visible/hidden/scroll）、`mask`、`scroll`、`scrollBar`、`scrollBarRes`、`pageController`、`scrollBarFlags`、`margin`、`scrollBarMargin`、`clipSoftness`、`opaque`；子元素：`controller`（name/pages 以 id,name 交替列出/selected（仅编辑器状态）/homePageType/homePage/action）、`relation`（target 空串=对父）、`displayList`（image/movieclip(.jta)/graph/loader/group/text/richtext/inputtext/component/list 混排，公共属性 id/name/xy/size/visible/group 等，子元素 gearXxx 与扩展设置）、`transition`。component 子项可带实例级 `controller`（页 id）覆盖嵌套组件的默认页（GComponent.Setup_AfterAdd 读取）。

## 3. OpenFairy UGUI 版实现要点（Runtime/ + Editor/Migrate.cs）

总体策略：**烘焙优先**。Migrate 在编辑器期把组件 XML 一次性展开为 uGUI prefab 层级，运行时零 XML 解析；动态机制（Controller/gear/Relation/ScrollPane）映射到 uGUI 原生设施。

### 3.1 层级映射：Transform 层级替代 _children

Runtime 的 `Component.cs` 极薄：继承 UIBehaviour，只有 `controllerChildren` 数组（直接子组件引用，用于 Awake 时递归 InitializeControllers）和三个控制器分页虚方法（GetControllerPage/SetControllerPage/IsControllerChanging，由生成代码 switch 分发）。没有 `_children` 动态列表——子节点管理直接就是 uGUI Transform 层级；sortingOrder 由 `SortObject`（存 order）+ `Depth`（复刻 GetInsertPosForSortingChild 的兄弟序算法）还原；childrenRenderOrder 未实现（无 Arch 语义）。

组件根节点：RectTransform 锚点(0,1)/pivot(0,1)/sizeDelta = 设计尺寸；opaque 缺省时加一张全 rect 透明 Image 作射线命中面（复刻 Container.opaque 整块可命中）。

### 3.2 Controller<T>：结构体泛型 + 生成 enum

- `Controller<T>` 是 `[Serializable]` struct（T : struct, Enum），不进 Transform；每个自定义组件生成一个嵌套 enum（页名→成员）+ `Controller<enum>` 字段 + GetControllerPage/SetControllerPage switch 代码。不生成单独 Controller 类。
- gears/actions 是 `[SerializeReference]` 数组，Migrate 期用反射按页类型实例化 Gear<X> 填入。
- 页切换：page setter → Apply（先应用非 display gears 起 tween 并加 displayLock，再应用 GearDisplay——复刻原版"旧页飞出再消失"的 display lock 时序，BeginUpdate/EndUpdate 批量提交可见性）→ RunActions（ChangePageAction 跨组件换页 / PlayTransitionAction 播动效）→ onChanged。
- 编辑态 Bake(initialPage) 直接置位不动画；运行时才走 tween。
- **初始页**：`ControllerData.Selected = element.InitialPage`——homePageType=specific 按 homePage 页 id 解析，否则第一页；XML 的 selected 属性视为编辑器选中状态不参与运行时（与原版发布语义一致）。
- 实例级页覆盖：component 子项的 controller 属性由 ConfigureInstanceControllers 烘焙进嵌套组件实例。
- 特殊机制：按钮关联控制器（tab/radio 组）烘 relatedOwner/relatedPage + GearButton 反向同步；ScrollPane pageMode 烘 GearScrollPage 联动；列表 selectionController 烘选择联动。

### 3.3 ScrollPane：继承原生 ScrollRect

- `ScrollPane : ScrollRect`；Migrate 的 BuildScrollView 烘出结构：viewport（RectMask2D + 透明 Image，含 clipSoftness 软裁）+ content（锚 0,1）+ 根上挂 ScrollPane + 实例化滚动条 prefab（AuthoredScrollbar 绑定，barMargin 定位）+ autoHideBars（Display=Auto 时 CanvasGroup 淡入淡出）。
- 轴向自动：_autoAxes 时内容不超视口的轴不开；拖拽/惯性/回弹/滚轮复用 ScrollRect 原生实现（回弹/惯性常数为近似值，非逐帧复刻）；滚轮位置直接钳制不越界回弹（SetPosition 内 Clamp，复刻原版滚轮语义）。
- 内容尺寸：RefreshContent 扫 content 子项包围盒（Relation.TopLeft）或走 ListSource 行布局；pageMode 用原生 pageController 联动 + SetPage；snapToItem 在 LateUpdate 停稳后吸附；loop 模式（循环列表）用 MovementType.Unrestricted。
- 组件级 overflow=hidden 不建 ScrollPane，只挂 RectMask2D。

### 3.4 Relations：双通道（原生锚点 + Relation 组件）

- **通道一（零开销）**：RelationAnchorBaker 把"对父且仿射"的约束（单 target=""、每轴至多一个对齐规则 + 可选一个尺寸规则）直接烘成 uGUI 原生 anchorMin/anchorMax，父容器变尺寸时由 uGUI 布局自动响应。
- **通道二（通用）**：其余关联烘成 `Relation` 组件（Runtime/Relation.cs）：bindings 数组（target RectTransform + rules + pivotAsAnchor + nativeAnchors 标记）；Record 记录基线（owner/reference/各 target 几何）；运行时 PostLateUpdate 循环 Sync（仅非原生锚点绑定），ReadTarget 变化时调 `RelationMath.Apply`（复刻原版 ApplyOnXYChanged/ApplyOnSizeChanged：percent 比例、Ext 侧拉伸、OwnPoint/TargetPoint 全词表）；owner 自身尺寸变化走 `OnRectTransformDimensionsChange` → RelationMath.SelfSize。
- 坐标换算：RelationMath 全程用 FairyGUI 语义 top-left 坐标系，Relation 组件只负责与 RectTransform 空间互转（pivot 处理）。
- 嵌套组件实例：RestoreBaseline + BeginConstruction/EndConstruction 维护"构造期基线"——嵌套实例在父文档里的伸展按源尺寸计算，不把增量重复加到已烘焙基线（对应原版 underConstruct 语义）。

### 3.5 GGroup：GroupLayout

`GroupLayout : LayoutGroup`（Runtime/GroupLayout.cs）：单轴 flow（axis + spacing + excludeInvisibles），成员在 Migrate 期已 ReparentPreservingRect 进组 GameObject。语义还原点：零尺寸成员定位但不消耗尺寸与 gap；交叉轴不排成员，只把组矩形对齐到成员包围盒（复刻组包围盒跟随成员、且更新组边界不移动成员的父子坐标）。原版的百分比拉伸成员（ResizeChildren/mainGridIndex）未复刻——烘焙期已按设计稿绝对定位。

### 3.6 Editor 场景展开流程（Migrate.CreatePrefab）

1. 建 root + AddComponent(生成的组件类型)。
2. 建 controllers 表（名字/页 enum/页 id/初始页）。
3. 逐 displayList 项 CreateChild：image→Image、text→TextField/TMP、graph→Graph、loader→Loader、list→BuildList、**component→PrefabUtility.InstantiatePrefab 嵌套 prefab**（随后 RestoreBaseline/BeginConstruction 处理嵌套关系）。
4. group 节点：把组成员 reparent 进组节点 + GroupLayoutBuilder.Configure。
5. mask：建独立 Mask carrier（MaskShape+MaskSource+Mask），全部兄弟内容移入 carrier——蒙版是内容的兄弟而非父，避免污染变换链。
6. overflow=scroll：BuildScrollView + 内容 reparent 进 content。
7. BuildRelations（组件自身 relation 对 root，子项 relation 对父/兄弟）。
8. BuildTransitions / BuildActions / pageController / 按钮关联控制器 / BuildController（gears 注入 + Bake 初始页）。
9. opaque 命中面 → 扩展组件特化（Button/ProgressBar/Slider/Label/ScrollBar）→ 公开字段绑定（子 GameObject/RectTransform 填进生成类的 m_ 字段）→ controllerChildren → Initialize → 本地化 → ForceRebuildLayout → CompleteRelations（落盘最终基线）→ 软裁材质烘焙。

## 4. 当前 HTML 渲染器实现要点

架构：纯静态字符串输出，无运行时。`parseComponent`（fast-xml-parser preserveOrder 保序）→ `buildScene` 递归展开 → `renderHtml` 输出。组件渲染为 `<div class="fgui-node">`（position:absolute），子节点相对容器 absolute 定位，z 序 = XML displayList 顺序（DOM 文档序）。

### 4.1 buildScene 展开机制（src/scene/scene-builder.ts）

- **构建/缓存分离**：`getComponent` 缓存 parseComponent 结果（视为不可变原始数据）；`buildScene` 每次生成全新节点副本（逐节点浅拷贝 + attrs/gears 拷贝），循环标记等状态只写副本不污染缓存。
- **递归展开**：component 节点的 src 经 `pkg.byId` 解析为子组件 XML 文件，递归 `buildScene` 后挂到 `node.childComp = { file, comp }`。
- **循环引用防护**：fullStack（当前展开链上的文件集合）检测到重复文件时不再展开，标 `unsupported = "循环引用: xxx"` 并回调上报。
- **路径与键**：为每个节点填充 `instancePath`（可读定位链，如 `BagWin.frame.n2`）与 `stableKey`（唯一实例键 `pkgId.resId.nodeId~childPkg.childRes...`），渲染器 data 属性与 Scene Tree JSON 共用，保证"查 JSON = 查画布"。
- **list 展开**：按 defaultItem（ui:// URL，经全局索引解析）为每个 item 静态生成场景副本（上限 200 个），item 尺寸取 defaultItem 组件设计尺寸。
- **扩展属性注入**：`<Label title="Bag"/>` 等 extensionProps 把 title 递归写入子场景中 name="title" 的 text 节点（对应原版 GLabel/GButton 的 title 子对象约定）。

### 4.2 component 渲染（src/renderer/nodes/component-node.ts）

- 输出 `<div data-fgui-id/name/src/type/path/key ...>`；childComp 缺失时输出红虚线框占位 + unsupported 上报。
- **尺寸缺省取子组件设计尺寸**：节点自身未指定 size 时 `geo.size = child.size`（对齐原版"实例未写尺寸用 sourceWidth/Height"的语义）。
- 递归 `renderChildren(child.comp, ctx, [...stack, file])` 渲染子场景内容进本 div。

### 4.3 Controller / gear 现状（src/parser/component-parser.ts + src/renderer/gear.ts）

- parser 解析组件级 `<controller>`：取 name、pageIds（pages 属性 id,name 交替的偶数位）、**selected（XML selected 属性 ?? 第一页 id）**。
- gear 支持 4 种：display / xy / size / color。`resolveGear` 以 `ctrl.selected` 为"当前页"静态求值：gearDisplay 不含当前页 → `visibility:hidden`；gearXY/gearSize 在 gear 自己的 pages 里找当前页值（"-" 或无匹配回退 default）覆盖几何；gearColor 取页值 color 段覆盖颜色。
- 即：**只渲染 XML 里的默认页快照**，无运行时换页、无 controller action（change_page/play_transition）、无 Transition 动效、无实例级页覆盖（component 子项的 controller/page 属性留在 attrs 里但无消费方）。另外注意初始页语义差异：parser 取 XML `selected` 属性，而原版/OpenFairy 运行时按 homePage 规则（缺省第一页）——若编辑器保存了非默认选中页，渲染结果会与运行时默认形态不一致。
- 尺寸差值联动：gearSize 页值直接替换节点尺寸，未复刻原版 gearSize 的 scales 分量与限制。

### 4.4 未实现清单（逐项核实）

| 功能 | 状态 | 说明 |
|---|---|---|
| overflow=hidden 裁剪 | 未实现 | parser 丢弃组件 overflow 属性；组件 div 无 overflow:hidden，溢出内容可见 |
| ScrollPane 滚动 | 未实现 | 无 viewport/content 结构，overflow=scroll 组件内容直接平铺 |
| relations（节点级/组件级） | 未实现 | parser 完全未解析 `<relation>` |
| group 高级组 | 未实现 | `<group>` 不在 KNOWN_TYPES，渲染为红框占位 + unsupported |
| 组排列/组拉伸/组显隐 | 未实现 | 随 group 一起缺失 |
| controller action / transition | 未实现 | 未解析 |
| 组件 mask / hitTest / opaque | 未实现 | mask 属性丢弃；无命中语义（静态无交互） |
| margin / clipSoftness | 未实现 | 属性丢弃 |
| childrenRenderOrder / sortingOrder | 未实现 | z 序固定为 XML 文档序 |
| 实例级 controller 页覆盖 | 未实现 | component 子项 controller 属性无消费方 |
| gear 其他种类（look/text/icon/ani 等） | 未实现 | 仅 display/xy/size/color 四种 |
| gearSize 缩放分量 | 未实现 | 页值按宽高二元组处理 |

### 4.5 已实现且超出"最小展开"的部分

- 6 种节点渲染器注册表（image/text/graph/component/list/loader），未知类型红框占位 + 页面底部 unsupported 清单。
- ui:// 跨包解析（buildGlobalIndex）+ list 静态展开。
- 循环引用防护 + 解析缓存 + fresh 重解析。
- instancePath/stableKey 溯源 + 点击选择器脚本（选中高亮 + 路径回显）。
- Scene Tree JSON 输出与渲染共用同一棵构建树。
- 染色/九宫格/旋转翻转等 image 层样式（属 image 节点文档范畴，此处不展开）。

## 5. 三方功能对照表

| 功能点 | FairyGUI 原版 | OpenFairy UGUI | 当前 HTML 渲染器 | 差距说明 |
|---|---|---|---|---|
| 组件 = 场景（递归嵌套） | 二进制递归 ConstructFromResource | Migrate 递归嵌套 prefab | buildScene 递归展开 + 循环防护 | 三方均支持 |
| 子节点管理（动态增删/换序） | _children 全套 API | Transform 层级（静态烘焙） | 不适用（无运行时） | HTML 静态场景天然只读 |
| sortingOrder / 绘制顺序 | 三种 childrenRenderOrder + Arch | SortObject + Depth 兄弟序 | 仅 XML 文档序 | HTML 无 sortingOrder；Arch 场景少 |
| Controller 页状态机 | 运行时换页 + action + onChanged | Controller<enum> struct + gears/actions 烘焙 + 页切换事件 | 仅解析 pages/selected，静态取默认页 | HTML 需求为"默认页快照"，已够用但页选择规则不同 |
| 初始页语义 | homePage 规则，缺省第一页 | InitialPage 同原版 | XML selected 属性 ?? 第一页 | 编辑器保存过选中页时 HTML 与运行时不一致 |
| 实例级页覆盖（component 子项 controller） | Setup_AfterAdd 读页 id | ConfigureInstanceControllers 烘焙 | 未实现（属性无消费方） | 嵌套组件带页覆盖时 HTML 形态错误 |
| gear 体系 | 10+ 种 + tween | display/xy/color/look/ani/fontsize/text/icon/button/scrollPage 等 | display/xy/size/color 四种静态 | 其余 gear 在静态图多数无感，look/ani 除外 |
| overflow=hidden 裁剪 | 内容层 + clipRect + 软裁 | RectMask2D + 软裁材质 | 未实现 | 溢出直接可见，明显视觉差异 |
| ScrollPane | 拖拽/惯性/回弹/翻页/吸附/刷新头尾 | ScrollRect 原生 + 烘焙滚动条 + 近似常数 | 未实现 | overflow=scroll 组件内容平铺溢出 |
| Relations | 27 种类型，双向响应 | 双通道：原生锚点 + Relation 组件（全词表） | 未实现 | 容器自适应布局全缺失；固定设计尺寸下多数场景不显 |
| GGroup | 排列/拉伸/包围盒/显隐传播 | GroupLayout（单轴 flow + 组包围盒） | 未实现（占位红框） | 含 group 的组件渲染缺失 |
| 组件 mask | 子节点作遮罩 + reversedMask | 独立 Mask carrier | 未实现 | |
| opaque / hitTest | 整块命中/像素命中 | 透明 Image 射线面 | 不适用（静态无交互） | |
| margin / clipSoftness | 内容层偏移 + 软裁 | 烘入 viewport/材质 | 未实现 | |
| GRoot/窗口/模态 | 窗口栈 + 模态层 + popup | Window/Root + PopupInputModule | 不适用 | 静态渲染器面向单组件画面 |
| Transition | 组件内嵌动效序列 | Transition 组件烘焙 + 运行时播放 | 未实现 | 静态快照不含动效 |

## 6. 结论与可补齐建议

**总体判断**：当前 HTML 渲染器已具备"组件即场景"的核心能力——递归展开、循环防护、默认页 gear 求值、扩展属性注入，对固定设计尺寸的静态快照还原度可用。三方差距集中在"动态/响应式"机制上，其中对静态画面影响最大的是 **overflow 裁剪** 与 **group**，其次是 relations 和实例页覆盖。

可补齐项（按收益排序）：

1. **overflow=hidden 裁剪**：组件级属性现成地留在 XML attrs（parseComponent 目前未把组件级属性存入 ParsedComponent，需要先补组件级属性保存）；实现仅为 component div 加 `overflow:hidden`，成本极低、视觉收益直接。
2. **group 展开渲染**：group 节点本身无视觉，只需在渲染层跳过 `<group>` 占位（视为透明容器）即可让成员正常显示；进一步可做 Horizontal/Vertical 静态排列（改写成员 xy）与 excludeInvisibles。
3. **实例级页覆盖**：解析 component 子项的 `controller`/`page` 属性，在 buildScene 展开子场景时覆写对应 controller 的 selected，gear 求值链路即可自动生效。
4. **初始页规则对齐**：parser 的 controller.selected 改为"homePage 规则（缺省第一页）"，避免编辑器残留选中页导致渲染形态偏移；或在对照运行时截图时先人工核对。
5. **relations 静态子集**：完整 relations 是响应式运行时机制，静态渲染器只需默认形态，不必实现；若未来支持"模拟容器变尺寸"再考虑移植 percent 规则。
6. **ScrollPane**：静态快照可先不做；如需展示滚动区第一屏，可在 component div 上按 overflow=scroll 加 `overflow:hidden`（与第 1 项同一实现），内容超出部分裁掉即可接近首屏观感。

## 7. 参考文件路径清单

FairyGUI 原版 C#（thirdparties/OpenFairy-SDK-uGUI/Assets/FairyGUI/Scripts/UI/）：

- GComponent.cs（容器基座：双层 Container、子节点管理、overflow、构造流程、ApplyController、UpdateBounds）
- Controller.cs（页状态机、homePage、RunActions）
- ScrollPane.cs（滚动容器、拖拽/惯性/翻页、SetContentSize）
- GGroup.cs（高级组排列/拉伸/包围盒）
- Relations.cs / RelationItem.cs（关联系统：27 种类型、percent、基准数据）
- GRoot.cs（根舞台、窗口栈、模态层）
- GObject.cs（HandleControllerChanged、gear 挂载与可见性联动）

OpenFairy UGUI（thirdparties/OpenFairy-SDK-uGUI/Assets/Plugins/OpenFairy/）：

- Runtime/Component.cs（薄容器基座、controllerChildren 递归初始化、控制器分页虚方法）
- Runtime/Controller.cs（Controller<T> struct、Bake/Apply、displayLock 时序）
- Runtime/ControllerAction.cs（ChangePageAction/PlayTransitionAction）
- Runtime/Relation.cs / RelationMath.cs / RelationRule.cs（关系烘焙基线、Sync 循环、top-left 坐标换算、全词表 Apply）
- Runtime/ScrollPane.cs（ScrollRect 派生、自动轴、pageMode、snap、loop）
- Runtime/GroupLayout.cs（组单轴排列 + 组包围盒）
- Runtime/Depth.cs / SortObject.cs（sortingOrder 兄弟序复刻）
- Runtime/Grayed.cs（GearLook 置灰通道）
- Editor/Migrate.cs（CreatePrefab 全流程：CreateChild/SetRect/BuildScrollView/BuildRelations/BuildController/BuildActions）
- Editor/FairyXml.cs（Schema：组件/控制器/显示项 XML 词表）
- Editor/RelationAnchorBaker.cs（对父仿射约束烘原生锚点）

当前 HTML 渲染器（src/）：

- renderer/nodes/component-node.ts（组件 div 渲染、尺寸缺省、递归 renderChildren）
- renderer/html-renderer.ts（渲染入口、节点分发注册表、unsupported 收集）
- renderer/gear.ts（display/xy/size/color 默认页求值）
- renderer/utils.ts（baseStyle/dataAttrs）
- renderer/types.ts（Geo/NodeRenderInput）
- scene/scene-builder.ts（buildScene 递归展开、循环防护、instancePath/stableKey、list 展开、扩展属性注入）
- scene/scene-json.ts（Scene Tree JSON 输出）
- parser/component-parser.ts（component XML 解析：controllers/displayList/gears；未解析 relation/overflow 等的核实依据）
