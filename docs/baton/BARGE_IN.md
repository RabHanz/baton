# Barge-in: speaking over Tessaya (2026-11-03)

The Director: "when it is speaking, it's not listening to me at all so I cannot dismiss it." Before this the core muted its ears while she
spoke (`hearingItself`, a 500 ms echo tail) and only a wake word or a stop phrase could get through, unreliably, because over speakers her own
voice is in the microphone.

## What exists now

| Path                                                  | Over speakers                                                             | On headphones                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Wake word, stop phrase                                | as before                                                                 | as before                                                     |
| Esc, the pill's stop, the hotkey (the pill builder's) | always                                                                    | always                                                        |
| Talking over her                                      | the echo guard (setting "Cut in by talking over her", **off by default**) | on: the mic cannot hear her, so speech over her voice cuts in |

On a cut-in the voice **ducks to 25% at 40 ms** of his speech and **stops at 120 ms**, well inside 300 ms, and the core listens from the
moment he started (the words since the onset are kept, as for a late wake). If it was only a blip the voice comes back up. Settings, on the
Settings, Voice and wake words: "Headphones or speakers" (Automatic reads the Windows playback device, Bluetooth counting as headphones; `outputDevice.ts`) and "Cut in by talking over her (speakers, experimental)".

## How the echo guard hears him (`packages/baton-voice/src/echoGuard.ts`)

The player hands over each chunk it is about to play and when it will sound. The guard works at 8 kHz: it finds the delay between what is
played and what the mic hears (envelope correlation, 0 to 600 ms), learns the room with a 96 ms adaptive filter (block NLMS), subtracts the
predicted echo, and calls it speech over her when the residual, relative to what is playing, jumps to six times its usual level. It is a
detector, not a cleaner: the recogniser listens after the voice has stopped, when the mic is clean. Until the room is learned (about a second
of her speech) it says nothing and the fallbacks are what is left.

## Measured (synthetic room, `scripts/tessaya/bargein-eval.ts`, 3 rooms x 120 s, deterministic)

Speech-like audio through a room (delay 60 to 200 ms, reverberant tail up to 400 ms), echo and his voice mixed at the mic, confirmation 120 ms.

|                                       | Result                                       | Target  |
| ------------------------------------- | -------------------------------------------- | ------- |
| False barge-ins on her own voice      | **16.7 per 10 minutes** of continuous speech | under 1 |
| Recall when he is 12 dB over the echo | 0.90                                         | 0.9     |
| Recall at +6 dB / 0 dB / -6 dB        | 0.88 / 0.69 / 0.44                           | 0.9     |

**It does not meet the target**, which is why the speaking-over-speakers path is off by default. Trade-offs seen in sweeps (60 s per room): a
stricter threshold cut false barge-ins to 3 per 10 minutes and recall at 0 dB to 0.33. The statistic (residual over reference energy) is not
sharp enough on its own. What would improve it, in order: a longer, frequency-domain filter (better cancellation in reverberant rooms),
coherence between mic and reference, a second check with the speech detector on the residual, and the real device's delay and gain. The
harness is synthetic: it proves the plumbing and gives a number to beat; the acoustic test waits for real speakers (the laptop's are broken).

The CI step in `baton-ci` prints the numbers when the voice core or the guard changes; it does not gate.

## Not done

Real acoustic recordings (speech over TTS playback); a render-loopback reference from the operating system (WASAPI) as an alternative to
the player's own chunks (it would also cover the OS voice, which bypasses the player); WebRTC AEC3 in the sidecar; remembering the learned room
per output device across launches.
