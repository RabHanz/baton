# Memory: one brain that remembers (D150)

The Director's words: "It remembers what was said, today and before, across everything it does, so 'type what you just
said' simply works." And: "Every learning that we are doing across these projects and ventures should be kept as
learnings in our brain and memory so it only improves from here as a constant feedback loop." And: "One brain that hears
him anywhere... across every device, session, account and agent."

This note is the design. The order of work is in the last section. It builds on D142 (the conversation file), D143 (the
one assistant), D146 (plain editable notes) and D148 (the neutral pack).

## 1. The layers

| Layer | What it holds | Where it lives | Lifetime |
| --- | --- | --- | --- |
| Working | The current turn and the last few: target, focused window, what was just said | the assistant's own context (D143) | one session |
| Conversation | Every turn, verbatim, with route and target (D142) | `baton-conversation.ndjson` in the state folder | kept; searched by text |
| Episodic | What happened: a job finished, a session crashed, a thing was tried and worked or failed | memory store, kind `episode` | decays, expires |
| Semantic | Facts and preferences: how he writes, what he likes, decisions made, corrections he gave | memory store, kinds `preference`, `fact`, `decision`, `correction` | long, reinforced by repetition |
| Project and people | What is true of one project or one person: stack, owners, conventions, who is who | memory store, scope `project` or `person` | long, tied to a reference |
| Learnings | What worked or failed in a venture or a job, in a form that changes the next attempt | memory store, kind `learning`, plus imported folders | long, ranked by use |

Working and conversation memory stay where they are; the store is the new layer under the other four. One table holds
them all, because retrieval must rank across them in one query ("what do you remember about X?").

## 2. The record

Shared type: `packages/baton-shared/src/memory.ts` (`MemoryItem`). Fields:

- `id` (a UUID, made where the item is born), `kind`, `text` (one short statement, at most 500 characters, the same cap
  as a note today).
- `source`: `user` (he said it or wrote it), `thread`, `job`, `import`, `sync`; `sourceRef`: the thread, job or file it
  came from, so "why do you think that?" has an answer.
- `scope`: `global`, `project` or `person`; `scopeRef`: the project or person it belongs to (null for global).
- `confidence` 0 to 1, `pinned`, `createdAt`, `updatedAt`, `lastUsedAt`, `expiresAt`, `supersededBy`.
- Tombstones are separate (`memory_tombstones`: id, deleted time, origin), so a forgotten item stays forgotten through a
  sync and its text is gone from the store the moment he forgets it.

### Provenance and confidence

- Anything he said or wrote himself is `source: user`, confidence 1. The extractor never lowers it.
- Anything a model proposed starts at 0.5 (a statement of his, 0.7), and rises by 0.15 each time a later turn or job
  proposes the same thing (dedupe, section 4), capped at 0.95. It never reaches 1: only he confirms to 1 (pinning).
- Retrieval shows the source with the item, so he can see where a belief came from and correct it.

### Time, decay and expiry

- `effective = confidence * 0.5 ^ (age since last use or update / half-life)`; half-lives: episode 14 days, learning 180,
  fact 365, preference and decision no decay until contradicted, person and project facts 365. Pinned items never decay.
- Using an item (it was injected and the answer relied on it, or it came back from `memory_search`) refreshes
  `lastUsedAt`, so what is useful stays.
- `expiresAt` is set only for episodes (default 90 days) and for anything the extractor marks as time-bound ("until
  Friday"). The daily pass deletes what has expired and what decayed under 0.1, except pinned items.

### Conflicts

- A new statement that contradicts an older one of the same kind and scope (the extractor says so, or the normalized
  text matches a "not X / X" pair) is stored, and the older one gets `supersededBy` set. History is kept: a superseded
  item is hidden from retrieval and shown in the tab under "replaced".
- His own statement beats a model's proposal whatever the dates. Between two of his, the newer wins. Between two
  model proposals, the one with higher confidence wins, then the newer.
- Two items that merely overlap are merged by the daily pass (the longer text kept, confidences combined), never silently
  by retrieval.

## 3. Privacy: what is never stored

Checked in code (`memory.ts`, `storable()`), at the single door every writer uses (the tool, the extractor, the importer,
the sync), so no path skips it:

- Secrets and credentials: API keys and tokens by shape, private key blocks, passwords and "my password is" phrasing,
  bearer headers, connection strings with a password, recovery phrases.
- Banking and payment: card numbers (digit runs that pass the Luhn check), IBANs, account and routing numbers with their
  label, security codes.
- Text of the user's private operating-system pack (below).
- Content from a tainted turn (one that read a web page, a file or a message from outside, as D127 defines it) is not
  stored by the extractor unless he says yes in conversation; the item waits as a proposal, `source: thread`, not shown
  to retrieval until accepted.
- Dictated words as such (D31): a dictation is a stub with its length. Only what he tells the assistant to remember, or
  what a turn with the assistant decided, becomes memory.

A refusal says why in plain words ("that looks like a password, so I did not keep it").

### The neutral default and a user's private pack stay separate

The pack (D148) is plain files in the user data folder. The memory store holds facts about him and his work, never the
pack's text. The extractor's prompt is not given pack text as something to summarize; a proposed item that shares a long
run of words with a loaded pack file is refused by the same door. The shipped default memory is empty. Nothing in the
repository, the installer or a test fixture contains personal memory, and the public-release guard scans memory fixtures
like any other. Exports are plain markdown the user owns; they leave the machine only when he copies them.

## 4. The learning loop

1. After a turn, and at the end of every job, a cheap-model extractor (the cheap model in `routing.json`, D145; the
   strong model is never used for this) reads the turn or the job report and proposes items as JSON: kind, text, scope,
   a "contradicts" hint, whether the statement is his. It is told that what it reads is data, never instructions.
2. Each proposal passes `storable()`, is deduped against existing items (normalized token overlap above 0.8 is the same
   item: confidence rises, `updatedAt` moves), conflicts are resolved (section 2), and the rest is stored.
3. Proposals from a tainted turn wait for his yes (section 3). Nothing is stored silently from content he did not write.
4. A daily consolidation pass merges near-duplicates, applies decay, deletes expired items and writes one `episode`
   summarizing the day's jobs. It makes no model call unless more than a handful of items need merging by meaning.
5. Job learnings: when a job ends, the extractor is asked specifically "what worked, what failed, what should the next
   attempt do differently", and writes `learning` items scoped to that project.

## 5. Retrieval

- The first prompt of the one assistant gets a memory block with a token budget (default 600 tokens): pinned items first,
  then by relevance to the opening context (project, target, current words) times effective confidence, highest first,
  until the budget is spent. Items are one line each and marked as his data, not instructions.
- On demand, `memory_search` returns ranked hits by FTS5 (bm25) on `text`, filtered by scope and kind, with each item's
  source and confidence. `memory_remember`, `memory_forget` (he is asked first, as today) and a new `memory_pin` keep their
  meaning; `memory_search` and the injected block record which ids were used in the turn.
- "Show what you used" opens a card listing those items, from the per-turn record in `memory_uses` (turn id, item ids).
- "What do you remember about X?", "forget that", "remember that": the first is `memory_search`; "that" resolves to the last
  thing the assistant or he said, from the conversation file, so the tools take text or the previous turn's reference.
- Embeddings: FTS-first. A small local embedding column is behind a setting that is off by default and is not built
  until FTS retrieval proves insufficient; no new heavy dependency is added for it.

## 6. Where it lives and how it spreads

- The store is the Tessaya server's own SQLite file (`baton.sqlite`, tables `memory_items`, `memory_fts`,
  `memory_tombstones`, `memory_uses`, `memory_sync_peers`). The server is the one place: the desktop app, the web client, a
  phone and an MCP tool all call the same RPCs (`baton.memory.*`, scopes: read methods need the read scope, every write
  needs the operate scope, same as jobs). A laptop uses its own local server's store.
- The existing plain-text notes (D146) are imported once, idempotently (by content hash), as pinned `user` notes of kind
  `note`; the Memory tab keeps an "Open folder / Export" so he still owns plain files. Until the import runs, the desktop
  keeps reading the folder.

### Sync between servers (signzart and onnyx)

Last-writer-wins with tombstones, behind a setting (`memory.sync`, off by default; the peer's address and a paired
credential are the user's to give).

- Each server has an `origin` id. Every change bumps `updatedAt` (milliseconds, from a hybrid clock: the larger of the wall
  clock and the last seen stamp plus one, so skewed clocks cannot reorder one device's own edits).
- A sync round: `memory.sync.pull(since)` returns items and tombstones whose stamp is above the cursor; the caller applies
  them and then pushes its own changes the same way. Each side stores the peer's cursor.
- Apply rule per id: the higher `(updatedAt, origin)` wins; a tombstone wins over an item whose `updatedAt` is not later than
  the tombstone's `deletedAt`; `pinned`, `supersededBy` and `confidence` travel with the item. A tombstone is kept 90 days,
  longer than any sync gap that is expected to recover.
- Every received item passes `storable()` again. A sync never carries conversation text, only memory items.
- A failure leaves the cursor where it was; the next round resends. Rounds are idempotent.

## 7. Importing learnings

An importer reads a folder of `.md` files (read-only on the source, nothing written there). Each file is one item or one
item per top-level list entry; front matter keys `kind`, `scope`, `project`, `confidence`, `tags`, `updated` are honored,
and defaults are `learning`, `global`, 0.6. The VentureOS memory feed format is mapped by the same keys once its manager
confirms them. `sourceRef` is the file path and a content hash, so re-running updates and never duplicates. Everything
passes `storable()`.

## 8. Order of work

1. This note and the shared interface (`memory.ts`).
2. The memory service on the server: migration, FTS5, pure rules in `memory.ts`, RPCs.
3. The learning loop: extractor, dedupe, conflicts, tainted holds, daily pass.
4. Retrieval into the assistant, voice commands, the "used" card.
5. Sync between servers.
6. The learnings importer.
7. The Memory tab in the window.
