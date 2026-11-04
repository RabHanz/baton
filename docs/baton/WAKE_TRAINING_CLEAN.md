# Wake-word training with licence-clean data (for an MIT release)

Decision (Director, 2026-11-01): Tessaya's wake word is trained in British English with varied voices on data whose licences allow an MIT release. The current Sebastian, Alfred, Freya and Onyx models were trained on sets with unclear or non-commercial terms (`LAUNCH.md` section 2) and block that.

Run it: `gh workflow run baton-wake-train.yml -R RabHanz/tessaya --ref main -f word=tessaya -f clean=true`. Free GitHub runners, about 5 hours; the model comes back as the `wake-tessaya` artifact. `clean=false` keeps the old data path for the existing words.

## What changes with CLEAN=1

| Part                                 | Before                                                                                | Clean                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positive voices (Piper TTS, British) | vctk, aru, semaine, alba, jenny_dioco, northern_english_male, southern_english_female | vctk (CC BY 4.0), aru (CC BY 4.0), alba (CC BY 4.0), cori (public domain). Dropped: semaine (CC BY-NC-SA), northern_english_male and southern_english_female (CC BY-SA), jenny_dioco and alan ("see the page", unverified) |
| American top-up voices               | LibriTTS-R generator (CC BY 4.0)                                                      | same                                                                                                                                                                                                                       |
| Room impulses                        | MIT environmental impulse responses                                                   | same                                                                                                                                                                                                                       |
| Background audio                     | AudioSet clips (YouTube, per-clip terms)                                              | MUSAN noise and music (CC BY 4.0)                                                                                                                                                                                          |
| Negative features                    | openWakeWord's ACAV100M features (YouTube audio)                                      | computed here from LibriSpeech train-clean-100 speech (CC BY 4.0) plus MUSAN                                                                                                                                               |
| Validation                           | openWakeWord's validation set                                                         | LibriSpeech dev and test-clean plus held-out MUSAN noise                                                                                                                                                                   |

## Still open

- The shared feature models (`melspectrogram.onnx`, `embedding_model.onnx`, openWakeWord v0.5.1) are grouped with the pre-trained models under CC BY-NC-SA in the project's README; the README says the embedding model comes from Google's speech embedding (Apache-2.0). Unverified. If it does not hold, replace the feature extractor or the wake engine behind the `WakeProvider` seam.
- Piper TTS: check the licence of the version used at training time (the voices' dataset licences are listed above).
- Attribution lines for CC BY sets go in `THIRD_PARTY_NOTICES.md` when a model ships.

## False wakes

The wake log is not enough to tune thresholds: the logged score is the fraction of the word's own threshold at the moment it fired, so it is always at least 1.0 (real wakes 1.02 to 1.11, false ones 1.00 to 1.11). A real measure needs audio. Plan: replay room audio, speech (LibriSpeech and podcast-style speech), and Tessaya's own speech through the scorer and count fires per hour; fire only after a few consecutive chunks above threshold; confirm by recognising the word itself before the pill wakes; keep dropped-wake pre-roll clips (with the recording setting on) as negative samples; fewer active words. Tracked on issue #78.
