# Voice

Talk to Tessaya instead of typing.

## Start

Turn on **Listen for my wake word** on the Voice page. Say a wake word (the ones that are on are listed there; each is a switch) and then your request, in the same breath or after a pause. It listens for about eight seconds for you to start, and a conversation stays open for 30 seconds after each answer, so follow-ups need no wake word.

## Personas

Each wake word is a persona with its own name and voice: say "Freya" and Freya answers in her voice, say "Alfred" and Alfred answers in his. They share one conversation, memory and set of permissions, so Freya knows what Alfred just told you. Tessaya, the lead, answers a hotkey, a typed question, or a wake word that has no persona. Sebastian has no wake word yet: start a typed question with his name.

Change a persona's voice under **Personas** on the Voice page; **Default** puts it back. Each persona is the front-matter (`name`, `wake`, `voice`, `role`) at the top of its file in the operating-system pack folder. Choosing **Quick** or **System voice** under Voice gives every persona that one voice.

## Good to know

- **Stop** it by saying "stop", "quiet", "enough" or "cancel" while it talks. It hears those with no wake word and nothing else said over its voice.
- **Quiet speech** (Voice page) is for whispering or a faraway microphone: Tessaya lifts what it hears and accepts a fainter wake word. It also lifts room noise and allows more false wakes, so it is off until you turn it on.
- **Mute** from the tray; the microphone is off while muted.
- **Written only** (tray, Answers) shows every answer on screen and plays nothing.
- A wake word that has no model on this computer stays off.
- On Linux and macOS the voice starts and hears the test phrase; the hold-to-dictate key and pasting into other apps were not tried there.

Related: [Dictation](./tessaya-dictation.md).
