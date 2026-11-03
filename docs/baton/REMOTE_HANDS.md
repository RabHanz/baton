# Remote hands

A remote session (the Hetzner manager, a phone) can drive this computer's apps through Tessaya itself: no ssh, no copied scripts,
no console windows. Today's manager path costs 5 to 10 s a step because every step is a new ssh login plus a new PowerShell.

## Shape

```
remote session --HTTPS bearer (baton:hands)--> hub server /tessaya/hands/call
hub server --long poll (baton:hands-host)--> desktop app --> gate --> hands tool --> answer back the same way
```

- The **server only brokers** (`packages/baton-shared/src/remoteHands.ts`, `apps/server/src/baton/BatonHandsApi.ts`): it allows a fixed list
  of tools, holds a call until the desktop takes it (a long poll, so a call arrives at once), and writes an audit line
  (`baton-hands-audit.ndjson` beside the database; typed text is logged as its length, never its content).
- The **desktop owns the gate and the mouse guard**. Every call goes through the same `judgeToolCall` and `createAgentGate` as the assistant's
  own tools; an "ask" goes to the Director as a normal question, and with the **Director-away flag** on it is a refusal, because nobody can answer.
- **Scope `baton:hands`** is never in the standard scopes. The Director issues it to one session's token on his own computer
  (`auth token --scopes baton:hands`); revoking that session ends it. `baton:hands-host` belongs to the desktop's own session only.
- **No windows, no focus theft.** Picture of a named window by `PrintWindow` (works occluded and in the background); controls acted on by their UI
  Automation patterns first; foreground input only when a control has no pattern, and then the previous window gets the keyboard back.
- **Ops tools**: `app_version`, `log_tail` (named logs only, last N lines), `process_list` / `process_stop` (only an id `process_list` returned),
  `app_update` (the app's own updater, to a given version, replacing scp and scheduled tasks), `open_page` (a page in the Home window).

## Built so far

Broker, scope, HTTP routes and audit (this change). The desktop side (host loop, window picture, pattern actions, ops tools, away flag) and the
latency numbers on the CI desktop follow in separate changes; this note is updated as each lands.
