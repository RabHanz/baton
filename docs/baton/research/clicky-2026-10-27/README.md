# Clicky and its forks: what they are and what Baton should take from them

retrieved_at: 2026-10-27 · consumer: Baton desktop voice (spec §12–§15, §18, §21; D24, D66) · refresh: quarterly, or before any Baton work that captures the screen or moves the pointer · breaking-change severity: low (nothing in Baton depends on these repos)

The Director asked whether Clicky could help Baton. Restated as one question: **should Baton adopt Clicky, borrow from it, route to it, or skip it, given spec §12–§18 and the rule that existing maintained projects win where they overlap?**

## Sources (all fetched 2026-10-27, pinned to a commit)

| Repo | Commit read | Stars / open issues | Last push | Language | Licence |
| --- | --- | --- | --- | --- | --- |
| [farzaa/clicky](https://github.com/farzaa/clicky) | `a80fa80721a8` (2026-04-27) | 7,790 / 91 | 2026-04-28 | Swift | MIT, © 2026 Farza |
| [jasonkneen/openclicky](https://github.com/jasonkneen/openclicky) | `e9eb06a29ff5` (2026-09-02) | 570 / 17 | 2026-09-05 | Swift | MIT, © 2026 Jason Kneen |
| [Bitshank-2338/clicky-windows](https://github.com/Bitshank-2338/clicky-windows) | `6c6216b7f80a` (2026-10-26) | 283 / 2 | 2026-10-26 | Python | MIT, © 2026 Shashank Singh |
| [tekram/clicky-windows](https://github.com/tekram/clicky-windows) (found in farzaa/clicky#26) | HEAD README only | 60 | 2026-04-23 | TypeScript (Electron) | MIT |

Verbatim copies of each README, LICENSE and notice file are in `snapshots/`, each headed with its raw URL at the pinned commit. Repo metadata came from `api.github.com/repos/<repo>` the same day. Frames from the two demo GIFs are in `frames/`: I looked at them, I did not take a description's word for them. Other sources: `https://www.heyclicky.com/` (fetched through a page reader, so treat its wording as close but not raw) and `https://pypi.org/pypi/PyQt6/json`.

## 1. What each one is

**farzaa/clicky is the original, and its public code is frozen.** The README opens:

> "Update: April 27, 2026. … The existing codebase remains open source. Tinker with it, make it yours, start a company out of it, do whatever you want I don't mind. But, for all the new stuff I'm hacking on, gonna keep it private. To get the latest Clicky, you can go [here](https://www.heyclicky.com/)."

It is a macOS 14.2+ menu-bar app. From `AGENTS.md`:

> "Uses push-to-talk (ctrl+option) to capture voice input, transcribes it via AssemblyAI streaming, and sends the transcript + a screenshot of the user's screen to Claude. Claude responds with text (streamed via SSE) and voice (ElevenLabs TTS). A blue cursor overlay can fly to and point at UI elements Claude references on any connected monitor."

> "**Element Pointing**: Claude embeds `[POINT:x,y:label:screenN]` tags in responses. The overlay parses these, maps coordinates to the correct monitor, and animates the blue cursor along a bezier arc to the target."

- Screen: ScreenCaptureKit, every monitor, captured only when the hotkey is pressed.
- Voice in: push-to-talk only (no wake word). AssemblyAI `u3-rt-pro` streaming, with OpenAI upload and Apple Speech as fallbacks.
- Voice out: ElevenLabs `eleven_flash_v2_5`.
- Models: Claude Sonnet 4.6 by default, Opus 4.6 optional. `ElementLocationDetector.swift` also calls the `computer_20251124` tool with the `computer-use-2025-11-24` beta header.
- Acting: none. It points and talks, and never clicks.
- Cost and privacy: three metered API keys (Anthropic, AssemblyAI, ElevenLabs) behind a Cloudflare Worker you deploy yourself. Screenshots go to Anthropic. PostHog analytics are built in.
- Maturity: a demo. 20 commits, no push since April, and the 91 open issues are mostly requests for a Windows build, a Linux build and "use my own Claude Code" (issue titles read 2026-10-27).
- Frames 01–02: the blue triangle sits beside the real pointer while the author talks over Xcode. That is the whole visual idea.

The hosted product, quoting heyclicky.com: "heyclicky runs on mac (sonoma 14.2 or higher) and on windows 10 or higher"; it "runs agents to do tasks for you"; Free $0, Pro "$20 per month", Max "$100 per month"; "we only see your screen when you press the hotkey, and screenshots are never stored". It is closed source.

**jasonkneen/openclicky is a much larger macOS fork.** It adds:

- Codex agents (`[TYPE:x,y]` tags, child workers).
- Computer use through a bundled cua-driver subset (MIT, credited in `THIRD_PARTY_NOTICES.md`) and a bundled `BackgroundComputerUse.app` that carries no licence file.
- Composio MCP, gogcli for Google, and Sparkle updates.
- A local control bridge:

> "OpenClicky exposes a local-only control bridge for agents and other trusted local apps: `http://127.0.0.1:32123` … `POST /cursor` … `POST /caption` … `POST /screenshot` … `POST /speak` … `GET /events`"

The repo's own `OPENCLICKY_ARCHITECTURE_REVIEW.md` says `CompanionManager.swift` is "17,194 lines", that clicks always warp the real cursor whatever backend is selected, and that the realtime model's routing decision is "discarded" and re-run through "100%-regex" guards. Open issues include "restore bridge auth end-to-end". It is rich but tangled, and macOS only.

**Bitshank-2338/clicky-windows is the one that runs on the Director's laptop.** It is a Python 3.11+ and PyQt6 port for Windows 10/11, and the most actively maintained of the three (release 1.6 preview, pushed 2026-10-26, CI on Windows). Its features:

- Push-to-talk (Ctrl+Win), plus an optional "Clicky" wake word.
- Models: Claude, OpenAI, Gemini, GitHub Copilot, and fully offline through Ollama (`qwen2.5vl:3b`) or LM Studio.
- Speech in: Deepgram, OpenAI, whisper.cpp or faster-whisper. Speech out: ElevenLabs, OpenAI, Edge or Windows SAPI.
- Pointing: a "two-stage grid locator" (12×8 grid, then 6×6 inside the chosen cell) that works with any vision model, plus Claude computer use.
- On-screen drawing: `[ARROW]`, `[CIRCLE]`, `[UNDERLINE]` and `[LABEL]` tags.
- A Privacy Guard that skips or redacts screenshots of password-manager and banking windows.
- **Clicky Drive**, which acts on the screen. From RELEASE-NOTES-1.6:

> "the model proposes bounded desktop actions. You review a readable plan before input starts. Coordinates are tied to the captured display; expired/changed screens are rejected. Esc cancels; unexpected mouse movement stops the next action; held inputs are released on cancellation. Typing refuses protected/unverifiable fields. No model-generated shell code is executed."

Its wake word is weak. `audio/ambient_listener.py` transcribes each speech segment with a small Whisper model and string-matches the text (`if any(w in text for w in WAKE_WORDS)`). The notes say this still needs live testing: "real microphone/Bluetooth devices, mixed-DPI hardware … Local Whisper remains batch recognition". Its only inbound local service is the browser-extension bridge; nothing outside the app can tell it to point or speak. Frames 03–04 show the buddy flying to a YouTube search suggestion on Windows 11.

**Latency:** none of the repos publishes end-to-end numbers. The only figure is clicky-windows' "qwen2.5vl:3b answered in about 2 seconds on CPU".

## 2. Licences

All four are MIT, so copying code into Baton, adapting it or depending on it is allowed as long as the copyright notice comes with it. The catches are in their dependencies:

- **clicky-windows depends on PyQt6, which is GPL v3.** PyPI, 2026-10-27: `license_expression: GPL-3.0-only`, and "PyQt6 is released under the GPL v3 license and under a commercial license that allows for the development of proprietary applications." Shipping clicky-windows' Qt code inside Baton would pull GPL into an MIT tree that may go commercial. That is the D4 (Herdr/AGPL) problem again. Its Qt-free modules (`drive.py`'s plan validator, the coordinate maths in `ai/element_locator.py`, the privacy title list) are plain MIT and can be ported. Running it as a separate program the user installs is also fine.
- **openclicky** bundles `BackgroundComputerUse.app` with no licence file. Treat that binary as unlicensed. Its own source and the cua-derived code are MIT.
- **farzaa/clicky**: MIT with no catches. The private heyclicky.com code is not available.

## 3. Fit with Baton, item by item

Baton today (`docs/baton/VOICE.md`, `STATUS.md`, D24/D66, read at origin/main 2026-10-27):

- Wake → VAD → speech-to-text → §12.3 mode machine → `fabric.intent.*` → spoken reply, built from openWakeWord "hey jarvis", Silero VAD, whisper.cpp and OS text-to-speech.
- Proven on recorded WAVs only, not yet on Windows or with the DJI mic.
- Context bus and injection adapters built.
- Desktop is Electron 44.

| Spec item | Clicky family | Baton | Verdict |
| --- | --- | --- | --- |
| §12.1 mic choice, pinning, fallback | clicky-windows saves the mic by name and driver, falls back to the default with a notice, and has a 3-second level test | `listDevices` / `selectDevice`, unknown id falls back to the default | Baton has it. Borrow the level test and save-by-name idea for the DJI receiver |
| §12.2 wake / VAD / STT | farzaa: push-to-talk only. clicky-windows: Whisper-transcript wake word | openWakeWord + Silero + whisper.cpp | **Baton is ahead. Do not swap** |
| §12.2 spoken reply | ElevenLabs / Edge / SAPI. clicky-windows starts speaking each finished sentence while the answer is still streaming | OS text-to-speech after the outcome | Borrow sentence-by-sentence speech for long replies |
| §12.3 modes, §13 intents, §24 risk gates | None. Regex or tag routing, no conversation window, no direct-session mode | Built (pure reducer, confirm-later for medium risk) | **Baton is ahead. They conflict with Clicky's "the model decides" routing** |
| §14 destination awareness | Per-app memory keyed on window title; "Code Mode" from IDE titles | Context bus + §14 ladder | Overlap. Baton's is the deterministic one |
| **Screen awareness ("what's this error?")** | **The core feature**: a screenshot on the hotkey, sent with the question | **Missing.** §15/§17 ask for focus *metadata*, and §17 says "Do not stream arbitrary page content into Fabric by default" | **A real gap, and Clicky's main lesson** |
| **Pointing / "show it"** | `[POINT:x,y:label:screenN]` → transparent overlay flies along a bezier arc; grid locator for any model | §21 "show" focuses a *session*; nothing points at the screen | **A real gap; the tag protocol is a cheap technique to borrow** |
| **Acting on the desktop** | clicky-windows Drive (bounded, previewed, Esc, refuses password fields); openclicky computer use (warps the cursor, per its own review) | §18 text injection only; high-risk voice is refused | Borrow Drive's *gate shape* only if acting is ever wanted; it would be R3 |
| Phase 6 dictation | clicky-windows: hold-to-dictate into a verified, non-password field, otherwise show the text with Copy | Built (context bus, injection report) | Same idea. Borrow the "unverifiable focus → show and Copy" fallback |
| Airdeck (D64) | None | Baton side built | No overlap |
| "Hands-free, can be prompted" | Push-to-talk first everywhere; the hands-free wake word is optional and weak | Always listening is the design | Clicky does not move this goal forward |
| D1 subscription, not API | farzaa and openclicky need metered keys (Anthropic, AssemblyAI, ElevenLabs). clicky-windows can run on Ollama or Copilot | Uses the Director's Claude Code login | **Conflict. Baton must route screen questions through a subscription session, not Clicky's API calls** |

## 4. Recommendation: borrow two techniques, skip the components

Do not adopt or vendor any of them.

- farzaa and openclicky are macOS only. The Director's daily machine is Windows.
- clicky-windows is Python+Qt (GPL) beside an Electron app. It would be a second voice stack with a weaker wake word, a second hotkey, a second set of model keys and a second notion of target. That breaks "theirs wins" in the wrong direction, because Baton's voice core is the better one here.
- Routing to a separate Clicky process is not possible either: clicky-windows has no inbound control API, and openclicky's bridge is macOS only.

What to take:

1. **Screen as an explicit input.** Something like "hey jarvis, look at this" or a tray action takes a one-shot capture of the focused display with Electron `desktopCapturer`. It is never ambient, and it is skipped when the window title matches a password-manager or banking list (clicky-windows' Privacy Guard list). The image goes to the focused Claude Code session through the existing D73 file send, so the Director's subscription answers it, and the reply is spoken.
2. **The `[POINT:x,y:label:screenN]` tag plus a transparent click-through overlay** for "show me where", parsed on the desktop. Copy farzaa's prompt wording, under MIT with attribution. Use clicky-windows' grid locator only if the subscription model's raw coordinates turn out to be poor.

**Smallest first step, and what it proves.** Build only item 1 on the Windows laptop: one intent, `look`, that sends a screenshot to the focused session and reads the answer aloud. It needs no new vendor, no API key and no overlay. It shows whether a screen-aware question answered on his subscription through D73 is fast and useful enough to keep. If it is, item 2 follows. If he never uses it, Clicky's main idea did not fit how he works, and nothing else from it is worth taking.

## Claims

| # | Claim | Status | Confidence | Evidence (captured 2026-10-27) | Origin |
| --- | --- | --- | --- | --- | --- |
| C1 | All three repos are MIT | observed | high | `snapshots/*-LICENSE.txt`; GitHub API `license.spdx_id` | architecture |
| C2 | farzaa/clicky's public code is frozen; new work is private (heyclicky.com) | observed | high | `snapshots/farzaa-clicky-README.md` line 1–6; last push 2026-04-28 | architecture |
| C3 | farzaa/openclicky are macOS 14.2+ only | observed | high | both READMEs, "Requirements"/"Prerequisites" | architecture |
| C4 | clicky-windows depends on GPL-3.0 PyQt6 | observed | high | `snapshots/clicky-windows-requirements.txt`; pypi.org/pypi/PyQt6/json | architecture |
| C5 | clicky-windows' wake word is Whisper transcript string-matching | observed | high | `audio/ambient_listener.py` lines 37, 265–282 at `6c6216b` | architecture |
| C6 | clicky-windows has no inbound control API for other apps | observed | medium | grep for loopback servers found only `browser_bridge.py` and `collab.py` | architecture |
| C7 | openclicky clicks warp the real cursor whatever backend is selected; its routing discards the model's tool choice | reported | medium | `OPENCLICKY_ARCHITECTURE_REVIEW.md` §1 items 1, 3 (the repo's own review, not re-verified) | architecture |
| C8 | openclicky bundles `BackgroundComputerUse.app` with no licence file | observed | medium | `AppResources/OpenClicky/BackgroundComputerUseRuntime/` listing | architecture |
| C9 | HeyClicky (closed) supports Windows 10+, has $0/$20/$100 plans, and screenshots only on the hotkey | reported | medium | heyclicky.com via page reader | market-research |
| C10 | Baton has no screen capture for voice and no screen pointing | observed | high | origin/main `docs/baton/VOICE.md`, `STATUS.md`; spec §15/§17/§21 | architecture |
| C11 | Claude 5.x needs `computer_toolset_20260801` and rejects `computer_20251124` | reported | low | comment in clicky-windows `ai/element_locator.py` lines 36–39; not checked against Anthropic docs | architecture |
| C12 | Screen questions answered through a D73 file send on the subscription will be fast enough to use by voice | unknown | — | needs the first step above | model (hypothesis) |

## Contradictions

- clicky-windows' README advertises "Pixel-Perfect Pointing", while its own release notes list "mixed-DPI hardware" as untested and open issue "Buddy drifts far from the cursor on mixed-DPI multi-monitor setups (100% + 125%)". This matters only if its locator is ported. Trust the issue.
- openclicky's README says the bridge is "local-only" and "intentionally non-invasive", while its top open issue is "restore bridge auth end-to-end". Not load-bearing for Baton.

## Unknowns

- Real end-to-end latency for any of them. None is published, and measuring it needs a Mac or the Windows laptop.
- What the private HeyClicky code does differently, and its Windows build. Closed; it would need an install and an account.
- The licence of openclicky's `BackgroundComputerUse.app` (`xyz.dubdub.backgroundcomputeruse`).
- Whether a Claude Code subscription session's coordinates from an attached screenshot are accurate enough for `[POINT]` without the computer-use tool (C11/C12).
