# The spine: one assistant, one overlay, one card family, one gate (2026-11-02)

The Director asked what teach mode adds over the screen reading, pointing and spoken cards built earlier, and wanted no duplicates,
no regressions, and one spine with memory and tools. This is the reconciliation, read from the code. The matrix test is
`apps/desktop/src/baton/screen/spine.test.ts`.

## 1. Inventory (what exists, where, who calls it)

| Capability                                | Lives in                                                                                                    | Called by                                                              | Shows                                                                                  | Asks / gate                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| See the screen (shots, fingerprint)       | `screen/screenCapture.ts`, `ScreenCompanion.capture`                                                        | look, teach, drive (router); `screen_capture` tool (assistant)         | nothing (overlay hidden for the shot: `overlay.hiddenFor`)                             | capture-consent box via `approveCapture` (Allow / for an hour / always / Not now)    |
| Read controls (accessibility tree)        | sidecar `ui_tree`, `agent/batonTools.ts`                                                                    | `ui_tree`, `click_element`, `wait_for` tools; `locate` for the pointer | nothing                                                                                | same consent                                                                         |
| Answer with a spoken card (look / answer) | `ScreenCompanion.answerTurn`, `linger`, `pointerOverlay.card`                                               | router `answer`/`look`; assistant's closing line (`linger`)            | card beside the pointer, timer bar, pages                                              | none (words only)                                                                    |
| Point at a thing                          | `ScreenCompanion.pointAt` -> `pointerOverlay.point`                                                         | router look/teach; **now also the `point_at` tool**                    | pointer, ring or dashed box, badge, label                                              | none                                                                                 |
| Teach (one step at a time, watched)       | `ScreenCompanion.teach/teachStep/watch` (a machine)                                                         | router `teach`; **now also `teach_start`**                             | step card (Step n, waiting for you, Say it again / Skip / Stop), finished card, bubble | capture consent once                                                                 |
| Drive (a plan he approves, then input)    | `ScreenCompanion.drive`, `runDrivePlan`, `inputDriver.ts`                                                   | router `drive`; **now also `drive_start`**                             | numbered markers, the pill ("Driving"), amber or green end card, Stop button           | consent, then one "Want me to ...?" box (Go ahead / Not now); Esc, Stop, spoken stop |
| Act by tools (see-act-check)              | `agent/batonTools.ts` (click, click_element, type_text, press_keys, scroll, drag, wait_for), `agentGate.ts` | the one assistant (`agentTurn`)                                        | the pill; the end line as a card                                                       | `judgeToolCall` inside every tool; a Go ahead / Not now box when it says ask         |
| Operate (a coding CLI as hands)           | `screen/codexOperator.ts`, `claudeVision.ts`, router `operate`                                              | router only                                                            | card                                                                                   | `harnessGate` (the same `judgeToolCall`)                                             |
| Jobs, weaves, approvals, vault, memory    | `batonTools.ts` tools; `home/*`; `agent/*`                                                                  | the one assistant; Home                                                | cards, Home                                                                            | same gate; vault values are scrubbed before any card (`vaultHost.scrub`)             |
| Narrate                                   | `say` -> speaker; `stepLine` (one short sentence)                                                           | teach, drive, assistant stream                                         | the same words on the card                                                             | `speak` setting, written-only mode                                                   |
| Cues                                      | `input.onCue` -> `voice.cue` -> pill (five sounds), the listening cues                                      | teach, drive                                                           | none                                                                                   | one setting, `v.cues` (Off, Quiet, Normal)                                           |
| Windows                                   | `pointerOverlay.ts` (click-through, one per display), `companionWindows.ts` (ask box, prompt, Stop), pill   | all of the above                                                       |                                                                                        |                                                                                      |

## 2. Old thing -> new teach-mode element

| Old                                | New (teach-mode build)                                                  | Verdict                                             |
| ---------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| 20 x 22 blue arrow                 | 24 x 26 dye pointer, trail, travel                                      | **Replaced**, same code path (`fly`)                |
| 44 px ring, label pill             | ring or dashed box sized to the control, badge, caption                 | **Extends** (`mark` takes the real size when known) |
| "Step 2 of 4" drive card, Esc line | step card with progress bars, upcoming steps, buttons; drive = the pill | **Replaced**                                        |
| Plan box "Run it / Cancel"         | one approval wording, Go ahead / Not now                                | **Replaced** (all asks use `askHandsFree`)          |
| Capture-consent box (four buttons) | unchanged on purpose: a different decision (how long), not an approval  | **Kept**, same window family                        |
| Answer card beside the pointer     | same card, same document                                                | **Kept**, extended with `state` and `actions`       |
| Confirmation box / gate ask        | same `windows.ask`                                                      | **Kept**, one family                                |
| Ask box                            | unchanged                                                               | **Kept**                                            |

## 3. Duplicates found, and the decision

1. **Teach, drive and point were unreachable by natural language with the one assistant on (the default).** The assistant had no tool for them, and his own `teach:` / `drive:` prefixes were swallowed by it as well. Only the fallback router or a setting reached them. **Fixed in this PR**: prefixes and lesson controls route to the modes first (`entryRoute`, tested); `point_at`, `teach_start`, `drive_start` are tools of the one assistant, so "teach me how to..." and "where is the export button" reach the same machines. The tools return at once and tell the assistant to say nothing more; its closing line no longer replaces a lesson's card (`runningMode()` check).
2. **Two step planners**: the scripted teach and drive loops, and the assistant's see-act-check. Decision: keep both, they do different jobs. Teach waits for him and watches the screen settle (a state machine, not a model loop); drive shows a whole plan he approves first. The assistant's loop stays for quick actions it can do itself, each call gated. They are now reached as one: the assistant picks `teach_start`, `drive_start` or its own tools. No third planner is added.
3. **Two confirmation systems**: the plan box and the operator gate's ask. Already one: both go through `askHandsFree` -> `windows.ask` (box plus the same question aloud). One wording (Go ahead / Not now). The matrix test fails if a system dialog appears in `screen/` or `agent/`. Outlier: the update prompt in `startBatonDesktop.ts` uses `Electron.dialog`; move to `windows.ask` (next PR).
4. **Two overlay documents**: `pointerOverlay` (click-through) and `companionWindows` (takes focus, for typing and clicking). Not mergeable (a window cannot be both), so the rule is: these two only, and the test fails on a third `BrowserWindow` in `screen/`. `vocabToast.ts` is a third toast: fold into the card family later.
5. **Two sets of cues**: the listening cues and the lesson cues. One path (companion reports, pill plays, `v.cues` governs). Test guards against a second audio path in the companion.
6. **The older router** (`routed`, `decideSaid`, `fallbackDecision`): kept only as the fallback when the assistant fails or is off. **Deprecated; deletion date 2026-12-15**, once `teach_start`, `drive_start`, `point_at` and `operate` as a tool have run for a month without the fallback firing (`agent_fallback` notes in the turn log say how often).

7. **Dead wiring found by lint**: the `browser_route` and `browser_accessibility_on` tools had no host methods in the companion (the browser-route commit added the imports and state but never the implementation), so both answered "not available here". Wired now (route choice from the real Chrome check, a Go ahead / Not now box before restarting Chrome). Also removed a dead `runTransform` (transforms run through the `jobs` host, `DesktopBatonVoice`).

## 4. How the rest plugs into the same pipeline

- **Memory.** The assistant's `recall`/`learn` run on every turn; lessons and drives write a `drive_outcome` note. Next: a lesson that finished records "how he likes X" as a memory item the next teach turn reads ("I remember you prefer 16 pt"), through `memory_remember`, not a new store.
- **Vault.** Cards and speech go through `vaultHost.scrub`; a step card never shows a secret, and a teach step that would need one says "I'll use the vault" and asks.
- **Awareness.** The active app is the `focus` the companion takes at the sentence (`focusSoon`) and the `presence` line; the lesson prompt gets the window title only when titles are allowed.
- **Commitments, trust log.** `onAction` and `onTrace` write each drive and lesson turn to the turn log; "I'll set it back" is a commitment (`commit_add`) when he asks.
- **Cue settings, accessibility.** One cue setting; Esc is Stop everywhere (`holdEscape`); reduced motion in the overlay page; the same words on card and voice.
- **Woad tokens.** `--tz-dye`, `--tz-glow`, `--tz-ink` in the overlay page; companion windows use `companionStyle.ts`. Builder B's palette lands in those two places.

8. **Update prompt and vocabulary toast: decided, not folded.** The "this version failed to start twice" prompt (`startBatonDesktop.ts`) is a system dialog on purpose: it runs when the app is crash-looping, before the companion's windows exist, and must not depend on them. It is the one allowed exception (the matrix scans `screen/` and `agent/` only). The vocabulary toast is a non-focus, six-second notice with Keep or Discard; as a `windows.ask` it would take focus and hold the prompt queue for a minute, so it stays a toast and shares the pill's look.
9. **One stack at the bottom.** Cards and prompts clear the pill by one shared constant (`CARD_ABOVE_WORK_AREA`); the Planning card is cleared while the plan box is up.
10. **An approved plan covers its own keys.** `shellCheck` no longer asks again for keys that follow the plan's own click; keys with no click before them, and shell-looking text, still ask.

## 5. Regression matrix

`spine.test.ts` asserts: (a) each entry sentence (voice, typed, hotkey and tray all arrive as a sentence) reaches the same mode with the assistant on and off; (b) the older router still reaches every mode as the fallback; (c) every tool is in the gate's table and seeing, pointing and the two guided modes are allowed only because each asks where it runs, while acting is judged; (d) only two window-making files exist in `screen/`; no system dialog in `screen/` or `agent/`; Go ahead / Not now is the question family; no second audio path. Replay fixtures: the existing `screen/*.test.ts` (operator proof, screen parts, escape, pointer overlay) keep running beside it.

## 6. Refactor order (small PRs behind the matrix)

1. This PR: the reachability fix, the three tools, `entryRoute`, the matrix, this page.
2. The update prompt and the vocab toast onto `windows.ask` and the card.
3. Done: the Windows proof run (`baton-teach-proof.yml`, with the UI Automation sidecar, cue playback logged). Still to do: drive it through the tools path instead of only the prefixes.
4. Delete the router on the date above if the fallback has not fired.

## 7. A session started from the app, and the app crashing

On a machine with no Herdr (Windows) a New session is a T3 thread: the Claude Agent SDK runs as a child of the T3 server, and the server lives inside the desktop app. When the app dies, the session dies with it; its transcript is kept in the Claude config directory, so it can be resumed (Sessions > Resume) after a restart. Making a session outlive the app would need the server and its agents detached from the app (a service), which is a separate piece of work. Where Herdr exists (Linux, macOS) the session is a Herdr pane and does survive.

The 0.1.45 crash (`xa11y...node_unloaded`, access violation) was the foreground-focus helper: T3 ran the native accessibility module in a worker and, after a one-second timeout, terminated the worker while a native call was still in flight. A slow call (the window busy starting a thread) therefore unloaded the module under itself. The worker is no longer terminated: a slow one is left to finish and its late answer is ignored (patch 0007).
