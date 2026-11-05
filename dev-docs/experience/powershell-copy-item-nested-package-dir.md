# PowerShell Copy-Item 递归复制把包目录塞进自身（FairyGUI 包目录自嵌套）

## 问题现象

把 `assets/demo-popup-pkg/`（3 个 XML）复制到另一个工程的 `assets/demo-popup-pkg/` 后，目录里出现
`demo-popup-pkg/demo-popup-pkg/demo-popup-pkg/...` 越套越深；FairyGUI Editor 打开工程后污染放大到
546 个目录 / 1636 个文件，路径带 `\\?\` 长路径前缀。

## 排查过程

1. 复制命令：`Copy-Item -Path 'A\assets\demo-popup-pkg' -Destination 'B\assets\demo-popup-pkg' -Recurse -Force`（目标不存在）；
2. 复制后立刻 `Get-ChildItem B\assets\demo-popup-pkg` 的输出第一行就是 `demo-popup-pkg`——说明**第一层嵌套在复制当时就产生了**，当时把它误读为文件名；
3. 两个工程各有一份污染（一份是复制产生、一份由编辑器打开工程时放大），`\\?\` 前缀表明是长路径能力的
   工具（编辑器/资源管理器）持续递归复制；
4. `robocopy <空目录> <目标> /MIR` 清理 + 从干净 zip 恢复后，条目数回到 3。

## 根因

`Copy-Item` 的 `-Destination` 语义歧义：目标**不存在**时，它把**源目录本身**复制到目标路径**内部**
（得到 `dst/src-basename/...`），而不是把源目录重命名为 dst。目录名与包名相同时，便形成「包目录里套包目录」，
后续工具（FairyGUI Editor 打开/导入包）会继续递归复制，层级爆炸。

## 解决方案

- **复制目录内容而不是目录本身**：

  ```powershell
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
  ```

  或 `robocopy $src $dst /E`（语义明确，推荐用于目录同步）；
- **复制后立刻校验条目数**：`(Get-ChildItem -LiteralPath $dst -Recurse -Force | Measure-Object).Count`，
  包目录期望值 = 文件数（本例 3），多出同名子目录即说明嵌套；
- **清理深层嵌套**：`robocopy <新建空目录> <污染目录> /MIR` 再删除，避免 Explorer 因路径过长失败；
- **FairyGUI 包目录不要走「导入包/导入资源」流程**：直接放在工程 `assets/<pkg>/` 下，编辑器打开工程即
  自动识别；需要新包时复制**文件**到目标目录，不要复制外层目录。

## 预防/注意事项

- 目标路径不存在时的 `Copy-Item -Recurse` 一律改用 `Copy-Item src\* dst` 或 `robocopy`；
- 交付 checklist 增加「条目数校验」（包目录 = package.xml + N 个组件 XML，无子目录）；
- 生成转换产物（Converter 输出）后同样校验目录结构，避免 writer/后续步骤重复复制造成自嵌套。
