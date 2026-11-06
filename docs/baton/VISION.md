# Tessaya: the vision and how it got here (2026-11-01)

Read this before the manager brief. It is an index with the Director's direction, not the record:
the sources below hold the detail, so read them rather than trusting this summary.

## Sources, in reading order

1. The founding document, 2309 lines, "T3 Fabric agent implementation", 2026-09-18:
   `/home/dev/.claude/uploads/6bf22e2d-719e-4a44-b4be-1f7544111739/e6798b22-T3_FABRIC_AGENT_IMPLEMENTATION.md`.
   Section numbers in DECISIONS.md refer to it. He told us to improve it from his real workflow,
   not to follow its generic one.
2. `memory/baton-t3-setup.md`: the running history, phase by phase, with his words. Long; read it all.
3. `memory/baton-must-be-smart.md`, `memory/director-voice-accent.md`,
   `memory/chrome-bridge-to-laptop.md`.
4. `docs/baton/STATUS.md`: what actually works, by phase. `docs/baton/DECISIONS.md`: every choice.
   `docs/baton/VOICE.md`, `SCREEN.md`, `DEPLOY.md`, `UPSTREAM.md`.
5. Older records live in `docs/fabric/` in git history. Clicky research is in
   `docs/baton/research/clicky-2026-10-27/` and `clicky-videos-2026-10-27/`.
6. His exact past words: `history-search.sh <words>`, and `history-search.sh show <session>`.

## How it started

The pain, September 2026: he typed into Claude Remote in a browser through Wispr Flow, by hand, and
accounts, machines and sessions were separate islands. He wanted to run his sessions by voice, with
a DJI mic on him, across every device and agent. On 2026-09-17 he uploaded the document and asked to
elevate his workflow. That was Fabric: T3 Code forked and extended, never rebuilt.

He said it was "separate from VentureOS", about how he wants his workflows to be autonomous and easy
to orchestrate. Later, maybe a product or open source. That later is now being discussed.

## How it grew

- 09-18: WorkSession, synopsis, fleet, orchestration rules, intent surface, voice core, Herdr,
  capability plane built in a day; both boxes on the fork. He then ruled that the intent layer must
  be model-backed, not a grammar: "what the hell even is the point of this if it isn't smart".
  Account rotation inside a thread was proven live after he corrected a wrong claim.
- 10-26: renamed Tessaya and made a standalone repo. Binding order: P1, extremely easy hopping between
  sessions and control from any device across all sessions and agents, instantly sending anything to
  any session. P2, always-listening voice plus Airdeck. Then upstream catch-up, then automatic
  upgrades as its own project.
- 10-27 onward: desktop app, screen companion, Clicky parity, Handy-style native dictation with
  Parakeet, custom wake words (Sebastian, Alfred, Freya), real voices, the pill.
- 10-30 to 10-31: he asked for a personal assistant with one brain routing everything: answers,
  look, teach, drive, dictation. All of Wispr Flow's magic done better: speed, whispering, clean-up,
  modes, and a default that keeps his intent and wording. Windows first with shared code, with
  macOS, Linux and mobile tests at the end of the queue. Reorient on the original fabric vision.
- 11-01: his first real test found the faults in the manager brief, and he set the next bar.

## What it should be

One brain that hears him anywhere and does the work, hands-free, across every device, session,
account and agent, on his machine as a full operator. It explains what is on his computer several
layers deep, not the surface. It confirms risky work in conversation and simply does simple work.
Tessaya's own app is beautiful, separate from T3 Code, with progressive disclosure, like Wispr Flow.
Tessaya is also how he will orchestrate the wider portfolio: Stage 5 of VentureOS's operating plan.

## The bar he set on 2026-11-01, from using it

This is his intent, not a task list. The brief holds the tasks; when a task is unclear, decide by this.

He wants a companion that feels like a capable person in the room, not a tool he operates. It listens hands-free, understands what he means rather than the words alone, gives him a moment when he may go on, and still answers fast. It remembers what was said, today and before, across everything it does, so "type what you just said" simply works. It can look things up itself. It acts on simple work and confirms risky work in conversation, out loud. When it refuses, it says why in plain words.

Dictation should feel magical, his word for Wispr Flow: speak for ten seconds or ten minutes, and clean text lands in the box as soon as he stops, fitted to what is already there, in his own words, with a vocabulary it learned from him. Nothing he said is ever lost. The pill is small, sleek and gone the moment it is not needed, and placing it is precise.

The app must be beautiful and complete: "way too simple" is his verdict on anything less. His words: "Can't you do better, much, much better, and have all the features in that UI?" Wispr Flow is the floor, and the aim is better than theirs. Thread lists stay clean: one current session per project unless he started another. It must never surprise him: an update warns him and comes back by itself.

His standing complaints are the test. He should not have to repeat himself, find things hidden, press a button he said he did not want, or discover a fault before we report it. He judges the real thing on his own machine, so look at it yourself, in frames and in his turn log, before saying it is done. Report what is true, including what was not checked.

How to find his exact words: `bash /home/onnyx/VentureOS/scripts/ops/history-search.sh <words>`, and his messages about Tessaya are in the VentureOS orchestrator session, `cc828d1b`, through the same index. When he speaks to you directly in T3, that outranks anything relayed.

## One assistant, not stages (2026-11-01)

His words: "It needs to actually behave like an actual assistant who has access to all of these tools rather than separating them into scripts and stages." And: "It couldn't type it because it doesn't have the context of all of its tools and memories and everything in one file."

So Tessaya is one continuous agent that holds the whole conversation, its memory and every tool at once: see the screen, type, click, search the web, read files, run commands, reach sessions, start or stop dictation. It decides for itself, and uses several tools in one turn. Router routes such as answer, look, drive and operate, each with its own session and partial context, are the design being replaced. Only what must not wait on a model stays outside it: stop, and the wake word.

## An employee, not a command line (2026-11-01)

His words: "It should be able to do all the personal assistant jobs and even more as an actual resource that people hire for humans." He wants to hand it a job, such as managing his socials, and have it run for days through T3 Code threads, using the computer natively. OpenClaw and Hermes are the frameworks he named as the comparison.

## Semi-sentient, and public (2026-11-01)

His words: "It is like a semi-sentient assistant that can do everything and keep track of everything." It uses skills, plugins and MCPs, "the whole nine yards", which the Claude and Codex harnesses already support. It keeps track of sessions and projects "so they're not left unattended forever. It knows if they crashed, failed, or what they did from time to time through proper monitoring."

Learn from Claude Duet, OpenAI dots, Meta Muse, Grok Bot, OpenClaw and Hermes: see `BATON-ASSISTANT-RESEARCH-2026-11-01.md`. "Every learning that we are doing across these projects and ventures should be kept as learnings in our brain and memory so it only improves from here as a constant feedback loop."

It is our own prototype first, and soon a public release: "Maybe under a bit of a stricter license (which I have not decided yet) or maybe even just open source (MIT), so people can use it and improve upon it as well. I'm talking about Tessaya not VentureOS." Build so that a stranger can install it: no private defaults, no VentureOS dependency, and keep third-party licences clean.

## Jobs start with a plan in their own thread (2026-11-01)

He gives a job by voice. Tessaya opens a thread for it, runs planning mode first to understand his intent, and says briefly over voice that it is ready, pointing him to that thread. He refines there. Every change stays in that job's context, and it works from the refined plan.

The pill is black, slim and minimal. His verdict on the white one: "all white and kind of blocky and bigger".

## It thinks like an executive (2026-11-01)

The assistant runs on an operating system the user owns: a pack of plain files, kept on the user's own machine and editable, that tells the top agent how to think. For any job it frames the job as a job to be done and its desired outcomes, finds the highest-leverage point, decides to build or not to build, and briefs specialist workers (for example technical, marketing, research and operations), each carrying the mental model for its role. Workers report outcomes, not activity. Cheap models do cheap work; the strong model is kept for judgment. The planning step of every job goes through this framing.

The pack is private to its owner: Tessaya ships a neutral default that a user replaces with their own operating system, and nothing personal is in the repository or the installer.
