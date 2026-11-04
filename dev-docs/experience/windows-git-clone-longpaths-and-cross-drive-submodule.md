# Windows 下 git 克隆 React 仓库检出残缺与 submodule 跨盘符迁移失败

- 日期：2026-11-04
- 环境：Windows 11 + Git Bash，主仓库 gitdir 位于 E 盘，工作树位于 C 盘（orca worktree）

## 问题现象

为本仓库 `thirdparties/` 添加 6 个技术栈仓库为 git submodule 时，连续出现两类报错：

1. `git clone --depth 1 https://github.com/facebook/react.git` 后，工作区显示大量文件处于 `D`（deleted）状态（约 510 个），且对任意 tag 执行 `git checkout --detach` 报 `Aborting`（git 认为存在本地修改）。缺失文件集中在 `compiler/packages/babel-plugin-react-compiler/src/__tests__/fixtures/` 下。
2. `git submodule absorbgitdirs` 报 `fatal: could not migrate git directory ... Improper link`。

## 排查过程

- 第一次怀疑浅克隆（`--depth 1`）导致对象缺失，改用同样参数重试仍复现；
- 对比其他仓库（grapesjs/vite/shadcn-ui/lucide/playwright）同样的浅克隆流程全部正常，唯独 react 异常；
- 观察缺失文件路径长度，均超过 Windows `MAX_PATH` 260 字符限制，确认根因是路径过长导致工作区检出静默跳过部分文件；
- `Improper link` 出现在 `git submodule absorbgitdirs`：submodule clone 落在 C 盘工作树内，而主仓库 `.git` 在 E 盘，git 迁移 gitdir 时默认走硬链接，跨盘符硬链接不被支持。

## 根因

1. Windows 默认路径上限 260 字符，react 仓库含大量超长测试 fixture 路径，普通 clone 检出不完整；
2. git 的 gitdir 迁移（absorbgitdirs）使用硬链接优化，跨文件系统（C 盘 -> E 盘）无法硬链接且未回退为复制。

## 解决方案

1. 克隆时启用长路径支持：

```bash
git -c core.longpaths=true clone --depth 1 <url> <path>
# 并写入仓库本地配置，保证后续 fetch/checkout 正常
git -C <path> config core.longpaths true
```

2. `absorbgitdirs` 失败时手动迁移 gitdir（复制代替硬链接）：

```bash
D="<主仓库.git>/worktrees/<worktree-id>/modules/thirdparties/<name>"
cp -r <path>/.git "$D"
git config --file "$D/config" core.worktree "<工作树绝对路径>/<path>"
rm -rf <path>/.git
echo "gitdir: $D" > <path>/.git
git submodule init <path>
```

3. submodule 锁定 release tag 的流程（`git submodule add -b <tag>` 在 shallow 模式下会因 tag 引用未抓取而报 `origin/<tag> is not a commit`），改用：

```bash
git submodule add --depth 1 <url> <path>
git -C <path> fetch --depth 1 origin tag <tag>
git -C <path> checkout --detach <tag>
# 再补 .gitmodules 的 path/url/branch 字段并 git add <path>
```

## 预防与注意事项

- 在 Windows 上克隆 react 等含深层目录的仓库，clone 命令一律加 `-c core.longpaths=true`；
- clone 后用 `git -C <path> status --short | wc -l` 验证工作区干净（0 行输出）再进行后续操作，避免带病登记 submodule；
- 本仓库 submodule 的 gitdir 位于 `E:/DesignProjects/fairygui-html-renderer/.git/worktrees/<id>/modules/`，与工作树分属两个盘符，后续任何 git 迁移/absorb 操作都要预期跨盘符问题；
- `git submodule add -b <tag>` 只适用于分支名；锁定 tag 必须走「add 默认分支 + fetch tag + checkout --detach + 补登记」流程。
