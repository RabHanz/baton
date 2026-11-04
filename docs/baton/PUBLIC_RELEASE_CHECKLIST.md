# Public release checklist (state as of 2026-11-02, after the memory, vault and release-readiness work)

What stands between this repository and a release to strangers. Facts and sources are in `LAUNCH.md`; this is the
short list. Nothing here decides the licence or any legal question: those are the Director's.

## Done and guarded

- **No private names, keys or addresses in shipped code.** `scripts/tessaya/guard-private.mjs` fails CI (and a unit
  test) on a maintainer host or account, a cloud provider used as a machine name, an API key or token, a tailnet
  address, or a hashed phrase of a private operating-system pack. Tests, fixtures and `scripts/tessaya/` (the
  maintainer's operator tools, not in the installer) are out of scope. Its allow list is one file and only shrinks.
- **The operating-system pack is neutral by default**; a user's own pack loads from their user data folder and can
  never be committed (D148).
- **Updates, the server archive and the installer** fetch from this repository's public releases with checksums,
  and need nothing of the maintainer's machines. Rotation and token instances are off unless set.
- **Voice is local**; nothing but the user's text goes to the brain they chose (LAUNCH section 4).
- **Third-party notices are checked by CI.** `docs/baton/notices.json` lists every dependency, crate, model file and font that
  Tessaya's own code ships or downloads; `scripts/tessaya/check-notices.mjs` (in `verify`) fails when one has no entry, no mention
  in `THIRD_PARTY_NOTICES.md`, or no licence text. Texts are in `docs/baton/licences/`.
- **The stranger-install proof exists** (`baton-voice-proof.yml`, `stranger-proof.ps1`): clean Windows machine, silent install,
  first run, nothing private in the user data, only default wake words, no user pack, uninstall removes the app and keeps the
  user's data. It has been written but its **first run is still to be read** (dispatch the workflow with a released tag).
- **macOS and Linux have smoke jobs** (same workflow, `platform-smoke.sh`), and `PLATFORMS.md` says what works there.
- **The vault and memory keep secrets out of logs, History and prompts** (VAULT.md, MEMORY.md); public-release safe by design, no
  secret in the repository or any test.

## Repository setting to switch on (owner, two clicks)

`.github/SECURITY.md` tells people to report a vulnerability through the repository's **Security** tab. That button exists only when
private vulnerability reporting is on. Nothing in the code can turn it on; the repository owner does:

1. Open the repository on GitHub, then **Settings** and, in the left list under _Security_, **Advanced Security** (older layouts:
   **Code security and analysis**).
2. Find **Private vulnerability reporting** and press **Enable**.

Check it: the **Security** tab now shows **Report a vulnerability**, and the issue chooser's "Security problem" link
(`.github/ISSUE_TEMPLATE/config.yml`) opens a private advisory form. Until then the policy's fallback applies (open an issue that
only asks for a private channel).

## Still blocks a public release

Live state of each, with who must act.

1. **Licence (Director).** Not chosen; this note does not choose. What each choice means for what ships today:

   | Shipped piece                                                                                   | Licence it carries                                                                    | If MIT                                                                                                                                                      | If a stricter (non-commercial or source-available) licence                                                               |
   | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
   | Tessaya's own code                                                                              | its own                                                                               | MIT is free to choose                                                                                                                                       | free to choose                                                                                                           |
   | Electron, ONNX Runtime, Silero VAD, whisper.cpp, Handy crates, Rust crates, Clicky-derived code | MIT / Apache-2.0                                                                      | compatible, notices kept                                                                                                                                    | compatible, notices kept                                                                                                 |
   | Fonts (Newsreader, Schibsted Grotesk)                                                           | SIL OFL 1.1                                                                           | fine (not sold alone, names kept)                                                                                                                           | fine                                                                                                                     |
   | `melspectrogram.onnx`, `embedding_model.onnx`                                                   | CC BY-NC-SA 4.0 (openWakeWord README)                                                 | **cannot ship under a commercial MIT product as they are**: non-commercial and share-alike; ship without them, replace them, or get the author's permission | allowed only if the whole product stays non-commercial; share-alike applies to the model files (and adaptations of them) |
   | `sebastian`, `alfred`, `freya`, `onyx` wake models                                              | trained on sets that include non-commercial data                                      | **same as above**: retrain clean or drop; the default words Sebastian and Alfred are among them                                                             | allowed if non-commercial                                                                                                |
   | Tessaya wake model                                                                              | not shipped yet (`models/` has no `tessaya.onnx`); the clean training workflow exists | clean CC BY / public-domain sets, attribution in the notices                                                                                                | same                                                                                                                     |
   | Parakeet (CC BY 4.0), Pocket TTS weights (CC BY 4.0)                                            | downloaded on first use, not redistributed by Tessaya                                 | fine with attribution                                                                                                                                       | fine with attribution                                                                                                    |
   | The Anthropic and OpenAI terms for driving a user's login                                       | separate from the licence                                                             | still blocks (item 3)                                                                                                                                       | still blocks                                                                                                             |

   Decision needed first; then the models above follow from it.

2. **Wake models.** Unchanged: the shared feature models still sit under CC BY-NC-SA, and the four older words under mixed data.
   The clean training pipeline for the word Tessaya exists (`WAKE_TRAINING_CLEAN.md`, `baton-wake-train.yml`) and has not
   produced a shipped model. The default set still names given names; the voice lane decides the neutral set.
3. **Anthropic and OpenAI terms (Director).** Not checked by anyone but him. Safe scope until then: the single-login path.
4. **Code signing.** Still unsigned on both platforms. Windows needs a certificate or a signing service; macOS needs a
   developer identity and notarisation. Neither has been bought or applied for. Needs the Director's choice of vendor and
   a legal publisher name.
5. **Trademark search for Tessaya (Director).** The 2026-11-01 screen is not clearance; a proper search is his to commission.
6. **Release home.** Updates and the server archive point at `github.com/RabHanz/tessaya`, a personal account. Move to
   an organisation repository together (`BatonUpdater`, `fetch-server-archive.sh`, `apply-release-branding.sh`, `codemagic.yaml`).
7. **The maintainer's account table.** `ClaudeAccountInstances.ts` is still the guard's one allow-list entry; set
   `BATON_CLAUDE_ACCOUNT_INSTANCES` on both boxes, then delete the table.
8. **Privacy and support pages.** Not written: a plain statement of what leaves the machine, and a way to report a problem.
9. **A clean-machine install proof.** Automated now (see above) but not yet run; the one thing it cannot replace is a real
   person on a real Windows machine who is not the maintainer.
10. **Platform parity.** macOS and Linux are smoke-tested only; native features (UI Automation, Hello, the dictation sidecar)
    are Windows today. See `PLATFORMS.md`.
