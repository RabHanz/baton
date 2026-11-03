# The upgrade proof: install version A, let it fetch its speech models, install version B over it, start B, and assert that
# B fetched nothing and hashed nothing: every file under voice\models and voice\pocket keeps its size and write time, no
# partial download appears, and B's voice start reaches "speech-model-loaded" as fast as a warm start (a 740 MB hash or
# download would take many seconds). Models live in the state folder, which neither installer touches; no file is keyed by
# the app version.
#   model-upgrade-proof.ps1 -From <A-x64.exe> -To <B-x64.exe> -Out <folder> [-LoadedWithinSeconds 12]
param(
  [Parameter(Mandatory)][string]$From,
  [Parameter(Mandatory)][string]$To,
  [Parameter(Mandatory)][string]$Out,
  [int]$LoadedWithinSeconds = 12
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$userdata = Join-Path $HOME '.t3\userdata'
New-Item -ItemType Directory -Force $userdata | Out-Null
$voice = Join-Path $userdata 'voice'
$log = Join-Path $userdata 'logs\voice-turns.ndjson'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\baton\Tessaya.exe'

Set-Content (Join-Path $userdata 'fabric-voice.json') '{"enabled":true,"wakeWords":[{"word":"Sebastian","enabled":true,"threshold":0.9}]}'

Add-Type -AssemblyName System.Speech
$wavDir = Join-Path $Out 'wav'; New-Item -ItemType Directory -Force $wavDir | Out-Null
$wav = Join-Path $wavDir 'wake.wav'
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($wav, $f); $s.Speak('Sebastian. What is the capital of Brazil?'); $s.Dispose()
$list = Join-Path $wavDir 'list.txt'; Set-Content $list "wake.wav 4000`n40000"

function Install-App([string]$installer) { Start-Process -FilePath $installer -ArgumentList '/S' -Wait; Start-Sleep -Seconds 5; if (-not (Test-Path $exe)) { throw "Tessaya.exe is not at $exe" } }
function Stop-App { Get-Process Tessaya, baton-dictation, pocket-tts -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 }
function Snapshot { # path, size, write time (ticks) of every file under voice\models and voice\pocket (settings files are not models)
  if (-not (Test-Path $voice)) { return @() }
  Get-ChildItem (Join-Path $voice 'models'), (Join-Path $voice 'pocket') -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName | ForEach-Object { [pscustomobject]@{ path = $_.FullName.Substring($voice.Length); size = $_.Length; written = $_.LastWriteTimeUtc.Ticks } }
}
function Run-App([string]$label, [int]$maxSeconds) {
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:BATON_TEST_WAV = $list; $env:BATON_TEST_DIR = (Join-Path $Out "$label-shots")
  $app = Start-Process -FilePath $exe -PassThru
  $t0 = Get-Date; $loaded = $null; $begin = $null; $deadline = $t0.AddSeconds($maxSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (-not (Test-Path $log)) { continue }
    $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
    if ($null -eq $begin -and $text -match '"at":"([^"]+)"[^\n]*"step":"begin"') { $begin = [datetime]::Parse($Matches[1]).ToUniversalTime() }
    if ($null -eq $loaded -and $text -match '"at":"([^"]+)"[^\n]*"step":"speech-model-loaded"') { $loaded = [datetime]::Parse($Matches[1]).ToUniversalTime() }
    if ($text -match '"test-audio"[^\n]*"type":"end"' -or $text -match 'agent_turn|wake_only') { Start-Sleep -Seconds 12; break }   # long enough for a spoken reply to start fetching the voice
  }
  Copy-Item $log (Join-Path $Out "$label-voice-turns.ndjson") -ErrorAction SilentlyContinue
  Stop-App
  [pscustomobject]@{ label = $label; secondsToModelLoaded = $(if ($begin -and $loaded) { [math]::Round(($loaded - $begin).TotalSeconds, 1) } else { $null }) }
}

Install-App $From
$a = Run-App 'a' 900          # the first start: downloads the speech model (and the voice, if a reply is spoken)
$before = Snapshot
$before | ConvertTo-Json | Set-Content (Join-Path $Out 'files-before.json')

Install-App $To               # in place, over A
$b = Run-App 'b' 300
$after = Snapshot
$after | ConvertTo-Json | Set-Content (Join-Path $Out 'files-after.json')

$fail = @()
if ($before.Count -eq 0 -or -not ($before | Where-Object { $_.path -like '*.gguf' })) { $fail += 'A never fetched the speech model, so there is nothing to compare' }
$map = @{}; foreach ($x in $after) { $map[$x.path] = $x }
foreach ($x in $before) {
  $y = $map[$x.path]
  if ($null -eq $y) { $fail += "removed by the upgrade: $($x.path)" }
  elseif ($y.size -ne $x.size -or $y.written -ne $x.written) { $fail += "rewritten by the upgrade: $($x.path)" }
}
foreach ($y in $after) { if (-not ($before | Where-Object { $_.path -eq $y.path })) { $fail += "new after the upgrade: $($y.path)" } }
if ($after | Where-Object { $_.path -like '*.part' }) { $fail += 'a partial download is lying around' }
if ($null -eq $b.secondsToModelLoaded) { $fail += "B never reached speech-model-loaded" }
elseif ($b.secondsToModelLoaded -gt $LoadedWithinSeconds) { $fail += "B took $($b.secondsToModelLoaded) s to load the speech model (a warm start is under $LoadedWithinSeconds s): it fetched or hashed" }

Write-Host "A: speech model loaded after $($a.secondsToModelLoaded) s. B: $($b.secondsToModelLoaded) s."
Write-Host ("files kept untouched: {0} of {1}" -f (($before | Where-Object { $m = $map[$_.path]; $m -and $m.size -eq $_.size -and $m.written -eq $_.written }).Count), $before.Count)
$before | ForEach-Object { Write-Host ("  {0} ({1:N0} bytes)" -f $_.path, $_.size) }
if ($env:GITHUB_STEP_SUMMARY) { Add-Content $env:GITHUB_STEP_SUMMARY ("Upgrade proof: A loaded the speech model after $($a.secondsToModelLoaded) s, B after $($b.secondsToModelLoaded) s; " + $(if ($fail.Count -eq 0) { "no model or voice file was touched." } else { "PROBLEMS: " + ($fail -join '; ') })) }
if ($fail.Count -gt 0) { $fail | ForEach-Object { Write-Host "FAIL $_" }; throw 'upgrade proof failed' }
Write-Host 'upgrade proof passed'
