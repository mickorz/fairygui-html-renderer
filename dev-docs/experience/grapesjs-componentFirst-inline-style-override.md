# GrapesJS 缩放编辑写错目标：类规则被内联 style 覆盖（componentFirst）

## 问题现象

Task 3 用例 4（Resizer 缩放）拖右下角控制点后视觉无变化：
- img 内联 style 保持 `width:183px` 不变；
- computed style 也是 183px；
- 但 `component:resize` 事件触发了 17 次，`updateTarget` 回调跑了 16 次——缩放交互链路本身是通的。

## 排查过程

1. 最初怀疑 handle 无交互（Resizer 没创建 handler）——检查 Resizer 实例发现 handlers 八方向键齐全，`isHandler` 命中，pointerdown 正确到达 handle 元素，`setPointerCapture` 正常；
2. 插桩 `updateTarget` 与组件 `addStyle`：updateTarget 跑 16 次、组件 addStyle 零次——样式写入目标不是组件；
3. dump CSS Composer 规则：发现 `.hero` 规则被创建且写入了 `width:223px;height:178px`（缩放值正确！）；
4. 对比 img 内联 `width:183px`——**内联优先级高于类规则，覆盖了缩放结果**，视觉无变化。

## 根因

`style_manager/index.ts` `getModelToStyle`（v0.23 源码 488 行）的写入目标选择逻辑：

- `useClasses = !smConf.componentFirst || options.useClasses`——`selectorManager.componentFirst` 默认 **false**；
- 组件有 class（如 `.hero`）且 useClasses 为真 → 样式写入组件类规则；
- 而我们的导入链路 `avoidInlineStyle: false` 保留原始内联 style → 内联优先级高于类规则 → 缩放写入的类规则被内联覆盖。

即：**componentFirst=false（默认）与 avoidInlineStyle=false（保真必需）组合下，所有经 StyleManager 的编辑（缩放、StyleManager 面板）都会被原始内联样式覆盖，视觉静默失效。**

## 解决方案

`editor-instance.ts` 配置：

```ts
selectorManager: { componentFirst: true, appendTo: "" },
```

componentFirst=true 后 `getModelToStyle` 返回组件本身，缩放直接写组件内联 style，与内联保真哲学一致。

验证：缩放后 img 内联 style 变为 `width:223px;height:178px`（增量与拖动位移一致），不产生类规则；check:drag 16/16、check:grapes 门禁无回归。

## 踩坑注意：配置键名与重复键

1. 编辑器配置键名是 `selectorManager`（不是 `selectors`）——源码 `editor/config/config.ts:506`；
2. editor-instance.ts 原有 `selectorManager: { appendTo: "" }`（Task 0 的「管理器不挂载 DOM」配置），新增配置若写成第二个同键对象字面量会被后者整体覆盖（JS 对象重复键后者胜）——必须合并成一个。

## 关联发现：image 组件默认 resizable 无方向键

`ComponentImage.ts:21` 默认 `resizable: { ratioDefault: 1 }`——不含 tl/tc/tr/cl/cr/bl/bc/br 方向键，Resizer 源码 `opts[hdl]` 为 falsy 时不创建对应 handler（`Resizer.ts:376`），导致图片选中后看似有框但拖不动任何控制点。修复（editor-instance.ts）：

```ts
editor.DomComponents.addType("image", {
  model: { defaults: { resizable: { tl: true, tc: true, tr: true, cl: true, cr: true, bl: true, bc: true, br: true } } },
});
```

## 预防/注意事项

- 涉及「编辑写入哪个对象」的问题，先读 `getModelToStyle` 确认写入目标（组件内联 vs 类规则 vs #id 规则），三个开关（avoidInlineStyle / forceClass / componentFirst）共同决定，改一个要复查另外两个的组合效果；
- 为组件类型扩展默认值用 `DomComponents.addType`，不改 thirdparties 源码。
