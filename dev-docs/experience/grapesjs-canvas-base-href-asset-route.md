# GrapesJS 画布 iframe 相对资源解析：base href 两个坑（注入时机 + asset 路由前缀）

## 问题现象

Task 5 会话资源代理：HTML `<img src="assets/pic.png">` 与 CSS `url(assets/pic.png)` 在画布 iframe 内全部 404：
- 图片 404 后被 GrapesJS `onError` 兜底换成占位 SVG（data:image/svg，100x24/100x100），且从现象上看「图片有内容」极易误判为加载成功；
- CSS 背景图 computed style 仍显示解析后的 URL（不报错也不显示），只查 URL 字符串会假通过。

## 排查过程

1. 页面内 fetch `/api/editor/session/<id>/assets/pic.png` 返回 404——发现 base href 指向 `/api/editor/session/<id>/`，而 asset 路由是 `/api/editor/session/:id/asset/*`（**单数 asset 段**）——base 少了一段，所有相对资源都落在 404；
2. 修正 base 为 `.../asset/` 后首屏图片/CSS 都通了，但保存后重开（loadProjectData 恢复路径）图片又变占位图；
3. 打标记探测（loadProjectData 前给 documentElement 设 data-marker）：loadProjectData 后 marker 丢失——**loadProjectData 会重建整个画布 iframe 文档**，先注入的 base 随旧文档丢弃；
4. 组件渲染时文档无 base → img 加载失败 → onError 换占位。需要在「新文档 head 渲染后、body/组件渲染前」注入 base。

## 根因与解决

两处叠加：

1. **base href 必须指向 asset 路由前缀**：`/api/editor/session/<id>/asset/`（不是会话根）；
2. **注入时机**：挂在 `canvas:frame:load:head` 事件（FrameView.ts:296，head 渲染完成、renderBody 之前触发），保证 loadProjectData 重建的每个新文档在组件渲染前就有 base：

```ts
editor.on("canvas:frame:load:head", () => injectCanvasBase(editor, id));
injectCanvasBase(editor, id); // 当前文档立即注入
```

## 关联发现

- **image 组件 src 的规范写路径是 `cmp.set("src", v)`**（触发 change:src -> updateSrc -> addAttributes 同步）；直接 `addAttributes({src})` 会被 `getAttrToHTML` 的 `getSrcResult()`（读 model 'src' 属性）覆盖回旧值（ComponentImage.ts:89）；
- `onError` 只改视图 `el.src`（换占位 SVG），不改模型——保存/导出的 src 仍是正确相对路径，只有画布显示错。

## 预防/注意事项

- 断言图片加载成功用 `img.currentSrc`（或 naturalHeight 与真实资源比对），**不要用 naturalWidth>0**（占位 SVG 也有 naturalWidth）；
- 断言背景图可用别只查 computed URL 字符串，要 fetch 该 URL 确认可达；
- 任何「往画布 iframe 注入东西」的需求都要考虑 loadProjectData 重建文档的场景，统一挂 `canvas:frame:load:head`。
