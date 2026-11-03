# What Tessaya costs (2026-11-02)

Measured by `scripts/baton/resource-proof.ps1` inside the Windows voice-proof job (`baton-voice-proof.yml`), on a GitHub
`windows-2022` runner (4 vCPU, no GPU). Each phase is 60 seconds of sampling every 2 seconds, after a start-up wait that is not counted.
CPU is the percent of ONE core summed over the app and every process under it. RAM is the working set of the same processes, added up
(shared pages are counted once per process, so it overstates what Task Manager's "memory" column adds to). GPU is Windows' per-process
engine counter: this runner has none, so it reads 0.

## First numbers

Two runs of the same job: the released build `baton-v0.1.39`, and a build of main.

| Phase          | What runs                              | CPU avg % (release / main) | CPU p95    | RSS avg MB  | RSS max MB  | Processes |
| -------------- | -------------------------------------- | -------------------------- | ---------- | ----------- | ----------- | --------- |
| idle           | app up, voice off                      | 2.28 / 0.66                | 16.7 / 2.1 | 855 / 523   | 1022 / 850  | 10        |
| wake-listen    | voice on, listening to silence         | 3.07 / 1.52                | 7.7 / 5.2  | 2113 / 1768 | 2236 / 2158 | 13        |
| dictation      | the dictate phrase on repeat           | 45.6 / 23.7                | 215 / 82   | 2990 / 2713 | 3120 / 3017 | 16-18     |
| assistant turn | the question on repeat (no login here) | 22.9 / 12.8                | 202 / 102  | 3059 / 2685 | 3211 / 3020 | 16        |

Read with care: one run each, a shared runner, and the release-versus-main gap in the idle row is largely start-up noise (the release's idle
p95 is 16.7%, so something was still settling).

## Against the goal

The goal was idle under 2% of one core and under 450 MB across processes.

- **CPU at idle: met on main (0.66%), borderline on the release (2.28%).**
- **RAM at idle: not met.** 520 to 850 MB with voice off, in 10 processes (main, GPU, network, the T3 window, Tessaya's window, the pill and
  overlay windows). Each Electron renderer is roughly 60 to 100 MB; the cheapest cut is creating the pill, card and prompt windows when first
  needed instead of at launch. Not done yet.
- **Voice on adds about 1.2 GB** (wake-listen 1.8 to 2.1 GB): the speech model (about 700 MB, memory-mapped) and the wake and speech-detection
  runtimes. Dictation and a turn add another 0.7 to 0.9 GB while transcribing. That is the price of the local model; a smaller model is the
  lever and a product decision.
- **Dictation CPU** is a burst while transcribing (p95 above one core), not a steady cost.

## Budgets

`scripts/baton/perf-budgets.json` holds regression guards about 30% above these first numbers, enforced by the `perf_enforce` input of
the voice-proof workflow (off by default until a few more runs show the noise). They stop things getting worse; they do not claim the goal.

| Phase          | CPU avg % | RSS max MB |
| -------------- | --------- | ---------- |
| idle           | 3         | 1200       |
| wake-listen    | 5         | 2800       |
| dictation      | 60        | 3600       |
| assistant turn | 40        | 3600       |

## Polling and timers (what was checked)

The desktop app's recurring timers are all unref'd and slow (the fastest: the resting-bar foreground check and the microphone poll at 5 s,
the context push at 10 s, jobs at 15 s while the Jobs page is open). The phone relay polled every 5 s forever; it now backs off to 15 s after a
minute of nothing and 30 s after five (`nextPollMs`), staying inside the server's 45 s "connected" window. The idle CPU numbers above do not
point at a polling loop.

## Starting on a starved CPU

The proof starts the app on one core shared with one busy loop and plays the wake phrase the moment the voice loop starts. The first phrase
must be heard. It now is (run 41479939470, as shipped and with `BATON_THREADS=1`), and the proof enforces it.

**What was wrong, with the evidence** (runs 41470145822, 41474487093, 41479939470; each start's steps are in `starved-voice-turns.ndjson`):

1. The sidecar loaded the 700 MB model inside a call with a fixed 120 s timer. Fixed in #309: the sidecar says "loading" every second and
   a call waits while it does. That was real but was not what lost the phrase: the model itself loads in about 0.6 s even when starved.
2. **The hold played its audio back in one burst.** Steps showed `held-audio-played` and `warm-complete`, so the models were ready and the audio
   was handed to the core, and still nothing was heard. The wake check, the command window and the recogniser follow the clock; a phrase pushed
   in a burst is over before the window that waits for it opens. Now it is played in at the speed it was said, with quiet stretches over 1.2 s
   cut so a long wait is not replayed as a long silence.
3. **Two speech threads on one core.** With the app pinned to one core the warm-up's scoring stage took 211 s (control with one speech thread:
   57 s). std's `available_parallelism` ignores a Windows affinity mask, so the sidecar still started threads for four cores, and ggml's threads
   wait for each other by spinning. The sidecar now counts cores with `GetProcessAffinityMask` and never starts more threads than cores.
4. The status line shows how many of the two models are ready, how long the speech model has been loading, and, past 45 s, that audio is
   being kept and will be heard when they are ready.

**Why the first ever start is slow** (96 to 102 s in the proof). From the turn log of an unstarved first start: about 53 s is the 740 MB
speech-model download, about 15 s is verifying it and starting the sidecar and microphone list, and the voice loop itself starts under a second
after that. The next starts skip the download (a `.verified` marker saves hashing). The window shows "Downloading the speech model: N%"
meanwhile. Shipping the model in the installer would remove it at the cost of a 700 MB download for everyone.

## Upgrades do not refetch models (2026-11-03)

The Director asked why voices seem to download again on every new build. Audit: the only two fetchers are the speech model
(`voiceModels.ts`) and the voice engine plus its files (`pocketVoice.ts`). Both write under the state folder
(`.t3\userdata\voice\models` and `\voice\pocket`), neither installer touches it, and nothing is keyed by the app version: a model counts as
present by its size and a `.verified` marker holding its hash, a voice file by existing. The wake and speech-detection models ship inside the
installer and are replaced with it, which is a normal update, not a download.

Proved on the Windows runner (`model-upgrade-proof.ps1`, run 41639171971): install 0.1.41, let it fetch the speech model, the voice engine, the
model and the voice (11 files, 1 GB), install 0.1.44 over it, start it. All 11 files kept their size and write time; none was removed, no
partial download appeared; the speech model loaded in 0.1 s (a download or a 740 MB hash takes many seconds). So an update does not refetch.

What can still refetch: a `.verified` marker that is missing or holds another hash (the file is hashed again once, and deleted and fetched
only if the hash is wrong), the voice engine's `pocket-tts.exe` removed from disk (a virus scanner does this to a downloaded program), and a
change of voice or speech model, which fetches that one file. For the engine, the checked archive is now kept after unpacking, so a removed
program is restored from it without the network.
