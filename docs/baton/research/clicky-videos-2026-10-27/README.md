# HeyClicky (paid Clicky): marketing videos, frames and claims

retrieved_at: 2026-10-27 · companion to `../clicky-2026-10-27/` (the open-source repos) · consumer: Baton look / teach / drive work · refresh: before changing Baton's screen features, or when heyclicky.com ships a new major version

I watched these. Every still in `frames/` was opened and checked by eye, and the transcripts were read next to the frames. Transcripts: the launch stream and the draw demo use YouTube's own captions. The other videos use local faster-whisper `small.en`, because every Gemini key returned `API_KEY_INVALID` on 2026-10-27. I corrected proper nouns against what was on screen.

## Sources

| #   | Video                                                                                                                               | URL                                                   | Published                                   | Length  | Transcript       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- | ------- | ---------------- |
| V1  | "we shipped something new." (live launch stream: v1.1.1, one brain, real-time 2D/3D visuals, Drive, browser agents, notch, Windows) | https://www.youtube.com/watch?v=xOkfw1_ePhg           | 2026-10-23                                  | 1:24:53 | YouTube captions |
| V2  | "we built an ai that draws on your screen." (teach mode: Pythagoras on Khan Academy, first beat in FL Studio)                       | https://www.youtube.com/watch?v=nT16HPxYX-s           | 2026-07-24 (shipped in v1.0.26, 2026-06-19) | 2:20    | YouTube captions |
| V3  | "introducing spatial context." (the user paints on screen to point the model at something)                                          | https://www.youtube.com/watch?v=bLnkvjw7j84           | 2026-08-05 (shipped in v1.0.33)             | 1:22    | whisper          |
| V4  | heyclicky.com hero `usecase.mp4` (Vikrant: always-on mode, map route, sheet music, Pythagoras, Blender)                             | https://www.heyclicky.com/assets/usecase.mp4          | live on site 2026-10-27                     | 1:49    | whisper          |
| V5  | heyclicky.com `nohandstricklol.mp4` (hands-free realtime computer use: Spotify, Stripe, Google Ads agent, calendar, reminders)      | https://www.heyclicky.com/assets/nohandstricklol.mp4  | live on site 2026-10-27                     | 1:44    | whisper          |
| V6  | heyclicky.com `it-draws-too-omg.mp4` (the user draws to add context, then an agent builds a Mac app)                                | https://www.heyclicky.com/assets/it-draws-too-omg.mp4 | live on site 2026-10-27                     | 1:15    | whisper          |

Also read on 2026-10-27: the heyclicky.com home page and FAQ (raw HTML) and https://www.heyclicky.com/changelog (raw HTML, v1.0.26 to v1.1.3). I also downloaded `hello.mp4` (a weekly team update about memory and skills), `daddyshome.mp4` (a staged JARVIS-style skit) and YouTube `Bo5v6QxsLnw` ("powerpuff clickies", 27 s, music only). None of the three makes a capability claim that the others do not, so I did not break them down. I did not fetch X/Twitter posts: the site and changelog link the same demos.

## Scene breakdowns

### V1, launch stream (2026-10-23), the load-bearing parts

| Time        | On screen                                                                                                                                                                                                                                                                      | Said / claimed                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8:50–10:00  | Slides                                                                                                                                                                                                                                                                         | "One brain": the earlier GPT-realtime → bigger-model handoff misrouted requests ("what's this error on my screen?" → "I can't see your screen"). Now one model hears, sees, answers and hands work to agents                              |
| 10:40–11:20 | LinkedIn; a small yellow triangle pointer flies to each target; "Thinking" pill in the notch (frame 07)                                                                                                                                                                        | Guidance: "Go through me, then settings and privacy." / "Click settings and privacy in this menu." / "Click sign-in security…" Each step waits for his click, then gives the next                                                         |
| 11:20–13:00 | Claude.ai compose box                                                                                                                                                                                                                                                          | Screen-aware dictation from memory: "write a prompt here to help me debug my second display stuff", typed straight into Claude                                                                                                            |
| 13:00–14:30 | Voice only                                                                                                                                                                                                                                                                     | Routing: "research who the founder of Claude is and let me know when you're done" becomes a background agent without saying "agent"                                                                                                       |
| 16:00–21:00 | YouTube (Karpathy GPT) and a Colab cell, circled by hand-drawn orange ellipses; a cream card beside it shows "2 rows × 4 columns" with a grid and `shape = (2, 4)` (frame 06)                                                                                                  | "real time visuals": drawn on the fly while it talks; derivative worked step by step on a cream card                                                                                                                                      |
| 21:00–29:00 | Cards with photos, timelines, news headlines                                                                                                                                                                                                                                   | Web search drawn as visual cards; "open this article in my Chrome" opens it                                                                                                                                                               |
| 29:00–35:00 | 3D models (F-35B lift system, jet engine, Raspberry Pi) drawn over the page, each part labelled                                                                                                                                                                                | In-house 3D engine, "real time … not precomputed"; drag to rotate, click a part to ask about it                                                                                                                                           |
| 45:40–48:00 | Notch drops a dark card: "Want me to drive Preview and make that crop? [YOU]" / "You watch. Esc takes it back." / buttons **Go ahead**, **Not now** (frame 01). Then it narrates each action in first person                                                                   | Drive: "I can crop a copy … keeping the original untouched." "I'll duplicate the photo first so the original stays untouched." The trigger word is "drive"                                                                                |
| 48:00–50:00 | DaVinci Resolve; notch pill "HeyClicky is driving · I'll use a bright mint background to mak… · esc to take it back"; yellow pointer on the Background Color slider (frame 02)                                                                                                 | It checks its own work: "The text is too dark. I'll adjust the reveal's background color for contrast."                                                                                                                                   |
| 50:30–52:30 | Ableton Live; notch pill "HeyClicky is driving · The green meters show audio playing; s…" (frame 03)                                                                                                                                                                           | **Teach while driving**: "drive Ableton … and teach me step by step as you're driving … what you're doing" — it explains each control as it uses it                                                                                       |
| 52:30–62:00 | Notch home "Morning, Farza. 2 jobs working"; centre card "Scanning AI Twitter" with a checklist plan (Scan today's AI posts on X / Verify model launch claims / Summarize useful signals), progress bar 0/3 and a stop button; other jobs as tilted mini-cards (frames 04, 05) | Background browser agents in your own Chrome via an extension, in a separate tab group. A follow-up goes to the right agent without picking a thread. "you don't see hey clicky thinking … All that matters is I tell it something to do" |
| 63:30–65:00 | Team                                                                                                                                                                                                                                                                           | Agent harness "J1", built on Pi, replacing Codex: "faster, it's cheaper, and it's almost the same quality"                                                                                                                                |
| 65:00–68:30 | Slides: captions, routines, follow-up questions, drawing history, "spreadsheets, right in the notch", "it remembers what it saw" (frame 16: "an hour ago · Stripe · Gross volume, today $1,284" → "what was that number earlier?" → "$1,284, on your Stripe page at 10:42.")   | Screen memory over hours; drawings saved and replayable                                                                                                                                                                                   |
| 69:00–74:00 | Windows 11 laptop; a 3D engine model over the desktop wallpaper, then exploded with labels "Piston", "Crankshaft", "Connecting rod" and a "Four strokes" card (frame 08)                                                                                                       | "almost 100% the same" as Mac: browser agents, Drive and drawing                                                                                                                                                                          |

### V2, draw on your screen (2:20)

- 0:00–0:15: he sketches the idea on a whiteboard. "It can draw polygons, arrows, curved lines … It can teach you literally anything, no matter what app you're in."
- 0:15–0:58: Khan Academy, Pythagoras. "it's going to take a screenshot to actually return coordinates of drawings that it's going to paint on my screen directly." Glowing red squares are drawn on each leg, with red pill labels "area 9" and "hypotenuse C" and a red triangle pointer (frames 09, 10).
- 1:00–1:55: FL Studio, "show me how to make my first beat? I'm new to FL Studio." The channel rack gets a red dashed glowing outline. A red pill label ("kick step five") sits under the system pointer next to the exact step button, and the spoken line matches ("Then step five, the start of beat two") (frames 11, 12). One target per step, in order. It waits for each click.
- 2:00: "It works in literally any program. Try it out. Try to break it."

### V3, spatial context (1:22)

- He holds the hotkey and moves the cursor, which leaves a red paint trail over the thing he means (frame 14, a red stroke across a film poster). "From what you circled, that muscle is the deltoid."
- "HeyClicky agent, could you actually go and add a button to this part of the website right here?" The agent edits the code. Done is announced in a **green speech bubble anchored to a green triangle cursor** beside the change: "The Explore Programs button is back in the hero next to Start registration, and the preview is live." (frame 13)

### V4, site use-case reel (1:49)

- "always-on mode, which we can activate by pressing Ctrl three times." Voice action: "change my MacBook to light mode".
- Maps: "show me a path from the Embarcadero to South Park". An orange arrow path with orange pill labels "head south" and "Soma" (frame 15).
- Sheet music: a box drawn round one measure. Pythagoras: orange squares and labels drawn on a plain page. Blender: "This vertical strip of icons is the properties editor".

### V5, hands-free (1:44)

- Realtime voice control with no hands: Spotify playback and volume, opening the Stripe dashboard, "do you have my Google Ads integration connected?", a background agent to start a Google Ads campaign ("pause before…"), reading the calendar, setting a reminder and then opening Reminders "to confirm".

### V6, it draws too (1:15)

- "give more context to HeyClicky by just pressing Ctrl + Option" and drawing. Then "Can you make a simple Mac app …", and "add a button over here with your Google Maps link" points at the place to add it.

## Claimed capabilities, verbatim

Teach / tutor / guide

- "It can teach you literally anything, no matter what app you're in." (V2 0:05)
- "it can draw directly on your screen and walk you through step by step, made much smarter by skill files injected based on the program you're in. It even detects when you click where it told you to, and moves you to the next step, like a real teacher" (changelog v1.0.26)
- "it teaches you any tool, walks you through whatever you're stuck on, draws right on your screen to point the way, and runs agents to do tasks for you." (site FAQ)
- "it's going to take a screenshot to actually return coordinates of drawings that it's going to paint on my screen directly." (V2 0:22)
- "On the kick row, click this first square, step one. Then step five, the start of beat two." (V2 1:25, spoken step by step)
- "Ask about anything and HeyClicky circles, points and sketches right on your screen while it talks. Explanations land on little cards with real photos, and when the answer is a real thing … HeyClicky builds a 3D model you can drag around and click on to ask about any part." (changelog v1.1.1)
- "real time visuals. This lets AI generate real-time visuals using just your voice around whatever it is that you're trying to figure out or get done." (V1 15:55)
- "drive Ableton for me and make my first beat … and kind of teach me step by step as you're driving my computer" (V1 50:20)

Pointing and spatial context

- "Draw on your screen to point at or circle the specific thing you want the AI to focus on." (changelog v1.0.33)
- "press the hotkey and use your cursor to hover around the area that you want the model to focus on." (V3 0:09)

Acting (Drive, agents, browser)

- "When something needs doing in a Mac app, HeyClicky asks, and with your yes it moves the mouse and types while you watch. Move your mouse, talk or press Escape and you're back in control." (changelog v1.1.1)
- On-screen prompt: "Want me to drive Preview and make that crop?" / "You watch. Esc takes it back." / "Go ahead" · "Not now" (V1 45:50, frame 01)
- "All you have to say is hey clickie and then drive … The key word is drive" (V1 52:40)
- "typing during a drive now stops as soon as you take the screen back." (changelog v1.1.2, Windows)
- "Your agents can now work in your own Chrome, on the sites you're already signed into, in their own tab group beside your tabs." (changelog v1.1.1)
- "Agents you've handed work to hang from the notch as little windows that show their plan while they work and their result when they're done." (changelog v1.1.1)
- "say 'heyclicky agent' and it'll go do the task for you." (site FAQ)
- "Routines, just by asking: Say 'every Tuesday and Thursday at 5, check my inbox for invoices'" (changelog v1.1.1)
- "We shipped the world's first realtime computer-use system … Try always-on mode by pressing Control three times (requires headphones)." (changelog v1.0.26)

Memory

- "remembers what was on your screen earlier in the conversation, and remembers your conversations from day to day." (changelog v1.1.1)
- "it maintains two files: PROFILE.md for your habits and general preferences, and VOLATILE.md for the project you're working on right now. Both get injected into the voice model and the agent." (changelog v1.0.33)
- "it remembers what it saw." (V1 67:30 slide, frame 16)

Voice and dictation

- "It starts answering a couple of seconds after you let go" (changelog v1.1.1)
- "Press and hold Fn + Control, speak, and the text streams in at around 450ms." Screen-aware: "press Control + Option, and say 'HeyClicky, type a reply to this person in the text box here'. It takes a screenshot, understands what you're replying to, and inserts a draft" (changelog v1.0.37)
- "Captions while HeyClicky talks" (changelog v1.1.1)

Apps and platforms

- "which apps does it work with? anything on your screen. if you can see it, heyclicky can see it. no plugins or integrations needed." (site FAQ)
- "heyclicky runs on mac (sonoma 14.2 or higher) and on windows 10 or higher." (site FAQ). Windows 1.1.1 shipped 2026-10-23. It "works nearly the same as Mac, almost 100% the same." (V1 73:00)

Privacy

- "we only see your screen when you press the hotkey, and screenshots are never stored. we do keep basic text summaries so heyclicky has context." (site FAQ)
- "we later turned proactive agents off over privacy unease" (changelog v1.0.33 note)

Pricing (heyclicky.com, 2026-10-27; monthly, or yearly at −20%)

- **Free $0**: "25 talk messages a month", "plenty of dictation", "25 agent messages a month".
- **Pro $20/month**: "unlimited talk", "unlimited dictation", "150 agent messages a month".
- **Max $100/month**: "unlimited talk", "unlimited dictation", "1,000 agent messages a month".
- Students: "50% off your first month on pro". "talk keeps working, always. agent messages pause until your next cycle".

Models and stack, as they state it: GPT realtime (gpt-realtime-2.1, v1.0.33), then "GPT soul" as the one brain (V1 9:55, my best reading of the caption); the agent harness "J1" is built on Pi (V1 64:20); Opus 5.5 was used on stream to fix their own backend. They state no Claude model for the product.

## UI details worth porting (each tied to a frame)

1. **The pointer is a small solid triangle**, a separate overlay sprite beside the real cursor. It is yellow/orange on the Mac (frames 02, 07), red in the teaching demo (frame 10) and green when an agent reports done (frame 13). It flies to the target. The real system cursor is never moved for guiding.
2. **Step labels are rounded pills** (red or orange fill, white sans text, a few words such as "kick step five", "head south", "area 9") placed right next to the target. The full sentence is spoken, not written (frames 12, 15, 10).
3. **Region highlight** is a glowing dashed outline around the area in play, for example the channel rack (frame 11). Shapes are drawn as glowing strokes: squares, arrows, ellipses (frames 06, 09).
4. **Explanation cards** are a cream rounded panel beside the subject, titled in a large hand-ish font ("2 rows × 4 columns") (frame 06).
5. **Teach loop**: one target per step → wait until the user clicks it (they detect the click) → re-screenshot → next step (V2, V1 10:40, changelog v1.0.26).
6. **Drive approval**: a single dark card from the top centre with the plan as one sentence ("drive Preview and make that crop"), a "YOU" badge, the subline "You watch. Esc takes it back.", and Go ahead / Not now (frame 01). While driving, a pill at the top centre shows "HeyClicky is driving", the current narrated step, and an "esc to take it back" key hint (frames 02, 03). Mouse movement, speech or Esc takes control back.
7. **Agent cards** show a title, a checklist plan whose items are struck through as they finish, an "n/4" progress bar and a Stop button. A finished card shows the result and follow-up chips (frames 04, 05).
8. **Done bubble**: a speech bubble anchored to the pointer at the spot that changed (frame 13).

## Frames

| File                                                    | Source / time         | What is on screen                                                                                                                                                                                                               |
| ------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frames/01-launch-46m-drive-approval-prompt.png`        | V1 45:51              | Drive consent card: "Want me to drive Preview and make that crop?" [YOU] · "You watch. Esc takes it back." · Go ahead / Not now                                                                                                 |
| `frames/02-launch-49m-drive-davinci-narrating.png`      | V1 49:10              | DaVinci Resolve; pill "HeyClicky is driving · I'll use a bright mint background to mak… · esc to take it back"; yellow pointer at Background Color                                                                              |
| `frames/03-launch-52m-drive-ableton-teaching.png`       | V1 51:45              | Ableton Live 12; pill "HeyClicky is driving · The green meters show audio playing; s…"                                                                                                                                          |
| `frames/04-launch-60m-notch-agent-cards-plan.png`       | V1 60:10 (slide)      | Notch home, "2 jobs working, 1 needs you"; card "Find hardware IG influencers", checklist 2/4, Stop; side cards "Ready to view", "Needs you · Book flights to Tokyo"; toast "Finished adding lasagna ingredients · Full report" |
| `frames/05-launch-58m-agent-result-card.png`            | V1 58:20              | Finished agent card "Count from 1 to 50 again, in order." with result and follow-up chips "Count backward from 50 to 1", "Count from 1 to 100"                                                                                  |
| `frames/06-launch-17m-realtime-visual-tensor.png`       | V1 17:30              | Colab cell circled in orange; cream card "2 rows × 4 columns", grid of token ids, `shape = (2, 4)`                                                                                                                              |
| `frames/07-launch-11m-guide-linkedin-pointer.png`       | V1 11:02              | LinkedIn Settings › Sign in & security; small yellow pointer next to the menu item it named                                                                                                                                     |
| `frames/08-launch-72m-windows-3d-engine.png`            | V1 72:10              | Windows 11 laptop; 3D engine model over the desktop                                                                                                                                                                             |
| `frames/09-draw-50s-pythagoras-overlay.png`             | V2 0:50               | Khan Academy video with red squares drawn on legs a, b and c                                                                                                                                                                    |
| `frames/10-draw-50s-pythagoras-labels-zoom.png`         | V2 0:50 (zoom)        | Red pills "area 9", "hypotenuse C"; glowing red square; red triangle pointer                                                                                                                                                    |
| `frames/11-draw-95s-flstudio-step.png`                  | V2 1:35               | FL Studio channel rack inside a glowing dashed red outline                                                                                                                                                                      |
| `frames/12-draw-95s-flstudio-step-label-zoom.png`       | V2 1:35 (zoom)        | Pill "kick step five" under the cursor at step 5 of the 808 Kick row                                                                                                                                                            |
| `frames/13-spatial-54s-agent-done-bubble.png`           | V3 0:54               | Green triangle plus green bubble: "The Explore Programs button is back in the hero next to Start registration, and the preview is live."                                                                                        |
| `frames/14-spatial-62s-user-hover-trail.png`            | V3 1:02               | User's red paint trail over a film poster (spatial context)                                                                                                                                                                     |
| `frames/15-site-usecase-41s-map-route.png`              | V4 0:41 (480p source) | Apple Maps with an orange route arrow and pills "head south", "Soma"                                                                                                                                                            |
| `frames/16-launch-67m-memory-remembers-what-it-saw.png` | V1 67:20 (slide)      | "it remembers what it saw." Stripe card "an hour ago" → "what was that number earlier?" → "$1,284, on your Stripe page at 10:42."                                                                                               |

## Not verified

- Every claim above is the vendor's own. Nothing was installed or run: no latency figures, no Windows build tested, no proof that the click detection in the teach loop works.
- The "one brain" model name. The captions say "GPT soul", which may be a mis-hearing of a model name.
- Whether Windows Drive has the same consent card. V1 says Windows has "Clickie Drive"; the Windows changelog mentions drives, but no Windows Drive was shown.
- The V1 stream's live failures (backend down, "invalid service tier") show that the product depends on their hosted backend. Those failures were seen on screen; their cause was not checked.
