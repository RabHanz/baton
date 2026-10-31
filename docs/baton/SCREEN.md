# Screen companion

Baton can see your screen when you ask, answer out loud, point at things, teach you an app step by
step, and do a task for you after you approve its plan. Design and the rejected options: D84.

## Using it

Three ways in, all the same feature:

- **Voice** (when Always listening is on): say a wake word, then "what's this error?"
- **Ctrl+Alt+Shift+B** opens the ask box. Type and press Enter; Esc closes it.
- **Tray**: "Ask Baton…".

What you say picks the mode:

| Say or type                                                                                            | Mode      | What happens                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "what's this error?", "look at my screen…", "where is the export button?", "look: …"                   | **Look**  | One screenshot of every display goes to Claude with your question. The answer is spoken and shown on a card, and the blue pointer flies to what it means. Follow-ups in the next five minutes remember the conversation.                                                              |
| "teach me how to …", "show me how to …", "walk me through …", "guide me", "… step by step", "teach: …" | **Teach** | One step at a time, each pointed at, with a word on why. Do the step and Baton notices (the screen changes and settles), checks it worked, and gives the next. Say "next" to move on yourself, "repeat" to hear it again, "stop" to end.                                              |
| "drive: …", "take over …", "do it for me", "open the downloads folder for me"                          | **Drive** | Claude proposes a plan. Numbered dots show where it will click and a box lists every step. Nothing happens until you press **Run it**. It then performs the plan, checks the screen after steps that should change something, and stops on **Esc**, "stop", or if you move the mouse. |

In the ask box anything that is not "teach" or "drive" is a Look question.

**How long things stay.** The pointer stays on its target and the card beside it until the narration
has finished and you have had time to read: at least 3 s after speech, more for long text, with a line
counting down. Long answers turn pages at sentence ends. Esc takes it all down, voice included. A
lesson's step stays until the step is done. Rules: D110.

**Spoken and written, or Written only.** From the tray (Answers) or the ask box, remembered. In Written
only nothing plays, and every answer, action, plan and step is on screen in full.

**Approval.** Every screenshot asks first: Allow (this question), Allow for this lesson or drive,
Allow for an hour, or Always allow. Turn "Always allow screen capture" on or off from the tray. A
drive plan always needs its own Run it, whatever that setting says. Screenshots go to Claude with
the request and are not saved.

**Your subscription, not the API.** Answers come from your own Claude Code (`claude`) signed in
to your plan. Baton strips `ANTHROPIC_API_KEY` from what it starts, so it can never bill the API.

## Against what HeyClicky claims

Their claims, verbatim and with frames: `research/clicky-videos-2026-10-27/`. These are the
vendor's own words; none of it was installed or measured.

| They claim                                                                                                             | Baton now                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Asks about anything on screen, by hotkey or voice, any app                                                             | **Has it** (Look; voice, ask box, tray)                                                                                                       |
| A triangle pointer flies to the target; the real cursor never moves while guiding                                      | **Has it** (farzaa's pointer and flight; the cursor only moves in Drive)                                                                     |
| Teach: step labels beside each target, speaks the step, notices you did it, gives the next                             | **Has it**, by watching the screen change rather than the click itself; label pill and step card                                             |
| Drive: one consent card, "Esc takes it back", narrates the current step, stops on mouse or speech, checks its own work | **Has it**, with the full plan listed and its clicks drawn before consent; Esc, "stop" or the mouse stop it; steps with `expect` are checked |
| Drawing arrows, circles, explanation cards, 3D models                                                                  | Partly: caption card and numbered dots; no free drawing or 3D                                                                                |
| "Spatial context": you paint on screen to show what you mean                                                           | Not built                                                                                                                                    |
| Agents in your own Chrome, routines by voice                                                                           | Not here: Baton's sessions and rules (Phases 4, 9) do this through Claude Code instead                                                       |
| Memory files (profile, recent screens hours back)                                                                      | Partly: a look conversation lasts five minutes, a lesson or drive its whole run; nothing kept across them                                    |
| Skill files per program                                                                                                | Not built                                                                                                                                    |
| Dictation, screen-aware                                                                                                | Dictation exists (Phase 6); not screen-aware                                                                                                 |
| Mac and Windows                                                                                                        | Windows and Linux; macOS capture and pointing should work, Drive refuses there                                                               |
| Free / $20 / $100 plans with message caps                                                                              | His own Claude subscription; no caps of Baton's                                                                                              |

## Settings

`baton-screen.json` in Baton's state directory (next to `fabric-voice.json`):

```json
{ "captureApproval": "ask", "claudeBinary": "claude", "model": "sonnet", "output": "spoken" }
```

- `claudeBinary`: the path to `claude` if it is not on PATH (e.g. `C:\\Users\\you\\.local\\bin\\claude.exe`).
- `model`: a family alias (`sonnet`, `opus`), so it follows the newest model.
- `output`: `spoken` or `written`; Tray, Answers. An old `speak: false` reads as `written`.

## What needs the Windows laptop to verify

Built and run on Linux under Xvfb (`frames/screen-companion-2026-10-27/`). Not yet seen on Windows:

1. **Claude is found and signed in.** Ctrl+Alt+Shift+B → "what's on my screen?" answers. If it
   says Claude Code was not found, set `claudeBinary`.
2. **The pointer lands on the thing** at your display scaling (125 %/150 %) and on the second
   monitor: ask "where is the Start button?" and "where is <something on the other screen>?".
3. **The overlay stays out of screenshots** (Windows content protection): during a lesson the
   card and pointer should never be described back to you.
4. **Teach notices you**: "teach me how to change the wallpaper", do step 1, and the next step
   should come without saying "next".
5. **Drive clicks where the dots are** and types into the right field: "drive: open Notepad and
   type hello". Esc during it stops it; moving the mouse stops it.
6. **The voice reads answers** and a wake word plus "what's this?" reaches the companion rather
   than Baton's intent bar.
7. The Ctrl+Alt+Shift+B chord is not taken by another app.

## Windows lab

`src/baton/screen/smoke/overlayLab.ts`: the real companion and pill, a scripted `claude`, silent speech,
no global keys, and `timeline.jsonl` with what the overlay really showed, every 50 ms, per display. The
overlay is excluded from capture, so set `LAB_VISIBLE=1` to see it in screenshots.

## Running the Linux smoke

```bash
# xdotool and xcompmgr can be user-local: apt-get download + dpkg -x, then
BATON_SMOKE_XBIN=<extracted>/usr/bin scripts/baton/screen-smoke.sh /tmp/screen-smoke look,teach,drive
```

It opens a small form, asks a Look question, runs a lesson with xdotool as the user, and drives
the form, writing full-screen frames, the approval texts and `results.json` to the folder.
