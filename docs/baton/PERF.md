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

First attempt (one core shared with TWO busy loops, so the app had a third of a core): the models had not finished loading after four
minutes and the first phrase was still not heard, with or without the hold (loop-started after 138 to 162 s; `pill_state error` at about 100 s
into the audio). That is harsher than a slow laptop. The proof now shares the core with ONE busy loop (about half a core), the hold keeps up
to five minutes of audio, and the wait is seven minutes. Result (run 41449733277): loop-started after 105 s, the models still unfinished (`warm-timeout`), and **the first phrase was still not heard**
within seven minutes. So the "kept and played in" promise is **not proven**; the likely culprit is the speech sidecar's first call (it loads the
700 MB model on first use and its call timeout is 120 s, `dictationSidecar.ts`), which the audio hold cannot help. The proof now reports this
instead of failing on it, and uploads the app's logs from that start so the next look has the evidence. The progress line and the honest message
are in; the guarantee is not.

The proof also starts the app on one core shared with two busy loops and plays the wake phrase right away. Before this change the start gave up
waiting for the models after 8 s, opened the microphone, and the first phrase was lost: **loop-started took 138 and 162 s, first phrase heard:
no.** Now the start waits up to 45 s showing how many of the two models are ready and for how long ("Starting: loading the speech models
(1 of 2 ready, 14 s)"); past that it says "Still loading the speech models. What you say now is kept and heard as soon as they are ready.",
keeps the last 30 s of audio, and plays it into the models in order when they are ready. The starved-start assertion (loop started within
240 s, first phrase heard) is on in the proof.
