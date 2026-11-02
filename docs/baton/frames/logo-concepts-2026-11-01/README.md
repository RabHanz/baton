# Baton mark concepts, round two (2026-11-01)

Made with the `logo-design` skill (Design mode, Phase 1 to the concept checkpoint). This replaces the earlier hand-only mocks (`logo-mocks-2026-11-01`, removed). Nothing here replaces the shipped icon, and no kit is built until the Director picks a direction. The capability states stay in the tray icon, separate from the brand mark.

`concept-sheet.png`: nine concepts, each large and at 64, 32 and 16 px, greyscale. `svg/`: the vector files. `generated-sources/`: the 512 px greyscale copy of each generated image used, with the prompt beside it. `generated-traces/`: the raw vtracer output, kept to show why a trace is not a finished mark (the trace of the wave B has 442 anchor points; the hand redraw has 45).

## Which is which

| Concept              | Origin                                                                                                                                       | At 64 / 32 / 16 px                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Wave B (recommended) | Generated idea (Codex image tool), traced, then redrawn by hand from its measured bars: two bowls of five horizontal bars with a gap between | Reads as a B at 64 px; at 32 px it is a B-ish bar stack; at 16 px it is a blur   |
| Wave B, small cut    | Hand-drawn: six thick bars in two bowls of three                                                                                             | Holds at 16 px as a bar stack, reads as a B only when you know                   |
| Fine wave B          | Generated, traced only, **unfinished**: hair-fine tapering lines                                                                             | Beautiful at 256 px, mush below 64. Shown for the idea; not a candidate as drawn |
| Baton and beat       | Hand-drawn: a conductor's baton with its beat dot                                                                                            | Holds at every size; reads as a wand or a pen before a baton                     |
| One-stroke B         | Generated idea, hand-redrawn: one line starting at a solid dot, open middle bar                                                              | A B at every size; the lightest weight, so thin at 16 px                         |
| Downbeat             | Hand-drawn: open ring with the beat dot                                                                                                      | The cleanest at 16 px; a spinner to some eyes                                    |
| Handoff              | Hand-drawn: two points and a line passing between them                                                                                       | Holds; says "connected", not "Baton"                                             |
| Solid B              | Hand-drawn: bold geometric B in two halves                                                                                                   | The strongest small and the plainest                                             |
| Echo B               | Hand-drawn: a B of nested outlines                                                                                                           | A B at 64 px and up; clogs at 16 px                                              |

## Recommendation

Wave B, because it is the Director's own idea done in a form that reads as a B, it echoes the sound in the product without being a bar tile like Wispr's icon, and it has a small cut. Honest risk: it does not hold as a B at 16 px, so the 16 px use needs the small cut or Solid B. Solid B and One-stroke B are the safer fallbacks if tray-size recognition matters more than the idea.

## How the generated ones were made

Six images through `codex-imagegen.sh` (Codex's built-in `$imagegen`, gpt-image-2, driven by gpt-5.6-sol), square, flat near-black on white, about 21 to 25 seconds each. It runs on the ChatGPT subscription: no per-image charge, counted against plan limits (six images of a single batch). The raw PNGs carry an OpenAI content-credentials marker and stay out of the repository; only 512 px greyscale copies are kept. No trademark was copied: the library was used for study only (Manjaro and Zorin show a letter built from bars and gaps).
