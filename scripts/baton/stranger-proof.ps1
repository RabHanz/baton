# The stranger-install proof (public release checklist, item 9): what a person who is not the maintainer gets on a
# clean machine. Two phases around the voice proof, so the installer is exercised once:
#   stranger-proof.ps1 -Phase first     -Installer <Tessaya-x64.exe> -Out <folder>
#   (then voice-proof.ps1 runs, as the same stranger)
#   stranger-proof.ps1 -Phase uninstall -Out <folder>
# It fails on: any file of the maintainer's in the starting state, no window created on first run, a private name
# or a wake word outside the defaults anywhere in the user data, and an uninstall that leaves the app behind or
# takes the user's data with it.
param(
  [Parameter(Mandatory)][ValidateSet('first', 'uninstall')][string]$Phase,
  [string]$Installer,
  [Parameter(Mandatory)][string]$Out,
  [int]$WaitSeconds = 90
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$userdata = Join-Path $HOME '.t3\userdata'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\baton'
$report = Join-Path $Out 'stranger-report.txt'
$failures = New-Object System.Collections.Generic.List[string]
function Note([string]$line) { Write-Host $line; Add-Content $report $line }
function Fail([string]$line) { Note "FAIL $line"; $failures.Add($line) }

# What a default install is allowed to say. Names of the maintainer's machines and accounts are not.
$private = 'signzart|onnyx|ventureos|venture-os|xiaomi|rabee|hetzner'
$defaultWakeWords = @('tessaya', 'sebastian', 'alfred', 'freya', 'onyx')

if ($Phase -eq 'first') {
  if (-not $Installer) { throw 'give -Installer' }
  Note '== clean start =='
  foreach ($p in @((Join-Path $HOME '.t3'), $installDir, (Join-Path $env:APPDATA 'Tessaya'), (Join-Path $env:APPDATA 'baton'))) {
    if (Test-Path $p) { Fail "not a clean machine: $p exists before the install" } else { Note "absent, as it should be: $p" }
  }
  if ($failures.Count -gt 0) { throw 'machine was not clean' }

  Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
  Start-Sleep -Seconds 5
  $exe = Join-Path $installDir 'Tessaya.exe'
  if (-not (Test-Path $exe)) { throw "Tessaya.exe is not at $exe" }
  Note "installed: $exe"

  # First run: no configuration of any kind, a test directory so the app records its own windows.
  $shots = Join-Path $Out 'first-run-shots'
  New-Item -ItemType Directory -Force $shots | Out-Null
  $env:BATON_TEST_DIR = $shots
  Remove-Item Env:BATON_TEST_WAV -ErrorAction SilentlyContinue
  $app = Start-Process -FilePath $exe -PassThru
  # Tessaya starts in the tray with no window; a second launch means "show me Tessaya" (startBatonDesktop), which
  # opens its window, and the app records the page it draws.
  Start-Sleep -Seconds 25
  Start-Process -FilePath $exe
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (@(Get-ChildItem $shots -Filter '*.png' -ErrorAction SilentlyContinue).Count -gt 0) { break }
  }
  Start-Sleep -Seconds 3
  $pngs = @(Get-ChildItem $shots -Filter '*.png' -ErrorAction SilentlyContinue)
  if ($pngs.Count -eq 0) { Fail 'first run created no window: the app recorded no page' } else { Note "first run drew $($pngs.Count) page capture(s): $($pngs[0].Name)" }
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2

  Note '== what the first run left in the user data =='
  if (-not (Test-Path $userdata)) { Fail "no user data folder at $userdata after a first run" }
  else {
    $files = @(Get-ChildItem $userdata -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 2MB -and $_.Extension -match '^\.(json|ndjson|md|txt|log)$' })
    Note "text files checked: $($files.Count)"
    foreach ($f in $files) {
      $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
      if ($text -and $text -match $private) { Fail "private name in $($f.FullName): $($Matches[0])" }
    }
    $voice = Join-Path $userdata 'fabric-voice.json'
    if (Test-Path $voice) {
      $cfg = Get-Content $voice -Raw | ConvertFrom-Json
      foreach ($w in @($cfg.wakeWords)) {
        if ($w.word -and ($defaultWakeWords -notcontains $w.word.ToLower())) { Fail "wake word outside the defaults: $($w.word)" }
      }
      Note "wake words in the settings: $((@($cfg.wakeWords) | ForEach-Object { $_.word }) -join ', ')"
    } else { Note 'no voice settings written by a first run (voice stays off until he turns it on)' }
    # The neutral operating-system pack ships in the app; a user pack would be a file here, and none came with the installer.
    $pack = Join-Path $userdata 'operating-system'
    if ((Test-Path $pack) -and @(Get-ChildItem $pack -File -ErrorAction SilentlyContinue).Count -gt 0) { Fail 'an operating-system pack exists on a clean machine' } else { Note 'no user operating-system pack: the neutral default is what loads' }
    foreach ($log in Get-ChildItem (Join-Path $userdata 'logs') -File -ErrorAction SilentlyContinue) {
      if ((Get-Content $log.FullName -Raw -ErrorAction SilentlyContinue) -match '(?i)operating-system pack.*(error|failed)') { Fail "the pack failed to load: $($log.Name)" }
    }
  }
  if ($failures.Count -gt 0) { throw "stranger proof failed: $($failures -join '; ')" }
  Note 'stranger first run passed'
}

if ($Phase -eq 'uninstall') {
  Note '== uninstall =='
  $before = @(Get-ChildItem $userdata -Recurse -File -ErrorAction SilentlyContinue).Count
  $un = Get-ChildItem $installDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $un) { throw "no uninstaller in $installDir" }
  Start-Process -FilePath $un.FullName -ArgumentList '/S' -Wait
  # NSIS copies itself to a temporary place and returns at once; give it time to finish.
  $deadline = (Get-Date).AddSeconds(60)
  while ((Test-Path $installDir) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
  if (Test-Path (Join-Path $installDir 'Tessaya.exe')) { Fail 'Tessaya.exe is still there after the uninstall' } else { Note 'the app is gone' }
  $left = @(Get-ChildItem $installDir -Recurse -File -ErrorAction SilentlyContinue).Count
  if ($left -gt 0) { Fail "$left file(s) left in the install folder" }
  $key = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Tessaya*' }
  if ($key) { Fail 'an Add or remove programs entry is left' } else { Note 'no uninstall entry is left' }
  $after = @(Get-ChildItem $userdata -Recurse -File -ErrorAction SilentlyContinue).Count
  if ($after -lt $before) { Fail "the uninstall removed user data ($before files before, $after after)" } else { Note "user data kept ($after files)" }
  if ($failures.Count -gt 0) { throw "uninstall proof failed: $($failures -join '; ')" }
  Note 'stranger uninstall passed'
}
