# Panes, accounts and windows, 2026-10-31 (Baton 0.1.5-baton.46)

Live app on signzart-prod in headless Chromium, except where noted. Thread text is blurred because
this repository is public; the planted word in frames 30 to 36 is proof text. Most frames exist at
1440 and 2560.

| Frame                         | What is on screen                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `01-three-columns`            | Three panes as three columns with two dividers                                        |
| `02-resized`                  | Both column dividers dragged                                                          |
| `03-grid`                     | Four panes as a two by two grid                                                       |
| `05-drop-hint`                | A pane dragged by its bar, the drop zone lit                                          |
| `06-rearranged`               | After a swap and an edge dock                                                         |
| `07-after-reload`             | The same layout after a reload                                                        |
| `08-terminal-pane-a`, `-c`    | Terminal opened on the focused pane, each in turn                                     |
| `09-details-pane-a`, `-c`     | Thread details on the focused pane                                                    |
| `10-right-panel-pane-a`, `-c` | Right panel on the focused pane                                                       |
| `11-account-menu`             | Account menu: spent accounts disabled, with when they return                          |
| `14-main-after-detach`        | Main window after a pane detached                                                     |
| `15-detached-window`          | The thread in its own window                                                          |
| `16-held-elsewhere`           | "Bring it here" where another window took the thread                                  |
| `17-reattached`               | Back in a main window pane                                                            |
| `18-thread-menu`              | Sidebar thread menu with Detach to window                                             |
| `19-usage`                    | Usage: still one tile per account with the Rabee instance added                       |
| `30` to `32-account-*`        | Word planted on the default instance, moved to the Rabee instance, word recalled      |
| `33` to `35-account-*`        | A move during a turn: the toast, the turn running on, the turn finished               |
| `36-account-moved-back`       | Moved back, word recalled                                                             |
| `37-account-after-restart`    | Rehearsal copy: pinned thread after a server restart, word recalled                   |
| `20` to `24-desktop-*`        | Real Electron under Xvfb on a copy of the data: detach, restore after restart, attach |

Scripts: `scripts/baton/live/panes-proof.mjs` (28 of 28 at each width),
`thread-account-proof.mjs` (5 of 5), `desktop-windows-proof.mjs` (8 of 8).

The live run used one account, Rabee, moving between the default and pinned instances. Resume across
two different accounts was proven with the Claude CLI on onnyx (D95), not in T3.
