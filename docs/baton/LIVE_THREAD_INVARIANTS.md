# Live thread invariants

A live thread mirrors one running terminal session (`baton-live4:<session id>`). These hold at all times:

1. One session answers it. A turn, an explicit provider switch or a model pick that names another provider instance is
   refused and logged as `live-thread-new-session-blocked`; a model or effort change goes into the session itself
   (`/model`, `/effort`), resuming the same session id first if it is stopped. The live selection is pinned, so a stale
   composer selection cannot cause a live-to-live handoff.
2. The binding is checked every 30 s per followed session. A thread on another provider instance, or on the live
   instance without its session, is bound again to the running session with the same id, and a `rebound` line is
   written to `baton-mirror.ndjson`. A session is never chosen by guessing; a lost binding with exactly one running
   session in the folder delivers to it, otherwise the message is kept in `unbound-messages.ndjson` and shown back.
3. A handoff twin is retired with `baton.sessions.retirehandoff` (explicit confirm token and `caughtUp`).
4. `baton-mirror.ndjson` names every mirror decision: the live session set, follow or skip per session, failures, and
   which question the pane shows.

5. The thread header and the Sessions row show the real binding (Herdr pane, T3-hosted handoff session, stopped). Reattach
   (`baton.sessions.reattach`, service `reattach`) binds again by session id; with no id match and exactly one running
   session in the folder it only offers "Reattach to <pane>?" and acts on that pane's confirmation.
6. A kept unbound message is shown in its thread with a Retry button and is sent again through the thread once it is
   bound to its running session. The server only appends to `unbound-ledger.ndjson` (thread stamp, claimed before the
   resend, released if it fails), so a message is neither dropped nor sent twice.
