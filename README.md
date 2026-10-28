# fairygui-html-renderer

FairyGUI 界面数据的 HTML 渲染器：解析 FairyGUI 导出的 UI 包，在浏览器中以 HTML/CSS/DOM 还原界面布局与显示效果。

## 概述

- 解析 FairyGUI 导出的 UI 数据（SDK 参考实现 OpenFairy-SDK-uGUI 以 git submodule 形式位于 `thirdparties/OpenFairy-SDK-uGUI`）
- 将 FairyGUI 组件（GComponent / GImage / GText / GList 等）映射为对应的 HTML/CSS/DOM 结构
- 在网页端直接预览 FairyGUI 界面，无需 Unity 或游戏运行时
- 项目处于初始化阶段，具体能力范围以 `dev-docs/design/` 中的设计文档为准

## 快速开始

环境要求：Git、Node.js（版本要求随首个可用版本确定）。

```bash
# 克隆（含 thirdparties/ 下的 submodule）
git clone --recursive https://github.com/mickorz/fairygui-html-renderer.git
```

安装与运行方式将在首个可用版本发布后补充，详见 `docs/zh-CN/getting-started.md`。

## 目录结构

```text
docs/          读者向文档
dev-docs/      开发过程文档
dev-examples/  开发期沙盒
thirdparties/  第三方依赖（git submodule）
CC-Default/    本地 FairyGUI 测试工程（不进 git）
```
