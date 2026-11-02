# The phone: what exists and what does not

Plain statement, 2026-11-02.

**What there is.** T3 Code's mobile app (React Native, iOS and Android, from the stores) connects to any T3 server and controls its threads. Tessaya runs on a T3 server, so a phone can open the threads Tessaya's jobs and weaves use, read what a worker said, and answer a session's question in its thread. That is T3's feature, not Tessaya's.

**What there is not.** Tessaya has no phone app and no phone surface of its own. The things that make it Tessaya run in the desktop app and only there (Windows first): the wake word and hold-key dictation, the pill, the window with its Now, Jobs, Approvals, Memory and Vault pages, presence and offers, snippets, transforms, and the vault. A phone cannot approve a plan in Tessaya's window, hear an offer, or use a secret from the vault.

**Server-side state that a phone could already reach.** Memory (shared across devices through the server), the commitments ledger (server store), the weave record, and job terms live on the server. The T3 mobile app does not show these pages.

**Not planned until he decides:** a Tessaya mobile surface; any push notification (see `NOTIFICATIONS.md`); voice on the phone. The queue puts macOS, Linux and mobile after Windows (`PLATFORMS.md`).

**The smallest useful step if he wants one.** Approvals and "what needs me" as a read-only page served by the Tessaya server (no push), opened from the phone's browser over the tailnet. Not built.
