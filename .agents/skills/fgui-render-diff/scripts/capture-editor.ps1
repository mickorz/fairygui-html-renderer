﻿﻿﻿# OS 级窗口截图降级：编辑器 ScreenCapture API 不可用时截 FairyGUI 编辑器主窗口
# PrintWindow + PW_RENDERFULLCONTENT：无需前台、被遮挡也能截（支持 D3D 渲染窗口）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File capture-editor.ps1 <输出png路径>
param(
    [Parameter(Mandatory=$true)][string]$OutPath,
    [switch]$Maximize
)

Add-Type -AssemblyName System.Drawing

$sig = @'
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public struct POINT { public int X; public int Y; }
'@
Add-Type -MemberDefinition $sig -Name Win -Namespace Native

$p = Get-Process FairyGUI-Editor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw "FairyGUI-Editor 窗口进程未找到" }
$h = $p.MainWindowHandle

if ($Maximize) {
    [void][Native.Win]::ShowWindow($h, 3)   # SW_MAXIMIZE
    Start-Sleep -Milliseconds 600
}

$r = New-Object Native.Win+RECT
[void][Native.Win]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
if ($w -le 0 -or $hgt -le 0) { throw "窗口矩形异常: ${w}x${hgt}" }

$bmp = New-Object System.Drawing.Bitmap($w, $hgt)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 2：截 D3D/GPU 渲染内容（Windows 8.1+）
$printed = [Native.Win]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
if (-not $printed) {
    $g.Dispose(); $bmp.Dispose()
    throw "PrintWindow 失败"
}
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# 客户区原点在全窗口位图中的偏移（canvas_rect 坐标原点 = 客户区左上）
$c = New-Object Native.Win+RECT
[void][Native.Win]::GetClientRect($h, [ref]$c)
$pt = New-Object Native.Win+POINT
$pt.X = 0; $pt.Y = 0
[void][Native.Win]::ClientToScreen($h, [ref]$pt)
$offX = $pt.X - $r.Left
$offY = $pt.Y - $r.Top
Write-Output ("saved ${w}x${hgt} offset=${offX},${offY} client=" + $c.Right + "x" + $c.Bottom)
