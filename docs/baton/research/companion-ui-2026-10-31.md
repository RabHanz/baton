# Clicky gaps and Wispr's on-screen cues

retrieved_at: 2026-10-31 · consumer: Baton pill and companion · refresh: before changing either

## Clicky: what was reused and what was added

Reused, not redone: `research/clicky-2026-10-27/` (pinned repos, four frames) and
`research/clicky-videos-2026-10-27/` (sixteen frames, claims), plus our own
`frames/screen-companion-2026-10-27/`. Opened again for this work: 04, 01, 02, 07, 12, 13.

Gaps filled:

| Gap | Source | Finding |
| --- | --- | --- |
| Rest on target, in code | farzaa/clicky `OverlayWindow.swift`, `CompanionManager.swift` (fresh clone) | Bubble types 30 to 60 ms a character, holds 3.0 s after the last one, fades 0.5 s, then flies back. Pointing and speech are not tied together at all: the 3 s starts from the bubble, so a long answer outlives the pointer in the original too. Baton ties them. |
| Order of events | same | Waits for the whole reply, sets the pointer, then starts speech. Nothing is shown from the stream. |
| Flight easing | same | Smoothstep on the bezier parameter. Baton's copy was linear, so it never eased; now it does. |
| Where the words live | youtu.be/46t-mCH-AQw 0:26; frame 13 of the older set | In the paid product the text sits beside the pointer, in the pointer's colour. Baton had it at the bottom of the screen, which is what let it land on a different display. |
| Rest on target, in footage | heyclicky.com `usecase.mp4`, sampled every 3 s | Drawn labels stay through the whole narration: the Pythagoras squares are up for at least 24 s across eight samples. 480p, so this is a lower bound and nothing finer. |

Footage note: YouTube refuses this server, so those clips were fetched on the laptop.

## Wispr Flow

Sources: the app's own bundle (1.6.13xx, read-only: state enum, CSS sizes, strings, sounds), its
help centre (`docs.wisprflow.ai`, dated "last updated" within this month), its own videos. `wisprflow.ai/changelog`
returned 404. Nothing of Wispr's is reused: no name, logo, artwork, sound or colour value.

Facts from the bundle: states `hidden, resting, context-menu, initializing, ready, active_ptt,
active_popo, processing, polish_processing, polish_completed_action, polish_completed_na, polish_failed,
auto_cleanup_completed, hotkey_reminder, instruct_completed, error`. Sizes when docked at the bottom:
resting 40×8, ready 50×30, listening 73×30, processing 98×30, error 91×30 with a 1.5 px red edge.
Ten 2 px bars, gap 2, scaled by audio level times a centre-heavy shape, with a 1 s wobble staggered
0.1 s per bar. Sounds: start 0.18 s, stop 0.22 s, most energy at 250 to 500 Hz, peak about -16 dBFS.

| State or cue | Wispr's behaviour | Evidence | Baton's version | How Baton's is better | Baton frame |
| --- | --- | --- | --- | --- | --- |
| Idle | 40×8 grey lozenge always on, bottom centre | `wispr-resting-bar-36s.jpg`, CSS | Nothing at rest; Tray, Pill, "Show a small mark at rest" draws a 44×9 mark | A clean screen by default, his call | none needed |
| Hover | Grows to 50×30, ten dots, tooltip, clicks | `wispr-ready-dots-asset.jpg`, `wispr-recording-tooltip-38s.jpg` | None. The pill is click-through | It can never eat a click over his work. What hover offers is in the tray | `baton-pill-states-*` |
| Recording | 73×30, bars follow the mic, tooltip on hover | `wispr-waveform-asset.jpg` | Bars from the live mic, green for dictation, white for voice, with a word: Dictating, Listening | The colour and word say what the mic is for. Wispr has one dictation state to show; Baton has several | same |
| Which word | Not applicable | | "Listening, Alfred" | He sees which wake word fired, so a false wake explains itself | same |
| Processing | 98×30 shimmer, then text | CSS | Thinking, the bars sweep, with what was heard beside it | He can see it heard him right before the answer lands | same |
| Speaking | Not applicable | | Bars follow the envelope of the WAV being played, blue | Nothing in Wispr speaks | same |
| Drive or look | Not applicable | | Driving, Step 2 of 4 | Progress at a glance | same |
| Success | "Cleaned up!" pill with a link | string `hub_status_auto_cleanup_label` | "Pasted", 1.6 s, green, gone | Says what actually happened | same |
| Error | 91×30 with a red edge | CSS | Amber edge, plain words: "Didn't catch that" | The words are in the pill, not a separate toast | same |
| No mic | Toast "We're not hearing anything" after a wait; escalates | strings `no_audio_during_dictation_*` | "Not hearing your mic" in the pill after 4 s of a dead level, turn stays open | Told in place while still listening. Only while a wake turn is open; dictation has no live level unless the wake loop is on | same |
| Reconnecting | Tooltip "Still listening · Reconnecting…" | string | "Reconnecting your mic" | Raised even with no turn running | error style |
| Muted | Not applicable (hold to talk) | | Muted, red dots, 1.6 s, then the tray dot stays red | Confirms the key without leaving a thing on screen | same |
| Position | Bottom, left or right edge by drag; follows the cursor's display | help "Move and Dock the Flow Bar", CSS `data-bar-position` | Fixed above the taskbar on the cursor's display, 44 px up, or top, from the tray | Sits clear of Wispr's own bar so both can run; no drag means no mis-drag. Left and right edges are not offered | |
| Sounds | Start, stop, paste, error, success samples | media files, measured | Three synthesised sounds, wake, end, error, 0.2 s, warm, tray toggle, on by default | Made in the page, no files. Measured against wake models and VAD: D112 | |
| Hide | "Hide for 1 hour", permanent off | strings | Hidden at rest already | Nothing to hide | |
| Reduced motion | Bars stop wobbling | CSS | Bars keep following level but drop the wobble and the sweep; pointer jumps, labels appear whole | Same respect, and the pointer and card too | |
| Nudges | "Hold … to dictate" prompts | strings | None | Not adopted: Baton does not coach him | |

Not captured: Wispr's live processing, error and no-mic pills. They exist in the CSS and strings
above, but no frame of them was taken, because the one automated capture failed (screen off) and takeovers are paused. To capture
them he would hold Ctrl+Win for 3 s saying nothing (error and no-mic) and then dictate one sentence
with a screen recorder running (processing, success). About a minute.
