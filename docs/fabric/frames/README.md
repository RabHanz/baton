# Frames

Screenshots of the real client, not mockups and not descriptions. Every frame
here came from the built web app, driven by Playwright at 1440×900. Nothing was
staged: the work sessions, the threads and the states were produced by the proof
runs described in `../STATUS.md`.

Two kinds of frame, and the difference matters when reading them:

- **Phase frames** (`phase-2/`, `phase-4/`) — a server on a `VACUUM INTO`
  snapshot of real data, with the Fabric client setting switched on by the walk.
  They show the surfaces carrying work.
- **Deploy frames** (`deploy-2026-09-18/`) — the Director's own live server after
  the fork was installed on it, with **no setting touched by anyone**. They show
  what he gets on opening it, which at that moment is an empty fleet, because the
  live environment has no work sessions yet.

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

## Deploy 2026-09-18 — the fork on the live server

`0.0.43-fabric.1` running as the `t3code` user service on signzart-prod, against
the Director's own `~/.t3/userdata`. A fresh browser profile, paired once, then
sent to the app; no client setting was set by the walk, which is the whole
assertion these four frames make.

| Frame                                             | View                                 | What is on screen                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy-2026-09-18/01-live-app.png`               | Whole client, first load             | The Fabric intent input sits at the top of the sidebar on a default profile — `fabricWorkSessionsEnabled` now defaults on. Under it the divider, then `No threads yet`. The header reads `VentureOS / New thread`, so the project registration survived the runtime switch. The centre is T3's own new-thread view, unchanged. |
| `deploy-2026-09-18/02-sidebar-default.png`        | Sidebar, cropped and doubled         | The same rail at a legible size. No fleet rows, because the live environment has no work sessions yet — the input is deliberately rendered for an empty fleet, since "start work on X" is the sentence someone types into one.                                                                                                 |
| `deploy-2026-09-18/03-live-app-intent.png`        | Whole client, a sentence typed       | `What needs me?` typed into the input, and the preview line under it.                                                                                                                                                                                                                                                          |
| `deploy-2026-09-18/04-sidebar-intent-preview.png` | Sidebar with the preview, cropped 2× | `↵ Say what needs you.` — the live server parsed the sentence, resolved it to the fleet-status command and described what Enter would do, before anything ran. This is the intent RPC answering against the live database, not a local fixture.                                                                                |

What they do not show: a populated fleet. That would mean writing invented work
sessions into his real environment, so it was not done; `phase-2/` and
`phase-4/` are the populated views, from the snapshot.

## Deploy 2026-09-18, second round — the account, and a model reading a sentence

Four frames. The first two are the snapshot, because the live box has no work on
it yet and therefore no fleet rows to carry an account; the last two are the
Director's own live server.

| Frame                                                     | View                             | What is on screen                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-2026-09-18-account/01-fleet-account-redacted.png` | The fleet, cropped               | Ten rows, and under each attribution line a redacted address. The account a row runs as is now on the row: name from the instance, address from the login. Redacted by default, the same treatment the provider settings card gives it — a sidebar is the thing people screenshot. |
| `deploy-2026-09-18-account/02-fleet-account-revealed.png` | The same, one address revealed   | `optimapacifist@gmail.com` under the first row. One click reveals one address, and the click does not also select the work session.                                                                                                                                                |
| `deploy-2026-09-18-account/03-live-grammar-refuses.png`   | The live server, sentence typed  | `what's cooking`, and the grammar's refusal: _"I could not place …"_. This is what the preview shows while typing, and it costs nothing — the live preview never calls a model.                                                                                                    |
| `deploy-2026-09-18-account/04-live-model-read-it.png`     | The live server, one Enter later | `↵ again to run Check overall status of…`. A model read the sentence through his own account and the reading is shown. **Nothing ran**: the second Enter is his.                                                                                                                   |

Both live frames were taken on `0.0.43-fabric.2`. The build that ended up
deployed is `0.0.43-fabric.4` — two defects found by this deploy and fixed in
between — and its model path was re-proven on both machines over the RPC rather
than re-photographed, which is why the report quotes text rather than showing a
fifth frame.

**What they also show, unprompted:** at 256 px the `↵ again to run` marker and
the description do not both fit, so the description truncates. The marker earns
its place — it is the difference between "this will run" and "this is what I
think you said" — but the line needs work before this is a daily surface.

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

For the phase frames the server ran on `127.0.0.1:37731` against `<clone>/.t3`,
never `~/.t3/userdata`. The deploy frames are the exception the Director
authorised by name ("you can restart the t3 as I haven't used it yet"): that walk
ran against the installed service on `127.0.0.1:3773`, paired with a token minted
by `t3 pair`, and wrote nothing — it typed a sentence and never pressed Enter.

The walk scripts and the RPC driver live under `apps/server/.t3/`, which is
gitignored, because upstream `AGENTS.md` says scratch work is not committed.
Playwright and its Chromium came from the machine's existing install; this
repository gained no dependency and the disk gained no browser.
