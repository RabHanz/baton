# Semi-sentient: what "present" means (D149)

The Director's words (2026-11-01): "a semi-sentient assistant that can do everything and keep track of everything", one that keeps track of sessions and projects "so they're not left unattended forever. It knows if they crashed, failed, or what they did from time to time through proper monitoring." And: "a capable person in the room, not a tool."

Tessaya is the one assistant of D143. This note says what it adds to be present rather than only responsive. It adds no second brain: every part below is state and tools the one assistant reads and uses.

## The five parts

1. **Awareness.** A small "now" it always carries: the active app and window title, how long he has been idle, which project and session he has focused, the jobs running, and what Tessaya itself is doing or waiting on. Data for the assistant, never instructions.
2. **Commitments.** Things he asked it to keep track of ("check back on the deploy", "remind me", "keep an eye on X"), each with an owner, a due time, a status and where it came from. Durable. Surfaced on the Now page and in the morning brief.
3. **Initiative.** It decides when to speak up. Inputs: session and job events, CI failures on his repositories (read-only), approvals nobody answered, commitments due, anomalies. A score (importance x urgency x cost of interrupting) with quiet hours, an hourly budget, de-duplication, snooze and "stop telling me about X". The output is an offer card: Yes, Later, Never. Yes starts a job through the normal plan-first path.
4. **Self-state.** It can say plainly what it is doing, what it waits on, what it learned today, and what it declined and why.
5. **What needs me.** The first deliverable and Stage 5's single test: one short ranked list across sessions, jobs, approvals, the ledger and deadlines, by voice and text. Finished-but-unseen work (a worker that ended and nobody noticed) is on it.

## Limits (these do not move)

- **It never acts unattended without a standing permission** he gave for that job (D145). An offer is a question. Reading and noting are routine; anything that sends, posts, spends or changes something for him still goes through the gate in `operator.ts`. Money is refused.
- **Commitments are notes, not authority.** A commitment created after the assistant read something untrusted asks first, like a memory note (the gate's `outgoing` rule).
- **Read-only sources.** The ledger and deadlines are read with `gh issue list` and a file read. Nothing is written back. Postgres and Cockpit are reached only through interfaces that already exist and read.
- **A source it cannot read is said**, so a short list is never mistaken for a clear one.
- **No private defaults.** Ledger repositories and the deadlines file are settings and empty by default; the product depends on no maintainer's tooling.

## Privacy rules for awareness

- Each source (window title, idle, focus, jobs) is its own switch, **off by default**. Idle and focus use only what Tessaya already holds.
- Nothing is kept beyond a rolling window in memory (default 30 minutes); nothing is written to disk and nothing leaves the machine except inside the turn that asks for it.
- Window titles are matched against a deny-list (password managers, banking, private browsing, sign-in pages) and replaced with "a private window" before they enter the state.
- Never typed text, never clipboard, never screen pixels. Looking at the screen stays the separate, consented `screen_capture`.
- The assistant sees the state as data in its context line; text in a title is never an instruction (it taints like any read).

## Order of building

needs_me, then awareness, commitments, initiative, the Now page, and the Presence group in settings, each its own PR with unit tests. Memory is owned by another lane: presence calls its interface when it lands and uses a local stub until then.
