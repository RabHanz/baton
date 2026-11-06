# Launch readiness: facts

Facts from this repository and the named sources, as of 2026-11-01. Nothing here is legal advice, and
nothing here claims Tessaya complies with anyone's terms. Items marked **Director** need his decision.

## 1. Driving a user's own Claude or Codex subscription

**What Tessaya does** (code: `apps/desktop/src/baton/screen/claudeVision.ts`, `codexOperator.ts`;
`apps/server/src/provider/Layers/ClaudeAdapter.ts`; decision D1 in `DECISIONS.md`):

- Starts the user's own installed `claude` command as a child process (`-p` with stream-json in and out,
  one conversation per session) and, for the Codex choice, the user's own `codex app-server`.
- Runs it as the user's own login. Tessaya ships no key and no token of its own. `subscriptionEnv`
  removes API-key and cloud-provider variables from the child's environment so the plan is used and no API
  key is billed by accident.
- Sends the assistant what the user says, screen captures the user allowed, and tool results, through that
  command. Every tool call goes through Tessaya's approval gate.
- The "Claude login for Tessaya" setting points the child at another login directory on the same machine
  (`CLAUDE_CONFIG_DIR`). Account rotation (`apps/server/src/baton/AccountPoolService.ts`) swaps the
  credential in a config directory using the third-party `cswap` tool, between turns, when one login is near
  its limit. Token instances (`scripts/tessaya/provider-token-instances.py`, not shipped) run extra logins
  from a setup token.

**To check against the current published terms, before launch (Director):**

1. Anthropic: the terms that apply to a Claude subscription (Consumer Terms or the commercial terms for the
   plan), the Usage Policy, and Claude Code's own legal and compliance page. Questions: may a third-party
   program start `claude -p` on a user's subscription login; may it use `CLAUDE_CONFIG_DIR` to select among
   several logins; does a rotation that moves work to another login when one is limited fit the terms on
   sharing accounts and circumventing limits; is a setup token allowed outside Claude Code itself.
2. OpenAI: the Terms of Use, the Codex documentation on signing in with ChatGPT, and the service terms for
   Codex. Questions: may a third-party program start `codex app-server` on a ChatGPT login.
3. Whether either company requires its own branding or disclosure when a product drives its tool.

Until that is done, the safe launch scope is the single-login path above with rotation and token instances
left off. The first-run chooser already states whose subscription each option uses.

## 2. openWakeWord

Sources: the project's README "License" section and the GitHub licence API (code Apache-2.0);
`docs/baton/research/voice-stack-2026-10-26.md`; `docs/baton/THIRD_PARTY_NOTICES.md`.

- openWakeWord **code** is Apache-2.0. Its **pre-trained models are CC BY-NC-SA 4.0** (non-commercial,
  share-alike), "due to the inclusion of datasets with unknown or restrictive licensing".
- Tessaya ships `melspectrogram.onnx` and `embedding_model.onnx` from openWakeWord v0.5.1. These are the
  shared feature models of the same release; the README groups them with the pre-trained models. Treat them as
  non-commercial until the project says otherwise. (The embedding model originates from Google's speech
  embedding on TFHub, Apache-2.0, per the README, re-implemented by the author.)
- Tessaya's four wake models (`sebastian`, `alfred`, `freya`, `onyx`) were trained here with openWakeWord's
  trainer (`scripts/tessaya/wake-train/`, `.github/workflows/baton-wake-train.yml`) on Piper LibriTTS and
  en_GB voices plus openWakeWord's published negative features. `THIRD_PARTY_NOTICES.md` records that those
  sets carry their own terms, "some non-commercial".
- Effect: redistributing the installer commercially is **not** cleared today. Options named in the research
  note: retrain on data with clear licences, swap in a commercially licensed wake engine behind the same
  `WakeProvider`, or ship free and non-commercial. **Director:** pick one before public release.
- Silero VAD (MIT), whisper.cpp (MIT) and onnxruntime-node (MIT) have no such limit.

## 3. Herdr

Correction to the working assumption: the repo's own record (D37, corrected 2026-09-18) says upstream Herdr,
`github.com/herdrdev/herdr`, is **Apache-2.0**; the AGPL-3.0 project was a stale fork
(`SuperCodeAgents/herdr-terminal`). The GitHub licence API confirms Apache-2.0 for `herdrdev/herdr` today.
**Director:** confirm which Herdr he means.

How Tessaya uses it either way (`apps/server/src/baton/HerdrAdapterLive.ts`, `HerdrTerminal.ts`): runs the
installed `herdr` program as a separate process with `execFile` and parses its output. No Herdr source is
copied, no library is linked, nothing is installed by Tessaya, and Tessaya works without it (it says "herdr is
not installed"). That keeps a copyleft licence, if one applied, from reaching Tessaya's code.

## 4. Voice is local by default

- Wake word and voice-activity detection: ONNX models on the user's computer (`packages/baton-voice`).
- Dictation: the Parakeet model runs in the local `tessaya-voice` sidecar. Its model file downloads once
  (pinned, checksummed) from Hugging Face. Dictation clean-up defaults to `local`; the `claude` option, which
  sends flagged text to Anthropic, is opt-in (D105).
- Speech out: Pocket TTS on this computer (voices download once) or the operating system voice.
- Audio is not sent anywhere. What leaves the machine is text: what the user says to the assistant goes to
  the brain they chose, Claude Code or Codex.
- The window says so on the first-run card, and the Check area shows whether the models are present.

## 5. Private defaults removed (2026-11-01 audit)

See D135 in `DECISIONS.md` for the list, what to set on each machine and what is left in operator scripts that are not shipped.
