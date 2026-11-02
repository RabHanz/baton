# Teach and drive mode: research, current state, target design (step 1, no code)

Director's brief: the teaching mode "like hey clicky" must be impeccable: better cues, annotations and screen actions, and a better UI
for cards, speech dialogs, step cards and pointers. This is step 1. Step 2 builds it in small PRs after he has seen this.

**Read first (already in the repo, not redone):** `clicky-2026-10-27/` (open-source repos, licences),
`clicky-videos-2026-10-27/` (six HeyClicky videos, scene breakdowns, frames), and `/mnt/HC_Volume_106652742/dev/BATON-ASSISTANT-RESEARCH-2026-11-01.md`.
This note adds only what was missing: Windows release notes, one open-source clone, and a design.

## 1. What the others do

|                     | HeyClicky (paid; Mac, Windows from 1.1.1)                                                                                                                                                      | OpenClicky (MIT, Mac)                                                                                                       | Tessaya today                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Pointer             | small solid triangle, a separate sprite beside the real cursor; yellow/orange, red when teaching, green when an agent is done; flies to the target; the real cursor is never moved to guide    | "the triangle zips to the target, shows the caption, and returns to the real pointer"; secondary markers for several points | blue arrow, 20 x 22 px, glow, fades in 0.22 s                                                                               |
| Highlight           | glowing dashed outline round an area, hand-drawn shapes (squares, arrows, ellipses), a spatial paint trail for what the user means                                                             | caption near a coordinate; area overlays only in a skill                                                                    | one pulsing ring (44 px, 1.5 s, twice), numbered dots for a drive plan                                                      |
| Labels              | rounded pill, a few words ("kick step five", "area 9"); the full sentence is spoken                                                                                                            | caption text at a point                                                                                                     | blue pill with the control's name                                                                                           |
| Step cards          | one target per step, waits for the user's click, detects it, moves on; cream explanation cards                                                                                                 | none described                                                                                                              | a dark card, "Step n of N" and dots, the step's text (often two sentences), "Do it and I'll notice, or say next"            |
| Approval            | one dark card from the notch: one-sentence plan, "You watch. Esc takes it back.", **Go ahead / Not now**                                                                                       | none described                                                                                                              | boxes titled differently per mode: "Run it / Cancel", "Do it / Not now", "Allow for this drive / an hour / always / Cancel" |
| Narration           | first person, one action per line, while driving; "teach while driving"                                                                                                                        | `/speak`                                                                                                                    | spoken text is the card text, which can be long                                                                             |
| Errors              | Windows 1.1.2: if it cannot run on a PC it says why and offers "Email us"; 1.1.4: a brief database error no longer shows raw, it recovers                                                      | not documented                                                                                                              | the error text goes to the card and the voice                                                                               |
| Taking control back | Esc, mouse movement, speech; 1.1.2: typing stops as soon as you take the screen back; 1.1.4: a drive no longer ends the moment it starts when the pointer leaves the "Let Clicky drive" button | none described                                                                                                              | Esc, "stop", mouse move (mouse guard, D115)                                                                                 |
| Cues                | chime on the talk key (1.1.4 fixed a distorted one); captions while it talks                                                                                                                   | none described                                                                                                              | pill sounds for listening; nothing for step done or error                                                                   |

Sources read 2026-11-03: heyclicky.com/changelog (v1.1.1 to 1.1.4, Windows), github.com/jasonkneen/OpenClicky (README). A third comparable (Whatfix
flows, a digital-adoption overlay) was tried and its public page gives only an index, so it is not used; what to take from that product
class (beacon, tooltip, progress, skip) is already in the HeyClicky frames below. Nothing here comes from running a competitor's app.

**Lessons that matter for Windows:** a drive that ends the moment it starts because of where the pointer was; typing that continues after
the user takes back; raw errors on the card. Each is a bug class to test for, not a feature.

## 2. The frames I rely on (captions; all open in the repo)

HeyClicky (`clicky-videos-2026-10-27/frames/`):

- `01-launch-46m-drive-approval-prompt.png`: the approval: one sentence, "You watch. Esc takes it back.", two buttons only. **Take:** one card, two buttons, the way out in the second line.
- `02-launch-49m-drive-davinci-narrating.png` and `03-launch-52m-drive-ableton-teaching.png`: the driving pill at the top: "driving", the current narrated step, "esc to take it back". **Take:** a small pill, not a card, while it acts.
- `11-draw-95s-flstudio-step.png` and `12-draw-95s-flstudio-step-label-zoom.png`: a dashed glowing outline round the channel rack and a pill label "kick step five" beside the real pointer, with the same words spoken. **Take:** area outline plus a few-word label; speech matches.
- `09-draw-50s-pythagoras-overlay.png` and `10-draw-50s-pythagoras-labels-zoom.png`: shapes and pill labels drawn on a page. **Take:** labels are short; the sentence is spoken.
- `13-spatial-54s-agent-done-bubble.png`: a done bubble anchored to a green pointer at the spot that changed. **Take:** done is shown where the change is.
- `07-launch-11m-guide-linkedin-pointer.png` and `14-spatial-62s-user-hover-trail.png`: the pointer flying to a menu; a paint trail for "this thing". **Take:** travel is visible; the user can point back.
- `04`, `05` (agent cards with plans and progress) and `16` (memory: "it remembers what it saw"): for jobs, not for teaching.

Tessaya today (`../frames/companion-2026-10-31/` and `../frames/screen-companion-2026-10-27/`):

- `baton-card-dark.png`: the answer card beside the pointer: a blue arrow, a blue label pill ("Export"), a 560 px card, a timer bar on its bottom edge.
- `baton-drive-photo.png`: numbered dots for a drive plan (done green, now blue with a halo, next blue) and a step card "Step 2 of 4 / Click: open the File menu / Esc stops it."
- `02-teach-step-1.jpg`: teach step 1 on a real form: the card carries two sentences and a hint line; the label is "name field".
- `baton-pill-states-dark.png`, `baton-prompt-dark.png`, `baton-ask-dark.png`: the pill states, the confirmation box, the ask box.
- `05-drive-plan-awaiting-approval.jpg` and `dialogs.txt`: the plan box ("Run it / Cancel") and the capture-consent box (four buttons).

## 3. Current state: sizes, timings, problems

From `apps/desktop/src/baton/screen/pointerOverlay.ts` and `companionWindows.ts`, and the frames above. (A fresh capture on a Windows
desktop belongs to the step 2 proof run, below; the frames above are from the real overlay documents.)

| Element       | Today                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Pointer       | arrow 20 x 22 px, blue, glow; fades in 0.22 s; moves by animation frames                                        |
| Ring          | 44 px circle, 2 px blue, 1.5 s expanding pulse, repeated twice                                                  |
| Label         | blue pill, 13 px bold, pops in 0.26 s                                                                           |
| Card          | 560 px (400 px beside the pointer), 15 px text, line height 1.48, fades 0.2 s, moves 0.28 s; a bottom timer bar |
| Step card     | "Step n of N" and dots, the step text, a hint line; no Skip, no Say it again, no upcoming steps                 |
| Confirmations | three different wordings and button sets; the way out is in the body text                                       |
| Spoken line   | the card text, so a long step is a long speech                                                                  |
| Done          | the card fades; no mark at the spot that changed                                                                |
| Errors        | text on the card; nothing shows where it looked                                                                 |
| Cues          | none for a step done, waiting, error or finished                                                                |

Problems, in order of what a user feels: (1) one blue for everything, so pointer, label, ring and card do not say what kind of thing they are;
(2) the step text is too long to read at a glance and too long to speak; (3) the user cannot see what comes next or skip; (4) three
confirmation styles; (5) no cue that it is waiting for them or that something went wrong; (6) a ring that is a small circle, not sized to the control.

## 4. Target design

Frames (1280 x 800, rendered from `teach-mode-2026-11-02/mockups/*.html`; the app shown is a stand-in for the Notepad font-size task the
proof run will use):

| Frame                  | Shows                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-approval.png`      | one approval card from the top centre: one sentence, "You watch. Esc takes it back.", **Go ahead / Not now**. The same for teach and drive.                           |
| `02-step1-pointer.png` | pointer travelling (faint trail), two-tone ring sized to the control, numbered badge, few-word caption, step card with the current step large and the next ones small |
| `03-step3-box.png`     | a dashed box for a field or area, badge and caption                                                                                                                   |
| `04-waiting.png`       | waiting for the user: the card says so, one soft pulse                                                                                                                |
| `05-not-found.png`     | error in plain words, where it looked (outlined), Look again / Skip / Stop                                                                                            |
| `06-done.png`          | done bubble at the spot that changed, with how to undo; card shows the summary                                                                                        |
| `07-drive-pill.png`    | while driving: a small pill at the top with the current step and the way out                                                                                          |

**Pointer and highlight system.**

- _Pointer:_ one solid triangle in the Woad dye (#14505A) with a white edge and a soft glow (#5FB3B3), 24 x 26 px. It travels to the control in
  250 to 450 ms by distance (ease-out), leaving a faint trail that fades in 400 ms; the real cursor is never moved to guide. When it is
  driving (not guiding) it is the same pointer plus the pill at the top; the real cursor moves with the click.
- _Ring (buttons, menu items, icons):_ sized to the control's bounds from the accessibility tree plus 4 px, two-tone (2 px white inside, 2 px near-black #0B2A30 outside) so it reads on light and dark backgrounds; the teal glow is only decoration. Appears after the pointer lands.
- _Box (fields, panes, areas):_ the same two tones, dashed, the control's bounds; used when the target is a region or a text field.
- _Badge:_ a numbered circle on the corner, the step's number, dye fill, white digits, white ring.
- _Caption:_ a pill of three words or fewer ("Format menu", "Size: 16"), dye fill with white text (contrast 9.0:1), beside the control, never over it.
- _Where it cannot be found:_ the searched region is outlined in amber and the card says so. Nothing is drawn at a guess.

**Step cards.** One card, bottom centre, 600 px wide: kicker ("Step 2 of 4"), progress bars (done in teal, now in white), the current step
large (20 px, at most one short sentence, the same words spoken), a hint line, the next steps small in one line, and three buttons: **Say it
again**, **Skip**, **Stop** (Esc is Stop). While it waits for the user the kicker says "waiting for you". An error turns the card's edge amber and
the buttons become **Look again / Skip / Stop**; finished turns the edge green and offers **Show another / Close**. When driving, the
card is replaced by a small pill (frame 07) because the user should be watching the screen, not reading.

**Speech.** The spoken line is the card's current-step sentence, nothing else: "Open the Format menu." At most twelve words, first person while driving ("I'll open the Format menu"), imperative while teaching. The detailed explanation is on the card only when
the user asks ("why?") and is not read aloud unless asked.

**Cues** (all short, quiet, off with the sound setting; each fires once, never in a loop): _start_ a rising two-note; _step done_ a soft tick plus a 150 ms ring flash; _waiting for you_ one soft pulse on the ring and a low note, after 6 s of no action a gentle repeat once; _error_ a falling two-note and the amber card; _finished_ a three-note resolve, the green bubble. The visual cue always comes with the sound, so nothing depends on hearing.

**Accessibility.** Esc is Stop everywhere and works when the card has no focus (a global key for the length of a lesson); "stop" by voice; moving the mouse during a drive takes it back. Reduced motion (the OS setting): no travel animation (the pointer jumps), no pulse, the ring simply appears; nothing else changes. Contrast: captions and badges at 9:1 or better; ring edges are white and near-black, which read on any background; the teal accent (#5FB3B3) is 2.45:1 on white, so it is never the only carrier of meaning. Text sizes are 13 px or more and scale with the system text size. The card is reachable by screen readers as a status region ("Step 2 of 4: open the Format menu").

**Performance budget.** No continuous repaint: animation runs only during a travel (at most 450 ms) and one pulse; an idle step draws nothing; transforms and opacity only (no layout animation); one overlay window per display, one card, at most two markers; the overlay never polls. Target: the overlay adds under 1 ms per frame while a step is idle and drops no frame during a travel on the laptop's integrated graphics; checked in the proof run's recording and the overlay's own timeline (`overlayLab`).

**Palette and logo.** Tokens are named, not hard-coded, so B's palette work lands in one place: `--tz-dye` (#14505A), `--tz-glow` (#5FB3B3), `--tz-ink` (#0B2A30), `--tz-ok`, `--tz-warn`; the new logo mark shows at 16 px at the card's top-left and on the pill. I have not touched the logo or the palette; the mockups use placeholders for the mark.

**What stays as it is:** the gate (every click still goes through it, Esc/stop/mouse take it back at once, capture consent), the mouse guard (D115), and the model's role (it chooses steps; code draws and checks).

## 5. Step 2: how it will be built and proved

Small PRs, each green before merge: (1) one approval card for teach and drive, with the two buttons; (2) pointer, ring, box, badge and caption from the control's real bounds (`ui_tree` rectangles, the screenshot only when the tree has none); (3) the step card with upcoming steps and Say it again / Skip / Stop; (4) the cues and reduced motion; (5) errors and the done bubble; (6) spoken lines kept to the step sentence.

**Replayable proof** on the CI Windows desktop: a scripted planner runs "show me how to change the Notepad font size" through the real overlay (Electron on the runner, overlays visible to capture through `BATON_TEST_DIR`, #170), recorded as an mp4 with a six-frame contact sheet by the recorder already in the hands-loop job (#175), plus the overlay timeline for the frame-timing numbers.

## 6. Not done here

No code. No fresh capture of the running overlays (the frames above are from earlier runs of the real overlay documents; the proof run replaces them). Whatfix and other digital-adoption products were not studied beyond their public index pages. The target sounds are described, not yet composed. The numbers in the performance budget are targets, not measurements.
