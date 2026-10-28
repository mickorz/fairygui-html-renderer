# Getting Started

从零到第一次跑通：克隆仓库并拉取 submodule。英文版见 [../getting-started.md](../getting-started.md)。

## 前提条件

- Git
- Node.js（版本要求随首个可用版本确定）

## 安装

```bash
git clone --recursive https://github.com/mickorz/fairygui-html-renderer.git
cd fairygui-html-renderer
```

`--recursive` 会同时拉取 `thirdparties/OpenFairy-SDK-uGUI`（FairyGUI SDK 参考实现，git submodule）。

## 验证

```bash
git submodule status
```

`thirdparties/OpenFairy-SDK-uGUI` 行首没有 `-` 前缀即表示 submodule 已检出。

## 第一次运行

随首个可用版本发布后补充。

## 下一步

- 配置参考：[configuration.md](configuration.md)
- 常见任务：[how-to-guides.md](how-to-guides.md)
