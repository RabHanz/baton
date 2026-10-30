<#
Voice lab for Baton. Run on the laptop, from this folder:

  .\voice-lab.ps1 replay               false wakes on his stored Wispr speech; needs nothing from him
  .\voice-lab.ps1 dictation            Parakeet against Wispr on his stored dictation
  .\voice-lab.ps1 samples              he says each word 30 times; both mics at once if both are in
  .\voice-lab.ps1 ambient -Hours 4     the room, for hours; keeps counts, never audio
  .\voice-lab.ps1 report               every word on every mic against the targets
  .\voice-lab.ps1 mics                 what Windows calls the microphones right now

Everything stays in D:\baton-voice-lab. Heavy steps run below normal priority (idle starves Parakeet: 2.6x slower while he worked).
#>
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('replay', 'dictation', 'samples', 'ambient', 'report', 'mics')]
  [string]$Step,
  [double]$Hours = 4,
  [int]$Reps = 30,
  [int]$Sample = 2000,
  [int]$DictationClips = 240,
  [string]$Lab = 'D:\baton-voice-lab'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$exe = Join-Path $here 'baton-dictation.exe'
$models = Join-Path $here 'models'
$gguf = Join-Path $Lab 'models\parakeet-tdt-0.6b-v3-Q8_0.gguf'
$words = 'sebastian,alfred,freya'
$score = Join-Path $here 'wake-score.mjs'
$py = Join-Path $here 'lab.py'
New-Item -ItemType Directory -Force $Lab | Out-Null

function Get-Mics {
  $all = (& $exe devices) | ConvertFrom-Json
  $found = @()
  foreach ($mic in @(@{ label = 'AT2020'; match = 'Scarlett|Focusrite'; channel = 0 }, @{ label = 'DJI'; match = 'Wireless Mic Rx|DJI'; channel = $null })) {
    $device = $all | Where-Object { $_.name -match $mic.match } | Select-Object -First 1
    if ($device) { $found += [pscustomobject]@{ label = $mic.label; name = $device.name; channel = $mic.channel } }
  }
  return $found
}

function Start-Idle([string]$File, [string[]]$ArgList, [string]$Out) {
  $process = Start-Process $File -ArgumentList $ArgList -NoNewWindow -PassThru -RedirectStandardOutput $Out
  $process.PriorityClass = 'BelowNormal'
  $process.WaitForExit()
}

function Get-RecordArgs($mic, [int]$Seconds) {
  $list = @('record', '--device', "`"$($mic.name)`"", '--seconds', "$Seconds")
  if ($null -ne $mic.channel) { $list += @('--channel', "$($mic.channel)") }
  return $list
}

switch ($Step) {
  'mics' { (& $exe devices) | ConvertFrom-Json | Format-Table name, channels, isDefault -AutoSize }

  'replay' {
    if (-not (Test-Path "$Lab\clips.txt")) { python $py export --lab $Lab --sample $Sample }
    Remove-Item "$Lab\replay.jsonl" -ErrorAction SilentlyContinue
    Start-Idle 'node' @("`"$score`"", '--models', "`"$models`"", '--words', $words, '--list', "`"$Lab\clips.txt`"", '--out', "`"$Lab\replay.jsonl`"") "$Lab\replay.log"
    python $py report --lab $Lab
  }

  'dictation' {
    if (-not (Test-Path "$Lab\clips.txt")) { python $py export --lab $Lab --sample $Sample }
    Get-Content "$Lab\clips.txt" -TotalCount $DictationClips | Set-Content "$Lab\dictation.txt"
    Start-Idle $exe @('transcribe', '--model', "`"$gguf`"", '--language', 'en', '--list', "`"$Lab\dictation.txt`"") "$Lab\parakeet.jsonl"
    python $py dictation --lab $Lab
  }

  'samples' {
    $mics = @(Get-Mics)
    if ($mics.Count -eq 0) { throw 'Neither the Scarlett nor the DJI receiver is connected.' }
    Write-Host "Recording from: $(($mics | ForEach-Object { $_.label }) -join ' and ')"
    Write-Host 'Speak as you normally would, from where you normally sit. Three seconds per prompt.'
    $dir = "$Lab\samples"
    New-Item -ItemType Directory -Force $dir | Out-Null
    foreach ($word in $words.Split(',')) {
      Read-Host "Press Enter to start '$word' ($Reps times)"
      foreach ($rep in 1..$Reps) {
        $jobs = foreach ($mic in $mics) {
          $raw = "$dir\$($mic.label)-$word-$rep.raw"
          Start-Process $exe -ArgumentList (Get-RecordArgs $mic 3) -NoNewWindow -PassThru -RedirectStandardOutput $raw
        }
        Start-Sleep -Milliseconds 250
        Write-Host "  $rep/$Reps  say: $word"
        [console]::Beep(880, 120)
        $jobs | ForEach-Object { $_.WaitForExit() }
      }
    }
    python -c @"
import glob, struct
for raw in glob.glob(r'$dir\*.raw'):
    data = open(raw, 'rb').read()
    head = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 16000, 32000, 2, 16) + b'data' + struct.pack('<I', len(data))
    open(raw[:-4] + '.wav', 'wb').write(head + data)
"@
    Get-ChildItem "$dir\*.raw" | Remove-Item
    (Get-ChildItem "$dir\*.wav").FullName | Set-Content "$Lab\samples.txt"
    Remove-Item "$Lab\samples.jsonl" -ErrorAction SilentlyContinue
    Start-Idle 'node' @("`"$score`"", '--models', "`"$models`"", '--words', $words, '--list', "`"$Lab\samples.txt`"", '--out', "`"$Lab\samples.jsonl`"") "$Lab\samples.log"
    python $py report --lab $Lab
  }

  'ambient' {
    $mics = @(Get-Mics)
    if ($mics.Count -eq 0) { throw 'Neither the Scarlett nor the DJI receiver is connected.' }
    $seconds = [int]($Hours * 3600)
    Write-Host "Listening for $Hours hours on $(($mics | ForEach-Object { $_.label }) -join ' and '). Work as normal; do not say the wake words."
    $jobs = foreach ($mic in $mics) {
      $record = (Get-RecordArgs $mic $seconds) -join ' '
      $line = "`"$exe`" $record | node `"$score`" --models `"$models`" --words $words --stdin --label $($mic.label) --out `"$Lab\ambient.jsonl`""
      Start-Process cmd.exe -ArgumentList '/c', "`"$line`"" -WindowStyle Hidden -PassThru
    }
    $jobs | ForEach-Object { $_.PriorityClass = 'BelowNormal' }
    $jobs | ForEach-Object { $_.WaitForExit() }
    python $py report --lab $Lab
  }

  'report' { python $py report --lab $Lab }
}
