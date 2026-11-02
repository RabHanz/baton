# Cloud dispatch

Send a coding task to a harness's cloud (Claude, Codex, later Gemini, Cursor, OpenCode, Grok) and have
the Director approve each one on a card. Two separate choices: which **harness** does the work, and
which **transport** reaches the computer that holds its login. Both are interfaces in
`packages/baton-shared/src/cloud/`; the card, the Cloud panel, the usage cap and the ledger do not
know either.

## Transports

| | How | Needs | Default |
| --- | --- | --- | --- |
| 1. Local | Tessaya runs the harness's own program on this computer with this computer's own login (`claude --cloud`, `codex cloud exec`). | The harness installed and signed in. Nothing else. | yes |
| 2. Hub | One computer holds the logins and runs the program; the others call it over the T3 connection they already have, as `baton.cloud.call`. | A paired connection (scopes read, operate). | no |
| 3. SSH | The VentureOS `cloud-dispatch-shell` over SSH with one key per caller and a separate approver key. | Host, user, key files. Advanced, named by what it holds. | no |

A request waits for a yes in the place that owns the login: the central shell on transport 3 (its own
`awaiting-director` state), Tessaya's list on transports 1 and 2. Nothing starts before the Director picks
a provider and an account on the card.

## The provider interface (`types.ts`)

`id`, `transport`, `label`, `driver` (T3's driver kind: `claudeAgent`, `codex`, `cursor`, `opencode`,
`grok`), `capabilities` (`resultKind` pr | diff | branch, `cancel`, `usage`, `diff`, `apply`),
`approval` (remote | local), `setup()`, `detect()`, `accounts()`, and `dispatch`, `status`, `list`,
`cancel`, `usage`, `approve`, `deny`, optionally `diff` and `apply`. Accounts are named by the login
(an address or the login's folder name), never a slot number. Adding a harness is one file.

Provider status today: Claude (local, hub, ssh), Codex (local, hub), Gemini/Jules, Cursor, OpenCode and
Grok are stubs that say what a real adapter needs.

## Usage and the cap

Every provider reports `weeklyPercent`, `resetsAt`, `rejected` and `pointsThisWeek` per account, or null
for a figure it does not have. Null is shown as unknown and never trips anything. The rules are the same
for all: an account is not offered when rejected or at 98% or more; a run that uses more than 2 points of
its own provider's weekly figure is flagged for review.

## Transport 3: the VentureOS shell contract

`ssh -i <machine key> <user>@<host> cloud-dispatch <subcommand> ...`; one JSON object or JSON lines per
call. Values are limited to letters, digits and `. _ : / @ -` so no quoting is needed; the brief goes on
stdin (4,000 characters at most). Approve and deny use the approver key.

| Command | Fields Tessaya reads (all optional, tolerant of snake_case) |
| --- | --- |
| `dispatch --repo R --branch B --task-file - [--label L] [--usage U]` | `{id, card:{task,...}}` |
| `status <id>` | `id, state, task, repo, branch, caller, label, account, session|sessionLink|url, pr, expectedUsage, weeklyBefore, weeklyAfter, pointsUsed` |
| `list [--mine] [--label L]` | one such object per line |
| `cancel <id>` | any JSON object |
| `usage` | `{accounts:[{account, weeklyPercent, resetsAt, rejected, pointsThisWeek}]}` or the same objects as lines |
| `approve <id> --account A --answer-ref R` | the request, now running |
| `deny <id> --reason R` | any JSON object |

Errors: a non-zero exit, with `{"error":"..."}` on stdout when the shell can say why; exit 255 from ssh
means the computer could not be reached.

Questions for VentureOS: ids numeric or string; whether `resetsAt` is the PKT wording or an ISO time;
whether `usage` includes `rejected` per account; whether `list` takes `--label`; what `state` values
exist besides `awaiting-director`, `running`, `denied`, `cancelled`, `closed`.

## Assumptions to confirm in the pilot

- `claude --cloud "<description>"` starts a cloud session non-interactively and prints a
  `claude.ai/code/...` link. The command line is built in `local.ts` and nowhere else.
- `codex cloud exec --env E --branch B "<prompt>"` prints a task id or link; `codex cloud status` prints
  text with a state word. There is no cancel and no JSON output. Not tried: no Codex Cloud login yet.
