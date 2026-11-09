# 破前台锁并向 FairyGUI 编辑器发送真 Ctrl+滚轮（正规画布缩放通道）
# AttachThreadInput 附加到目标窗口线程绕过 SetForegroundWindow 前台锁，再 SendInput 合成真输入
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File zoom-input.ps1 <滚轮档数，负=缩小>
param([Parameter(Mandatory=$true)][int]$Steps)

Add-Type -AssemblyName System.Windows.Forms

$cs = @'
using System;
using System.Runtime.InteropServices;
public static class Kbd {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int size);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public KEYBDINPUT ki; public long pad; }

    public static void SendKey(ushort vk, bool up) {
        INPUT[] inp = new INPUT[1];
        inp[0].type = 1;
        inp[0].ki.wVk = vk;
        if (up) inp[0].ki.dwFlags = 2;
        SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    }
    public static void SendWheel(int delta) {
        INPUT[] inp = new INPUT[1];
        inp[0].type = 1;
        inp[0].ki.dwFlags = 0x0800u | ((uint)delta << 16);
        SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Windows.Forms

$p = Get-Process FairyGUI-Editor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw "FairyGUI-Editor 窗口进程未找到" }
$h = $p.MainWindowHandle

$r = New-Object Kbd+RECT
[void][Kbd]::GetWindowRect($h, [ref]$r)
$wx = $r.Left + [int](($r.Right - $r.Left) * 0.62)
$wy = $r.Top + [int](($r.Bottom - $r.Top) * 0.35)

$pid2 = [uint32]0
$targetThread = [Kbd]::GetWindowThreadProcessId($h, [ref]$pid2)
$myThread = [Kbd]::GetCurrentThreadId()
[void][Kbd]::AttachThreadInput($myThread, $targetThread, $true)
try {
    $ok = $false
    for ($i = 0; $i -lt 5 -and -not $ok; $i++) {
        [void][Kbd]::SetForegroundWindow($h)
        Start-Sleep -Milliseconds 300
        $ok = ([Kbd]::GetForegroundWindow() -eq $h)
    }
    if (-not $ok) { throw "仍无法把编辑器带到前台" }

    [void][Kbd]::SetCursorPos($wx, $wy)
    [Kbd]::SendKey(0x11, $false)   # Ctrl down
    $delta = 120 * [Math]::Sign($Steps)
    for ($i = 0; $i -lt [Math]::Abs($Steps); $i++) {
        [Kbd]::SendWheel($delta)
        Start-Sleep -Milliseconds 250
    }
    [Kbd]::SendKey(0x11, $true)    # Ctrl up
} finally {
    [void][Kbd]::AttachThreadInput($myThread, $targetThread, $false)
}
Write-Output "sent Ctrl+wheel($Steps) at screen ($wx,$wy)"
