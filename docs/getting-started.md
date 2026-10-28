# Getting Started

Reader-facing guide: from zero to a cloned, ready-to-hack repository. Chinese version: see [zh-CN/getting-started.md](zh-CN/getting-started.md).

## Prerequisites

- Git
- Node.js (version requirements will be pinned with the first usable release)

## Install

```bash
git clone --recursive https://github.com/mickorz/fairygui-html-renderer.git
cd fairygui-html-renderer
```

`--recursive` also fetches `thirdparties/OpenFairy-SDK-uGUI` (FairyGUI SDK reference, git submodule).

## Verify

```bash
git submodule status
```

The `thirdparties/OpenFairy-SDK-uGUI` line must not start with `-`.

## First Run

To be filled in with the first runnable release.

## Next Steps

- Configuration: [configuration.md](configuration.md)
- Common tasks: [how-to-guides.md](how-to-guides.md)
