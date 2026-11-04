# GrapesJS dragMode absolute 拖动后 _cmpDrag 残留吞掉下一次 click（合成事件场景）

## 问题现象

Task 3 e2e：完成一次拖动（dragMode: "absolute"）后，紧接着点击另一个元素无法选中（`component:selected` 不触发，Resizer 控制点不出现）；再点一次才恢复。Undo 后同样复现。

## 排查过程

1. 插桩 `component:selected/deselected` 与 iframe 内 mousedown/mouseup/click 监听：mousedown、mouseup 都到达目标元素，**但 click 事件不触发**；
2. 读源码 `SelectComponent.ts:308`：`onClick` 开头有 `if (em.get('_cmpDrag')) { em.set('_cmpDrag'); return; }`——存在一个「吞 click」标志；
3. 读 `commands/index.ts:132`：`getOnComponentDragEnd` 中 `(opts.altMode || data.cancelled) && em.set('_cmpDrag', 1)`——**dragMode 为 absolute/translate（altMode）时每次拖动结束必设 `_cmpDrag=1`**；
4. 设计意图：真实浏览器在拖动 mouseup 后会紧随触发一次 trailing click，这次 click 被 `_cmpDrag` 吞掉（防止拖动结束瞬间的 click 误改选中）；
5. Playwright 合成拖动中 mouseup 被 Dragger 的 `preventDefault` 处理，**trailing click 不触发** → `_cmpDrag` 残留 → 下一次真实 click 被吞。

## 根因

合成事件流缺少真实浏览器拖动后必发的 trailing click，`_cmpDrag` 标志无人清除，残留吞掉下一次 click。

## 解决方案

e2e 每次合成拖动结束后显式清除标志，模拟真实浏览器语义：

```ts
const clearCmpDrag = () =>
  page.evaluate(() => {
    const ed = (window as any).__editorInstance;
    ed.getModel ? ed.getModel().set("_cmpDrag") : ed.set("_cmpDrag");
    return null;
  });
```

注意：`window.__editorInstance` 暴露的是 Editor 门面对象，`set` 在 EditorModel 上（`ed.getModel().set(...)`）。

## 预防/注意事项

- 所有 Playwright 驱动的 GrapesJS 拖动用例（drag/resize/排序），mouse.up 之后都要 `clearCmpDrag()`；
- 同类思路：合成事件与真实事件流差异（trailing click、native dragstart、hover 时序）都可能让 GrapesJS 依赖浏览器时序的状态机残留标志，e2e 排查「点击无效」类问题先查编辑器残留状态（em.get 各标志位）再查事件绑定；
- 该残留只影响合成事件流，真实浏览器不受影响（真实 trailing click 会清标志），不是产品缺陷，e2e 里修即可。
