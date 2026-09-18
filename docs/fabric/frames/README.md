# Frames

Screenshots of the real client, not mockups and not descriptions. Every frame
here came from the built web app running against a server on a `VACUUM INTO`
snapshot of real data, driven by Playwright at 1440×900, with the Fabric client
setting on. Nothing was staged: the work sessions, the threads and the states
were produced by the proof runs described in `../STATUS.md`.

They are committed because a written breakdown is not the thing. A reader
checking whether the Work block reads "work first, provider second" should be
able to look, not to take a sentence for it.

## Phase 2 — the Work block

| Frame                       | View                          | What is on screen                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase-2/01-sidebar.png`    | Whole client, sidebar at left | The Fleet block at the top, the Work block under it, then the ordinary thread list — untouched, which is the point of `DECISIONS.md` D12. The centre is T3's own new-thread view.                                                                                                                                                                                                                                                   |
| `phase-2/02-work-block.png` | Work block, cropped           | Four work sessions, each as project → work → `account · host · state`. Top: `Fabric proof scratch / Production deploy check / Claude · signzart-prod · Approval ne…`. Bottom: `VentureOS / Scheduler reconnect race / signzart-prod · No provider` — a work session whose provider threads have all ended, still present and still named. That row is the whole reason the object exists, and the thread list below cannot show it. |

## Phase 4 — the Fleet

| Frame                            | View                                   | What is on screen                                                                                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase-4/01-fleet.png`           | Fleet block, cropped                   | The §33 shape. `FLEET` with the `Needs me · 1` filter at the right. Four rows, ordered by what needs the user first: `!` _Approval needed_ with the synopsis line `Claude · signzart-prod · Waiting for …`, two `✓` _Done_, one `·` _Idle_. Every state was derived by the environment from its own events. |
| `phase-4/02-needs-me-filter.png` | Whole client after clicking `Needs me` | The Fleet is reduced to the single row that cannot move without the user. One control, always visible — §33's "Needs me is a top-level filter".                                                                                                                                                             |

## What the frames also show, and what they cost

Two honest observations a reader would make anyway:

- **Headings truncate.** `Fabric proof scratch / Production deploy check` becomes
  `Fabric proof scr…` in a 256 px sidebar. The information is there and the
  hierarchy is right, but the labels are longer than the column. Worth fixing
  before this is a daily surface.
- **The Fleet and the Work block read as two similar lists.** They answer
  different questions — "what is everything doing" and "what work exists" — and
  at this width that distinction is carried by a divider and a heading alone.

Both are recorded rather than cropped out.

## Reproducing

The server ran on `127.0.0.1:37731` against `<clone>/.t3`, never `~/.t3/userdata`.
The walk script and the RPC driver live under `apps/server/.t3/`, which is
gitignored, because upstream `AGENTS.md` says scratch work is not committed.
Playwright and its Chromium came from the machine's existing install; this
repository gained no dependency and the disk gained no browser.
