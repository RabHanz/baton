# Silently installs the previous (Baton) release, then the renamed (Tessaya) build over it, and
# checks that the upgrade replaced the old install instead of sitting beside it.
#   upgrade-proof.ps1 -Old <Baton installer.exe> -New <Tessaya installer.exe>
param([Parameter(Mandatory)][string]$Old, [Parameter(Mandatory)][string]$New)
$ErrorActionPreference = 'Stop'
# It writes fixtures over live settings, force-kills Tessaya and installs an old release: a CI runner or a clean Windows user only.
if (-not $env:CI) {
  foreach ($p in @((Join-Path $HOME '.t3'), (Join-Path $env:APPDATA 'baton'), (Join-Path $env:APPDATA 'Tessaya'))) {
    if (Test-Path $p) { throw "not a clean machine: $p exists. Run this on a CI runner or a fresh Windows user, never on a machine in use." }
  }
}
$uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$programs = Join-Path $env:LOCALAPPDATA 'Programs'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$fixtures = @{
  (Join-Path $HOME '.t3\userdata\baton-pill.json') = '{"1":{"x":0.5,"y":0.9}}'
  (Join-Path $HOME '.t3\userdata\fabric-voice.json') = '{"keepVoice":true}'
  (Join-Path $env:APPDATA 'baton\window-bounds.json') = '{"width":1200}'
}
$failures = @()
function Check($name, $ok) { if ($ok) { Write-Host "ok   $name" } else { Write-Host "FAIL $name"; $script:failures += $name } }
function Entries { Get-ChildItem $uninstall | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -match '^(Baton|Tessaya)' } }
function Install($exe) { $p = Start-Process -FilePath $exe -ArgumentList '/S' -PassThru -Wait; Start-Sleep -Seconds 5; Get-Process | Where-Object { $_.ProcessName -match '^(Baton|Tessaya)$' } | Stop-Process -Force -ErrorAction SilentlyContinue }

Install $Old
Check 'old install registered as Baton' ((Entries | Where-Object { $_.DisplayName -match '^Baton' }).Count -eq 1)
$oldKey = (Entries | Select-Object -First 1).PSChildName
foreach ($f in $fixtures.Keys) { New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null; Set-Content $f $fixtures[$f] }
# The old build's login entry, and one that points at the old exe.
Set-ItemProperty $run -Name 'Baton' -Value ('"' + (Join-Path $programs 'baton\Baton.exe') + '"')

Install $New
$entries = @(Entries)
Check 'one uninstall entry' ($entries.Count -eq 1)
Check 'named Tessaya' ($entries.Count -eq 1 -and $entries[0].DisplayName -match '^Tessaya')
Get-ChildItem $uninstall | ForEach-Object { $_.PSChildName } | Where-Object { $_ -eq $oldKey } | ForEach-Object { Check 'same uninstall key as before' $true }
Check 'one install folder' (@(Get-ChildItem $programs -Directory | Where-Object { $_.Name -match '^(baton|tessaya)$' }).Count -eq 1)
Check 'Tessaya.exe is there' (Test-Path (Join-Path $programs 'baton\Tessaya.exe'))
$lnks = @(Get-ChildItem $startMenu -Filter '*.lnk' -Recurse | Where-Object { $_.BaseName -match '^(Baton|Tessaya)$' })
Check 'one Start Menu shortcut, named Tessaya' ($lnks.Count -eq 1 -and $lnks[0].BaseName -eq 'Tessaya')
Check 'no desktop shortcut named Baton' (-not (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Baton.lnk')))
$runs = (Get-ItemProperty $run).PSObject.Properties | Where-Object { $_.Name -match 'Baton|Tessaya|dev\.rabee\.baton' }
Check 'one login entry' (@($runs).Count -eq 1)
Check 'it starts Tessaya.exe' (@($runs).Count -eq 1 -and $runs[0].Value -match 'Tessaya\.exe')
foreach ($f in $fixtures.Keys) { Check "kept $(Split-Path $f -Leaf)" ((Test-Path $f) -and ((Get-Content $f -Raw).Trim() -eq $fixtures[$f])) }
if ($failures.Count -gt 0) { throw "upgrade proof failed: $($failures -join '; ')" }
Write-Host 'upgrade proof passed'
