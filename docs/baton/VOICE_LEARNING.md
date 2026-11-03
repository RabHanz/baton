# Using his kept voice to improve recognition: what is real

**What exists now.** Recognition itself does not change. Parakeet runs in the dictation sidecar, which
takes no hint, prompt or hot-word list. What does change from his corrections and wording
(`packages/baton-shared/src/vocabulary.ts`): the transcript is corrected for near-misses of his names
and terms before clean-up (`biasTranscript`), and the same list goes into his own Claude clean-up call.

**The offline set.** Each turn he fixes in the field is stored with the words as heard, what Tessaya
wrote and what he changed it to (`history.sqlite`, `corrected = 1`, `fixed`), plus the clip when
"Keep my voice recordings" is on. `node scripts/tessaya/clip-eval.mjs <state-dir>` scores word error
against his fix before and after the vocabulary step. That is a text-level number; it says nothing
about recognition, and no improvement is claimed from it.

**What a real adaptation path needs** (not built):

1. Re-running the recogniser on the kept clips, so the score is audio in, text out, and a change of
   model or bias can be compared on his own voice. Needs the sidecar to expose a batch-transcribe
   command (it has `read_wav`) so the eval can run offline.
2. Contextual biasing: Parakeet (NeMo) supports word-boosting at decode time, but the engine the
   sidecar embeds (transcribe-cpp) exposes no such option. Either upstream support or a second pass
   (rescoring the n-best list with his vocabulary) is required.
3. Fine-tuning: a few hundred corrected clips is a start for a small adapter, but it needs a training
   run off this machine, his consent to that audio leaving it, and a held-out slice of his clips to
   prove it beat the base model before it is used.
4. The hold-key path records inside the sidecar, so its audio is not available to the desktop yet:
   the sidecar must write the recording (it already links `hound`) and report its path with the text.
   Today only spoken turns and wake-word dictation keep audio.
