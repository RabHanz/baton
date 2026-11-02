# Tessaya

Tessaya is a desktop assistant for people who work with coding agents. You talk or type; it looks at your screen when you ask, runs jobs in the background, remembers what you teach it, keeps your secrets in an encrypted vault, and asks before anything that matters. A web page on your own server puts the approvals and jobs on your phone.

It is built on [T3 Code](https://github.com/pingdotgg/t3code) (a GUI and server for Codex, Claude Code, Cursor, OpenCode and others), kept as a named patch series over a pinned upstream commit. The root `README.md` is upstream's; this page is Tessaya's.

> **Licence: not chosen yet.** No licence is granted for the Tessaya additions until one is chosen. Upstream T3 Code remains under its own licence (see `LICENSE`). Third-party notices are in `docs/baton/THIRD_PARTY_NOTICES.md`. See `docs/baton/PUBLIC_RELEASE_CHECKLIST.md` for what is still open before a public release.

## Install

Releases are on the [Releases page](../../releases): a Windows installer (first class), a macOS dmg (arm64) and a Linux AppImage. macOS and Linux start and run the voice but have fewer features; `docs/baton/PLATFORMS.md` says exactly what works where, and what was only seen in CI.

Builds are unsigned for now, so macOS shows a first-run warning and Windows SmartScreen may too.

Then read [Getting started](../docs/user/getting-started.md).

## Build

```bash
vp i
vp run dev          # server and web, with a seeded copy of your data
vp run check:changed
```

Desktop packaging: `scripts/baton/release-build.sh` and `.github/workflows/baton-desktop-release.yml`. The dictation sidecar is in `native/baton-dictation` (Rust). Details: `docs/operations/development.md`.

## Where things are

| | |
| --- | --- |
| `apps/desktop/src/baton`, `apps/server/src/baton` | Tessaya's desktop and server code |
| `packages/baton-*` | shared logic, contracts, voice core |
| `vendor-patches/t3code` | the patches over upstream; `scripts/baton/patches.sh verify` checks them |
| `docs/user` | what each feature does and how to start |
| `docs/baton` | design notes, platform status, vault and memory rules |

## Contributing, security, changes

See [CONTRIBUTING](./CONTRIBUTING.md), [SECURITY](./SECURITY.md) and the [CHANGELOG](../CHANGELOG.md).
