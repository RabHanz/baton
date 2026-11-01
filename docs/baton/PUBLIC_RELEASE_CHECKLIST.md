# Public release checklist (2026-11-03)

What stands between this repository and a release to strangers. Facts and sources are in `LAUNCH.md`; this is the
short list. Nothing here decides the licence or any legal question: those are the Director's.

## Done and guarded

- **No private names, keys or addresses in shipped code.** `scripts/baton/guard-private.mjs` fails CI (and a unit
  test) on a maintainer host or account, a cloud provider used as a machine name, an API key or token, a tailnet
  address, or a hashed phrase of a private operating-system pack. Tests, fixtures and `scripts/baton/` (the
  maintainer's operator tools, not in the installer) are out of scope. Its allow list is one file and only shrinks.
- **The operating-system pack is neutral by default**; a user's own pack loads from their user data folder and can
  never be committed (D148).
- **Updates, the server archive and the installer** fetch from this repository's public releases with checksums,
  and need nothing of the maintainer's machines. Rotation and token instances are off unless set.
- **Voice is local**; nothing but the user's text goes to the brain they chose (LAUNCH section 4).

## Still blocks a public release

1. **Licence (Director).** Not chosen. MIT or a stricter licence changes what third-party code may be kept;
   `THIRD_PARTY_NOTICES.md` is written to work for either. Needs his decision first.
2. **Wake models.** openWakeWord's shared models and Tessaya's own wake models trained on sets with
   non-commercial terms are not cleared for redistribution (LAUNCH section 2). Pick: retrain on clearly licensed
   data, swap in a licensed engine behind `WakeProvider`, or ship non-commercial. The default word set also
   still names four given names (Sebastian, Alfred, Freya, Onyx) that were the maintainer's own choices; the
   voice lane decides the neutral shipped set (only Tessaya's own word is certainly neutral).
3. **Anthropic and OpenAI terms (Director).** Whether a third-party program may start `claude -p` or
   `codex app-server` on a user's subscription login, and whether login rotation fits (LAUNCH section 1).
   Until then the safe scope is the single-login path.
4. **Code signing.** The Windows installer and updater are unsigned: no certificate, so SmartScreen warns every
   stranger. A certificate (or a signing service) is needed before release; macOS needs a developer identity and
   notarisation as well (STATUS V2).
5. **Trademark search for Tessaya.** The naming research (2026-11-01) is a screen, not clearance: US only, exact
   word, no UK or EU, no unregistered rights. A proper search (or counsel) is needed before the name is used on a
   store or a site.
6. **Release home.** Updates and the server archive are fetched from `github.com/RabHanz/baton`, a personal
   account. A public release wants an organisation repository; the repo name is set in a few places
   (`BatonUpdater`/release source in the voice code, `fetch-server-archive.sh`, `apply-release-branding.sh`,
   `codemagic.yaml`). Move them together.
7. **The maintainer's account table.** `ClaudeAccountInstances.ts` still carries a compatibility table for the
   maintainer's two boxes (the guard's one allow-list entry). Set `BATON_CLAUDE_ACCOUNT_INSTANCES` on both boxes,
   then delete the table.
8. **Privacy and support pages**, a plain statement of what leaves the machine, and a way to report a problem.
9. **A clean-machine install proof** on Windows with no maintainer files present, run by someone who is not the
   maintainer. Not done; it needs a machine and a person.
