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

## Transport 3: the shared computer's dispatch shell

`ssh -i <machine key> <user>@<host> <subcommand> ...` (the shell is the key's forced command, so the
subcommand is the remote command). **Use the computer's public address, not a tailnet one:** Tailscale SSH
answers port 22 on the tailnet and ignores authorized_keys, and with it the forced command. `-n` is added
for calls with no stdin; `dispatch` sends the brief (4,000 characters at most) on stdin. Values are limited
to letters, digits and `. _ : / @ -`. `approve` and `deny` use the separate approver key and go over this
transport only; the shell refuses the approver caller when run locally.

| Command | Answer (fields Tessaya reads) |
| --- | --- |
| `dispatch --provider P --repo R --branch B --task-file - [--label L]` | `{id, state:"awaiting-director", card:{asked_by, task, repo, branch, cap_points, usage, suggested_provider}}` |
| `status <id>` | `provider, account, answer_ref, started_at, weekly_before, session, ledger, error, closed_at, weekly_after, points_used, over_cap, pr` |
| `list [--mine] [--label L] [--state S]` | `{requests:[{id, provider, state, account, branch, repo, caller, label, points_used}]}` |
| `usage` | `{cap_points_per_run, points_used_7d:{provider:{account:points}}, providers:{id:{ready, needs, accounts:{name:{available, pct, rejected, resets_pkt}}}}}` |
| `approve <id> --provider P --account A --answer-ref R` | the request, now `running`, with `session` and `weekly_before` |
| `deny <id> --reason R`, `cancel <id>` | `{id, state}` |
| `close <id> [--pr URL]` (approver) | `{id, state:"closed", provider, account, points_used, over_cap, pr}` |

Ids are strings (`YYYYMMDD-HHMM-xxxx`, UTC). States: `awaiting-director`, `running`, `failed-to-start`
(shown as failed, with `error`), `denied`, `cancelled`, `closed`. `pct: null` is unknown: never zero, never
trips the cap. `resets_pkt` is shown as the shell words it ("Mon 12:00", PKT). A refusal is
`{"refused": "<reason>"}` with exit 1 and is shown as worded. `providers.<id>.ready` and `needs` say which
assistants the shared computer can run and what a missing one needs.

The shell's providers are offered on the card as they are reported; every request waits there until
the Director picks a provider and an account. Keys are file paths in settings and are never generated here.

## Assumptions to confirm in the pilot

- `claude --cloud "<description>"` starts a cloud session non-interactively and prints a
  `claude.ai/code/...` link. The command line is built in `local.ts` and nowhere else.
- `codex cloud exec --env E --branch B "<prompt>"` prints a task id or link; `codex cloud status` prints
  text with a state word. There is no cancel and no JSON output. Not tried: no Codex Cloud login yet.

## In the window

- **Cloud** page (`cloud/cloudRows.ts`): the switch (off by default), where the logins are (This computer,
  Another computer of mine, Advanced), the flag cap (1, 2, 3 or 5 points), what each assistant can do
  with the exact sign-in line, and my requests (state, account, branch, link, PR, before and after, points).
  Refreshes every 60 s while open.
- **Approval card** in Approvals (and a needs-you row on Now): provider, then account, then confirm;
  nothing preselected; accounts rejected or at 98% or more are greyed; Deny always there. Cards are
  rows with ids `cl.p|a|ok|deny.<provider>:<id>[:<choice>]`; the rules are `card.ts`.
- **Assistant tools**: `cloud_dispatch`, `cloud_status`, `cloud_list`, `cloud_cancel`, `cloud_usage`,
  `cloud_approve`. Dispatch is routine because it only makes a waiting request; a brief built from web
  or file content must say `from_web_or_file`, else the gate asks. `cloud_approve` reads the card back
  and shows a dialog only the Director can press.
- A request held by the shared computer (transport 3) can only be answered there, so its card offers
  only that provider; requests held by Tessaya (transports 1 and 2) can be started by any ready assistant.

## Not built yet

The first-run step "Cloud tasks", the phone page card, the Vault option for the SSH key text with the
Windows Hello gate, and picking a hub on another environment (the hub transport calls the environment
this window is connected to).
