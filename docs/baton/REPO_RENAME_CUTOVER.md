# Repo rename: RabHanz/baton to RabHanz/tessaya

The repository was renamed `RabHanz/baton` to `RabHanz/tessaya` on 2026-11-04. The old URLs redirect (the
installed apps' `latest.yml` feed returned 200 and the old git URL worked after the rename), both boxes'
`origin` remotes point at the new name, and every default in this repository names `RabHanz/tessaya`
(`DEFAULT_REPO` in `packages/baton-shared/src/repo.ts`, the `scripts/tessaya/` defaults, `changelog.mjs`,
`apply-release-branding.sh`'s `RELEASES_URL`, patch 0010's security-advisory URL). Scripts still accept
`TESSAYA_REPO`, then `BATON_REPO`, as overrides.

## Why the installed apps keep updating

The updater feed is baked into each build from `GITHUB_REPOSITORY` (`resolveGitHubPublishConfig`,
`scripts/build-desktop-artifact.ts`; the release workflow sets it from `github.repository`). Apps
installed before the rename hold `RabHanz/baton` and reach the new name through GitHub's redirect. The
redirect lasts only while nobody creates a new repository called `RabHanz/baton`. So: never create one,
and never delete the renamed repository. Builds released after the rename bake `RabHanz/tessaya`.

## What remains

- [ ] An installed app on an older build (a Linux or Windows test box, not the laptop) updates through
      the redirect. This is the one check not yet run.
- [ ] VentureOS (outside this repository): search its docs and scripts for `RabHanz/baton` and
      `fabric`/`baton` clone paths and update them.

## Keep (not renamed)

Release tags (`baton-v<ver>`, `server-<ver>`) and asset names, the Electron appId, install dir and
userData folder, `fabric_*` data and wire names, and the required check names `baton-ci` and `verify`
until the ruleset is edited by hand. Historical records (`DECISIONS.md`, `RENAME_INVENTORY.md`) keep the
old name where they describe the past.

## Rollback

GitHub can rename back (`tessaya` to `baton`); the redirect then reverses. Avoid it once a release has
been built with the new name, because those installs would then rely on the redirect in the other
direction (it also works, but test it).
