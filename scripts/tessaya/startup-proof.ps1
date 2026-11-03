# Installs the built Tessaya, fills the state folder like a real laptop's (large models, a kept voice archive, the
# legacy state folder), starts it, and checks after 60 s that the main thread is alive: Responding, a fresh
# heartbeat, no `main-stalled` in the lifecycle log, and still Responding after a real mouse click on its window.
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
$userdata = Join-Path $HOME '.t3\userdata'
$logs = Join-Path $userdata 'logs'

function Fill($path, $mb) {
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  $f = [IO.File]::Open($path, 'Create'); $f.SetLength($mb * 1MB); $f.Close()
}
Fill (Join-Path $userdata 'voice\models\parakeet.bin') 600
Fill (Join-Path $userdata 'voice\pocket\models\model.safetensors') 300
Fill (Join-Path $userdata 'voice\pocket\models\anna.safetensors') 50
Fill (Join-Path $userdata 'voice\pocket\bin\pocket-tts-windows.zip') 120
New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.baton') | Out-Null
Set-Content (Join-Path $HOME '.baton\baton-conversation.ndjson') '{}'

Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
$exe = Get-ChildItem -Path $env:LOCALAPPDATA, $env:ProgramFiles -Recurse -Filter 'Tessaya.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'resources' } | Select-Object -First 1
if (-not $exe) { throw 'Tessaya.exe was not installed' }
$proc = Start-Process -FilePath $exe.FullName -PassThru
Start-Sleep -Seconds 60

$fail = @()
$proc.Refresh()
if ($proc.HasExited) { $fail += 'the app exited' }
elseif (-not $proc.Responding) { $fail += 'main process is not responding after 60 s' }

$beat = Join-Path $logs 'baton-heartbeat.json'
if (-not (Test-Path $beat)) { $fail += 'no heartbeat file' }
elseif (((Get-Date) - (Get-Item $beat).LastWriteTime).TotalSeconds -gt 60) { $fail += 'heartbeat is stale' }

$life = Join-Path $logs 'baton-lifecycle.ndjson'
if ((Test-Path $life) -and (Select-String -Path $life -Pattern 'main-stalled' -Quiet)) {
  $fail += 'main-stalled in the lifecycle log'
  Select-String -Path $life -Pattern 'main-stalled|main-stack' | ForEach-Object { $_.Line }
}

# A real mouse click on the window, then the app must still answer.
Add-Type @'
using System; using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
'@
if (-not $proc.HasExited -and $proc.MainWindowHandle -ne 0) {
  $r = New-Object Mouse+RECT
  [void][Mouse]::GetWindowRect($proc.MainWindowHandle, [ref]$r)
  [void][Mouse]::SetCursorPos([int](($r.L + $r.R) / 2), [int](($r.T + $r.B) / 2))
  [Mouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [Mouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Seconds 5
  $proc.Refresh()
  if (-not $proc.Responding) { $fail += 'not responding after a real click' }
}

Get-Process | Where-Object { $_.ProcessName -match '^Tessaya$' } | Stop-Process -Force -ErrorAction SilentlyContinue
if ($fail.Count -gt 0) { $fail | ForEach-Object { Write-Host "FAIL: $_" }; exit 1 }
Write-Host 'startup proof ok'
