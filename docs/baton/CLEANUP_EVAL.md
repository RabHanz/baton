# Dictation clean-up eval

`scripts/tessaya/cleanup-eval.mjs` degrades real messages the way a recogniser's raw text reads (no
capitals or punctuation, fillers, a false start, a "scratch that" self-correction), cleans them with
Tessaya's local pass and with local-then-Claude (haiku), and scores 0..1 per criterion against the
original. The corpus is his own messages from the history index and is **not** in the repo; pass its
path. Run: `node scripts/tessaya/cleanup-eval.mjs <corpus.json> --claude --limit 30 --out results.json`.

Criteria: wording (words kept, in order), filler (none left that he did not say), selfcorrect (the
taken-back phrase and the marker are gone), punct (capital start, a closing mark, "I" capitalised),
invented (at most one word that was in neither the input nor the message).

| 2026-11-01, 30 messages                       | wording | filler | selfcorrect | punct | invented |
| --------------------------------------------- | ------- | ------ | ----------- | ----- | -------- |
| local only                                    | 1.00    | 0.20   | 0.67        | 0.58  | 1.00     |
| local, then Claude (before the prompt change) | 0.96    | 0.83   | 0.97        | 1.00  | 0.90     |
| local, then Claude (after)                    | 0.96    | 0.87   | 0.93        | 1.00  | 0.97     |

Findings: local alone does not punctuate, drop "you know" or apply a self-correction, so raw text
with no sentence marks now always goes to the model. Claude kept "you know" and an occasional taken-back
phrase; the rules name both and carry one example of each. The differences after the change are within
the run-to-run spread of a 30-message sample. Not measured: Wispr Flow's own output on the same input,
and anything on Windows.
