# D85 proof frames, 2026-10-29 (signzart, `0.1.2-baton.36`–`.39`)

Taken with `scripts/baton/live/media-notify-proof.mjs` through T3's own web client, paired for the
run and revoked afterwards. The orchestrator thread (`cc828d1b…`) was only read, never typed into.
The test session is `fab-baton-media-test` (`ba6a5f86…`), a Claude Code session in Herdr started for this.

| Frame                                                   | View                       | What is on screen                                                                                                                                             |
| ------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orch-390-2-find-image-.png`                            | orchestrator, 390 px       | two screenshots the Director pasted, as image attachments on his message ("Yes, that is the way to go…")                                                      |
| `orch-paste-1-…`, `orch-paste-2-resize-1440.png`        | orchestrator, 390 and 1440 | the screenshot pasted with "Btw what is this…" (14:02 UTC), on the message                                                                                    |
| `orch-390d-1-…`, `orch-both-1-…`                        | orchestrator, 390          | the assistant's `SendUserFile` "Test send: the Speed Signz ad comparison sheet." with the sheet inline; T3's "Running: Bash · Stop" bar is the working state  |
| `orch-both-2-resize-1440.png`                           | orchestrator, 1440         | the same sheet inline under its caption, 2:09 PM turn                                                                                                         |
| `test-image-1-image-send.png`                           | test session, 390          | an image attached in T3's composer shows on the sent message                                                                                                  |
| `test-390-1-burst.png`, `test-pane-after-burst.txt`     | test session               | three quick sends; each reached the pane in order and was answered                                                                                            |
| `test-390-busy-1-burst.png`, `test-pane-busy-burst.txt` | test session               | three sends while a 70 s command ran: all three in the pane at once (`❯ B1`, `❯ B2`, `❯ B3`), 0 queued in T3                                                  |
| `order-390-1-burst.png`, `order-1440-*.png`             | test session, 390 and 1440 | two sends during a 40 s command; the reply ("DONE-WAIT2 / PEAR-1 / FIG-2") now sits after both, and the multi-step turn above it ("Worked for 3.6s", FINAL-E) |

Alerts, from the relay's own log (`agent activity deferred publish confirmed … completed`, one per
phone push):

- busy turn 15:52:23–15:53:41 UTC (one terminal message, three T3 sends, four replies): one, at 15:53:52;
- multi-step turn 16:19:45–16:19:48 (five messages, two tool calls) on `.39`: working at 16:19:46, one completed at 16:19:59.
