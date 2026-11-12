Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
while ($true) {
  $h = [Fg]::GetForegroundWindow()
  $target = 0
  [void][Fg]::GetWindowThreadProcessId($h, [ref]$target)
  try { (Get-Process -Id $target -ErrorAction Stop).ProcessName } catch { 'unknown' }
  Start-Sleep -Milliseconds 400
}