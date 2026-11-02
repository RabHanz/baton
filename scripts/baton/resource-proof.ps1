# Measures what an installed Tessaya costs: CPU (percent of ONE core), RAM (working set summed over the app and every
# process under it) and GPU (Windows' per-process engine counter; null on a runner without one), over 60 seconds each in
# four states, and one start on a starved CPU. Budgets sit in perf-budgets.json; -Enforce fails the step over them.
#   resource-proof.ps1 -Out <folder> [-Seconds 60] [-Enforce]
# Run it after voice-proof.ps1 in the same job (the app is installed). Numbers are in docs/baton/PERF.md.
param(
  [Parameter(Mandatory)][string]$Out,
  [int]$Seconds = 60,
  [switch]$Enforce
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$exe = Join-Path $env:LOCALAPPDATA 'Programs\baton\Tessaya.exe'
if (-not (Test-Path $exe)) { throw "Tessaya.exe is not at $exe (run voice-proof.ps1 first)" }
$userdata = Join-Path $HOME '.t3\userdata'
$voiceFile = Join-Path $userdata 'fabric-voice.json'
$log = Join-Path $userdata 'logs\voice-turns.ndjson'
$budgets = Get-Content (Join-Path $PSScriptRoot 'perf-budgets.json') -Raw | ConvertFrom-Json

Add-Type -AssemblyName System.Speech
$wavDir = Join-Path $Out 'wav'
New-Item -ItemType Directory -Force $wavDir | Out-Null
function New-Phrase([string]$name, [string]$text) {
  $path = Join-Path $wavDir "$name.wav"
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($path, $f); $s.Speak($text); $s.Dispose()
  $path
}
New-Phrase 'wake' 'Sebastian. What is the capital of Brazil?' | Out-Null
New-Phrase 'dictate' 'Sebastian. Dictate. Testing the dictation path with a few ordinary words. Stop dictating.' | Out-Null
function New-List([string]$name, [string[]]$lines) {
  $p = Join-Path $wavDir $name; Set-Content $p ($lines -join "`n"); $p
}
$silence = New-List 'silence.txt' @("$(($Seconds + 120) * 1000)")
$dictate = New-List 'dictate.txt' (@(1..8 | ForEach-Object { 'dictate.wav 4000' }) + @('120000'))
$turns = New-List 'turns.txt' (@(1..8 | ForEach-Object { 'wake.wav 4000' }) + @('120000'))
$starve = New-List 'starve.txt' @('wake.wav 4000', '120000')

function Set-Voice([bool]$on) {
  Remove-Item $voiceFile -ErrorAction SilentlyContinue
  if ($on) { Set-Content $voiceFile '{"enabled":true,"wakeWords":[{"word":"Sebastian","enabled":true,"threshold":0.9}]}' }
}
function Get-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add($root)
  do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n)
  , $ids
}
function Get-Gpu($ids) {
  try {
    $samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
    $sum = 0.0
    foreach ($s in $samples) { if ($s.InstanceName -match 'pid_(\d+)_' -and $ids.Contains([int]$Matches[1])) { $sum += $s.CookedValue } }
    $sum
  } catch { $null }
}
function Measure-App([string]$name, $proc, [int]$wait, [int]$seconds) {
  Start-Sleep -Seconds $wait   # start-up is not the cost of standing still
  $last = @{}; $cpu = @(); $rss = @(); $gpu = @(); $procs = 0
  $t0 = Get-Date; $prev = $t0
  $end = $t0.AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    Start-Sleep -Seconds 2
    $now = Get-Date
    $ids = Get-Tree $proc.Id
    $total = 0.0; $mem = 0.0; $seen = @{}
    foreach ($id in $ids) {
      try {
        $p = Get-Process -Id $id -ErrorAction Stop
        $m = $p.WorkingSet64
        $c = $p.TotalProcessorTime.TotalSeconds
      } catch { continue }   # gone between listing and reading
      $mem += $m
      $seen[$id] = $c
      if ($last.ContainsKey($id)) { $total += ($c - $last[$id]) }
    }
    $last = $seen; $procs = [math]::Max($procs, $seen.Count)
    $cpu += 100.0 * $total / ($now - $prev).TotalSeconds
    $rss += $mem / 1MB
    $g = Get-Gpu $ids; if ($null -ne $g) { $gpu += $g }
    $prev = $now
  }
  $sorted = $cpu | Sort-Object
  [pscustomobject]@{
    phase = $name; seconds = $seconds; processes = $procs
    cpuAvg = [math]::Round(($cpu | Measure-Object -Average).Average, 2)
    cpuP95 = [math]::Round($sorted[[math]::Min($sorted.Count - 1, [int][math]::Floor($sorted.Count * 0.95))], 2)
    rssMBAvg = [math]::Round(($rss | Measure-Object -Average).Average, 0)
    rssMBMax = [math]::Round(($rss | Measure-Object -Maximum).Maximum, 0)
    gpuAvg = if ($gpu.Count -gt 0) { [math]::Round(($gpu | Measure-Object -Average).Average, 2) } else { $null }
  }
}
function Stop-Tree($proc) {
  $ids = Get-Tree $proc.Id
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
  Get-Process Tessaya, baton-dictation -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
function Start-App([string]$list) {
  Remove-Item $log -ErrorAction SilentlyContinue
  if ($list) { $env:BATON_TEST_WAV = $list; $env:BATON_TEST_DIR = (Join-Path $Out 'shots') } else { Remove-Item Env:BATON_TEST_WAV -ErrorAction SilentlyContinue }
  Start-Process -FilePath $exe -PassThru
}

$results = @()
# idle: running, voice off
Set-Voice $false; $app = Start-App $null
$results += Measure-App 'idle' $app 25 $Seconds; Stop-Tree $app
# wake-listen: voice on, listening to silence
Set-Voice $true; $app = Start-App $silence
$results += Measure-App 'wake-listen' $app 60 $Seconds; Stop-Tree $app
# dictation: the dictate phrase on repeat
Set-Voice $true; $app = Start-App $dictate
$results += Measure-App 'dictation' $app 60 $Seconds; Stop-Tree $app
# assistant turn: the question on repeat (no login here, so the turn ends early; the path is still walked)
Set-Voice $true; $app = Start-App $turns
$results += Measure-App 'assistant-turn' $app 60 $Seconds; Stop-Tree $app

# starved start: one core shared with two busy loops; the voice start must still finish and still hear the first phrase
$starved = $null
$cores = [Environment]::ProcessorCount
Set-Voice $true
Remove-Item $log -ErrorAction SilentlyContinue
$env:BATON_TEST_WAV = $starve; $env:BATON_TEST_DIR = (Join-Path $Out 'shots')
$burners = 1..2 | ForEach-Object { $b = Start-Process pwsh -ArgumentList '-NoProfile', '-Command', '(Get-Process -Id $PID).ProcessorAffinity = 1; while ($true) { }' -PassThru; $b }
$wrapper = Start-Process pwsh -ArgumentList '-NoProfile', '-Command', "(Get-Process -Id `$PID).ProcessorAffinity = 1; & '$exe'" -PassThru
$t0 = Get-Date; $loopAt = $null; $heard = $false; $deadline = $t0.AddSeconds(300)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-Path $log) {
    $seen = Get-Content $log -Raw -ErrorAction SilentlyContinue
    if ($null -eq $loopAt -and $seen -match '"step":"loop-started"') { $loopAt = ((Get-Date) - $t0).TotalSeconds }
    if ($seen -match 'wake_only|agent_turn|"kind":"turn"') { $heard = $true; break }
  }
}
$seen = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
$steps = ([regex]::Matches($seen, '"step":"([a-z-]+)"') | ForEach-Object { $_.Groups[1].Value }) -join ' '
Copy-Item $log (Join-Path $Out 'starved-voice-turns.ndjson') -ErrorAction SilentlyContinue
$burners | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Stop-Tree $wrapper
$starved = [pscustomobject]@{ cores = $cores; loopStartedSeconds = if ($null -eq $loopAt) { $null } else { [math]::Round($loopAt, 0) }; firstPhraseHeard = $heard; steps = $steps }

$report = [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString('o'); phases = $results; starved = $starved }
$report | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'resource.json')
$md = @('| Phase | CPU avg % of one core | CPU p95 | RSS avg MB | RSS max MB | GPU avg % | Processes |', '| --- | --- | --- | --- | --- | --- | --- |')
foreach ($r in $results) { $md += "| $($r.phase) | $($r.cpuAvg) | $($r.cpuP95) | $($r.rssMBAvg) | $($r.rssMBMax) | $(if ($null -eq $r.gpuAvg) { 'n/a' } else { $r.gpuAvg }) | $($r.processes) |" }
$md += ''; $md += "Starved start ($cores cores, one shared with two busy loops): loop-started after $($starved.loopStartedSeconds) s, first phrase heard: $($starved.firstPhraseHeard). Steps: $($starved.steps)"
$md | Out-String | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { Add-Content $env:GITHUB_STEP_SUMMARY ($md -join "`n") }

$fail = @()
foreach ($r in $results) {
  $b = $budgets.phases.($r.phase)
  if ($null -eq $b) { continue }
  if ($null -ne $b.cpuAvg -and $r.cpuAvg -gt $b.cpuAvg) { $fail += "$($r.phase): CPU $($r.cpuAvg)% > $($b.cpuAvg)%" }
  if ($null -ne $b.rssMBMax -and $r.rssMBMax -gt $b.rssMBMax) { $fail += "$($r.phase): RSS $($r.rssMBMax) MB > $($b.rssMBMax) MB" }
}
$sb = $budgets.starved
if ($null -ne $sb) {
  if ($null -eq $starved.loopStartedSeconds -or $starved.loopStartedSeconds -gt $sb.loopStartedSeconds) { $fail += "starved start: loop-started took $($starved.loopStartedSeconds) s (budget $($sb.loopStartedSeconds) s)" }
  if (-not $starved.firstPhraseHeard) { $fail += 'starved start: the first phrase was not heard' }
}
if ($fail.Count -gt 0) {
  $fail | ForEach-Object { Write-Host "OVER BUDGET $_" }
  if ($Enforce) { throw 'resource budget exceeded' }
} else { Write-Host 'within budget' }
