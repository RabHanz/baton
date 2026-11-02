# Installs a Tessaya build silently, launches it with BATON_TEST_WAV (a spoken wake phrase made here with
# Windows speech) and BATON_TEST_DIR, waits, and reads voice-turns.ndjson to see how far the voice start got.
#   voice-proof.ps1 -Installer <Tessaya-x64.exe> -Out <folder> [-WaitSeconds 300] [-RequireWake]
param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][string]$Out,
  [int]$WaitSeconds = 300,
  [switch]$RequireWake
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$userdata = Join-Path $HOME '.t3\userdata'
New-Item -ItemType Directory -Force $userdata | Out-Null

# Voice on, one wake word, as a person who turned it on would have.
Set-Content (Join-Path $userdata 'fabric-voice.json') '{"enabled":true,"wakeWords":[{"word":"Sebastian","enabled":true,"threshold":0.9}]}'

# The phrase, spoken, at 16 kHz mono, then a listing: the phrase, a gap, silence.
Add-Type -AssemblyName System.Speech
$wavDir = Join-Path $Out 'wav'
New-Item -ItemType Directory -Force $wavDir | Out-Null
$wav = Join-Path $wavDir 'wake.wav'
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$speech.SetOutputToWaveFile($wav, $format)
$speech.Speak('Sebastian. What is the capital of Brazil?')
$speech.Dispose()
$list = Join-Path $wavDir 'list.txt'
Set-Content $list "wake.wav 4000`n30000"

Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
Start-Sleep -Seconds 5
$exe = Join-Path $env:LOCALAPPDATA 'Programs\baton\Tessaya.exe'
if (-not (Test-Path $exe)) { throw "Tessaya.exe is not at $exe" }

$shots = Join-Path $Out 'shots'
$env:BATON_TEST_WAV = $list
$env:BATON_TEST_DIR = $shots
$app = Start-Process -FilePath $exe -PassThru
$log = Join-Path $userdata 'logs\voice-turns.ndjson'
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$seen = ''
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-Path $log) { $seen = Get-Content $log -Raw }
  if ($seen -match '"kind":"test-audio".*"type":"end"' -or $seen -match 'wake_only|agent_turn') { break }
}
Start-Sleep -Seconds 5
if (Test-Path $log) { $seen = Get-Content $log -Raw; Copy-Item $log (Join-Path $Out 'voice-turns.ndjson') }
Get-ChildItem (Join-Path $userdata 'logs') -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $Out $_.Name) -ErrorAction SilentlyContinue }
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue

Write-Host '--- voice-turns.ndjson ---'
Write-Host $seen
$steps = [regex]::Matches($seen, '"step":"([a-z-]+)"') | ForEach-Object { $_.Groups[1].Value }
Write-Host "voice start steps: $($steps -join ', ')"
$ok = $true
if ($seen -notmatch '"kind":"test-audio"') { Write-Host 'FAIL no test-audio line: the voice start never reached the audio'; $ok = $false }
if ($RequireWake -and $seen -notmatch 'wake_only|agent|"kind":"turn"') { Write-Host 'FAIL no wake_only or agent line'; $ok = $false }
if (-not $ok) { throw 'voice proof failed' }
Write-Host 'voice proof passed'
