# Sessions on every machine

`baton.sessions.*` (contracts in `sessionCatalog.ts`, logic in `apps/server/src/baton/SessionCatalog.ts`) lists every
Claude session on an environment, running or stopped, and brings one back. The client asks each connected
environment (the same connection the hub uses; nothing tmux, no new transport) and adds its name.

- **list**: running sessions (live descriptors), transcripts on the machine (newest 600, any account's config
  folder, title from the conversation's summary or first message), and, when words are given, the history index
  (`BATON_HISTORY_SEARCH`). A history-only row cannot be resumed (its transcript is gone) and says so.
- **resume**: `baton --resume <id> <folder>` in the folder the transcript names, then wait up to 45 s for the
  session to be in a Herdr pane and not mid-turn. Idempotent; a second tap while it works returns `resuming`.
- **send**: a running Herdr session gets the text typed in; a stopped one keeps the message, resumes, waits until
  ready, then delivers in order. A failure keeps the message and says why. A plain-terminal session is never
  claimed to be reachable.
- **create**: `baton <folder> claude`, then wait for the new session to report in.
- **folders**: recent folders (live and from transcripts) that still exist, for the New session picker.

State is in memory on the server (resuming, waiting messages); a restart forgets a resume in flight, and the next
tap starts it again.
