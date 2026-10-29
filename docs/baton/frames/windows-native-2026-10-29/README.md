# Windows make-native proof, 2026-10-29 (Baton 0.1.5 on the Director's laptop)

Captured with PrintWindow from inside the desktop session (a full-screen capture came back blank white).

| Frame                 | What is on screen                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-boot-window.png`  | Baton 0.1.5 after boot: the 3D-Printer project, its live terminal session ("Bring into Herdr"), and a new-thread composer                                                                                          |
| `02-after-import.png` | the same window after the import: the sidebar shows "Projects 0" although the server lists the project and both threads (`t3 thread list`). This is a display issue in the desktop client and is not yet explained |

The import and the turns ran through the server (`agent-session-import.mjs` over an ssh tunnel, then
`t3 thread send --wait`):

- the session record `56924.json` named `b9ddd43a-…` and said `idle`, so pid 56924 was stopped. The 9 `tail` monitors were orphans from before (their parents were gone) and all 9 kept running;
- import: `importedCount 1, skippedCount 0`;
- recall turn, with no tools: PETG set audited and fixed (leaf springs, USB-C end caps, 8 magnets), passed all 51 checks; PLA/ABS/ASA still old geometry because the weekly limit cut the rebuild. Each of those phrases is in the pre-move backup. The session had 6 compactions before the move, so it no longer knew what the trex_run logs were for;
- Bash turn: `/d/Downloads/Development/3D-Printer … NATIVE-WIN-OK`;
- the same transcript file grew from 16,194 to 16,247 lines; no new session file appeared.
