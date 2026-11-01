# Wispr Flow audit, 2026-11-01 (first pass, public sources)

Asked for by the Director: "you really do need to do the audit of the Wispr Flow's UIs." Baton's window is judged against it.

## What this is, and what it is not

**Not yet done: the live app.** Wispr Flow is installed and running on his laptop (`%LOCALAPPDATA%\WisprFlow`, checked by file and process listing only, nothing captured). Capturing its window shows his screen, so it waits for his yes and for him to be told first. Until then there are **no first-hand frames of the Windows app**.

What this pass rests on:

| Source | What it gave | Weight |
| --- | --- | --- |
| `frames/app-home-and-insights.png`, `frames/app-settings-dialog.png` | The real desktop app: Home with the history feed, Insights, the sidebar, the Settings dialog | Third-party review screenshots (Oct 2025 build, v1.3.535). Real UI, not ours. |
| `frames/mobile-and-hotkeys-dialog-sheet.png` | iOS and Android screens, the "Change hotkeys" dialog, sign-in | Same third-party review |
| `frames/site-home.png`, `frames/flowbar-pill.svg` | The marketing page and the official pill artwork (97 x 28 px) | wisprflow.ai |
| `help-articles/articles.tsv` | Titles and URLs of all 149 help articles | docs.wisprflow.ai. Behaviour below is quoted from the articles on History, Retry, Delete, Data and Privacy, Shortcuts, Auto Cleanup and Styles. |
| Videos | Not captured. YouTube refuses this server's address. They can be taken from his laptop's address, with his say-so. | none |

Every claim marked (doc) comes from a help article; (frame) from a frame I opened; (unverified) means I could not confirm it.

## Wispr Flow screen and state inventory

**Shell (frame).** Left sidebar: Home, Insights, Dictionary, Snippets, Style, Transforms, Scratchpad (the older build also shows Notes). Bottom of the sidebar: a plan card ("2,000 words remaining", Upgrade), Invite your team, Get a free month, Settings, Help. Top bar: sidebar toggle, bell, account. Plan badge beside the logo.

**Home (frame).** Greeting with the hotkey chip ("get back into the flow with Opt"), a dismissible promo card, a stats column (total words, WPM, day streak), "Your Voice Profile", then the History feed grouped by date: time, text, a "transcription was dismissed" state, "Audio is silent" state.

**Insights (frame).** Your Usage / Your Voice tabs. Words per minute with a percentile, fixes made by Flow, total words dictated, desktop usage by app category, a day-streak calendar.

**Settings dialog (frame).** A modal with its own nav. SETTINGS: General, System, Vibe coding. ACCOUNT: Account, Team, Plans and Billing, Data and Privacy. Rows are label, one-line current value, a "Change" button. Version in the footer. General holds Keyboard shortcuts, Microphone, Languages (auto-detect, 99 languages). (doc) System has "Mute all audio while dictating"; Experimental has "Pause music".

**Shortcuts (frame + doc).** "Change hotkeys" lists Push to talk (hold), Hands-free mode (press to start and stop), Paste last transcript, with "Add another" and "Reset to default". (doc) Also Command Mode, Copy last transcript, Cancel. Up to four shortcuts per action. Keyboard or mouse: Middle Click and Mouse 4/5; **left and right click cannot be assigned**; an assigned mouse button no longer reaches other apps. Double-tapping Push to talk starts hands-free.

**Style (doc).** Categories Personal, Work, Email, Other, chosen by the app being dictated into; styles Formal, Casual, very casual, Excited. Guided "Make Flow sound like you" setup. **Auto Cleanup (beta):** None, Light (default), Medium. "Your original dictation is always kept", with "Undo AI edit" in the Home three-dot menu.

**Dictionary, Snippets, Transforms, Scratchpad (doc).** Dictionary teaches words; Snippets expand a spoken cue into saved text; Transforms rewrite selected text with custom prompts (beta); Scratchpad holds voice notes. Bulk import for dictionary and snippets. Upload an audio file for transcription.

**Command Mode (doc).** Voice commands that edit selected text, own shortcut.

**Notetaker (doc, beta).** Meeting recording with live transcript, summaries, calendar reminders, a hub, retention control, sharing, MCP.

**The pill (frame + artwork).** 97 x 28 px black capsule, hairline `#4D4A42` border, a grey circular cancel button and a cream waveform. On the marketing page it sits over the text it is producing. It is small and has no label.

**History (doc, frame).**
- Where: "History" or "Recent Activity"; Home feed on desktop. Shows successful, failed and empty dictations.
- Audio is kept 14 days for retry. Dismissals under 0.5 s are not saved.
- Retry or Recover on failed, empty or interrupted entries (audio of at least 5 s). It needs the internet, cannot run during dictation, and the retried text can differ because dictionary replacements and casing are not reapplied. Retry does not paste; the text is copied by hand.
- Per entry menu: Copy, Retry, Report, Delete transcript (confirm). Delete removes the stored audio too. On iOS, swipe to Play with 1x, 1.5x, 2x.
- Settings, Data and Privacy, "Local data storage": Store data locally (default), Auto-delete local data every 24 hrs, Never store data locally. Also "Dictation cloud storage" and "Improve the model for everyone", both **on by default**.
- Not confirmed: whether History shows the raw words beside the processed text (the article does not say; "Undo AI edit" implies the original is kept).
- History does not sync between devices.

## What we have, lack, and will beat (against what is confirmed above)

| Feature | Baton today | Verdict |
| --- | --- | --- |
| Sidebar app window with tabs, top bar, Settings dialog | Built (PR #73, 0.1.16). Mock-data renders only; not yet seen on his laptop | Have, unproven on Windows |
| Home feed of turns grouped by day, stats column | Built from `voice-turns.ndjson`; no WPM, streak, percentile or per-app breakdown | Lack Insights depth |
| History page: raw and cleaned, copy any time, retry, delete, search | In build (builder B). Today only a log of lengths | Lack; will beat (below) |
| Audio kept for retry | None kept | Lack; will beat (Opus, 30 days editable, corrected clips to 2 GB) |
| Data stays local | Yes, all local except the model call for clean-up | Beat: Wispr defaults cloud storage and model training on |
| Retention control | Planned: days, size cap, space readout, pause below 5 GB | Beat: Wispr offers store, 24 h, or never |
| Dictionary | Built, with a Vocabulary tab; learned words in build | Have, beat once learned words land |
| Snippets | None | Lack |
| Transforms (rewrite selection) | None | Lack |
| Scratchpad / notes | None | Lack |
| Insights | Partial counts | Lack |
| Styles per app category | A per-app writing style setting exists; no category UI | Have the setting, lack the UI |
| Auto Cleanup level (None/Light/Medium) | Local-then-Claude / local only / off | Have, different levels; "undo AI edit" will come from History |
| Command Mode (edit selection by voice) | None | Lack |
| Languages | English-leaning recogniser | Lack (Wispr: 99 languages, auto-detect) |
| Vibe coding (file tagging, syntax awareness) | None; Baton drives coding sessions instead | Different approach |
| Shortcut editor | Fixed hotkeys, read-only; bindings in build | Lack today |
| Mouse bindings | Planned: middle click, left+right chord, unbound clicks pass through | Will beat: Wispr cannot bind left or right click and swallows assigned buttons |
| Double-tap hands-free, paste or copy last transcript | None | Lack |
| Pill | Redesigned, small, with states | Parity on size, and ours shows more states; unproven on his screen |
| Upload an audio file | None | Lack |
| Bulk import dictionary | None | Lack |
| Notetaker meetings | None | Out of scope for now |
| Mobile app | T3's phone app only; no Baton dictation on phone | Lack |
| Voice agent over sessions, screen, files | Baton's point; Wispr has none | Beat |

## What is left to do before this is a full audit

1. His yes to capture the live app on his laptop, after he is told, to get first-hand frames of every tab and state (Home, History menu, Insights, Dictionary, Snippets, Style, Transforms, Scratchpad, Settings pages, the pill while listening, thinking, error).
2. Videos of the Windows build, taken from his laptop's address.
3. Re-judge the window against those frames. Until then the redesign is not judged against Wispr.
