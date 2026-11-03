# Repo rename cutover: RabHanz/baton to RabHanz/tessaya

The manager renames the repository, after the Director confirms the moment. This list is what must be
true before, what the rename does by itself, and what to flip after. Installed apps must keep
updating throughout.

## Why the installed apps survive

The updater feed is baked into each build from `GITHUB_REPOSITORY` (`resolveGitHubPublishConfig`,
`scripts/build-desktop-artifact.ts`; the release workflow sets it from `github.repository`). Apps
already installed hold `RabHanz/baton`. GitHub redirects the old name for web, API, git and release
asset downloads, so they keep finding `latest.yml` and the installers. The redirect lasts only while
nobody creates a new repository called `RabHanz/baton`. So: never create one, and never delete the
renamed repository. The first release built after the rename bakes the new name into new installs.
The release tag format (`baton-v<ver>`, `server-<ver>`) does not change.

## Before (all must be true)

- [ ] PR "tolerate both repo names" is merged: scripts take `TESSAYA_REPO`, then `BATON_REPO`, then the default; the desktop reads one `repoSlug`/`releasesUrl` (`packages/baton-shared/src/repo.ts`).
- [ ] No open PR from another lane adds a hardcoded `RabHanz/baton`. Check with `git grep -n 'RabHanz/baton'`; allowed: `DEFAULT_REPO`, docs, `apply-release-branding.sh`, patch 0010.
- [ ] Branch ruleset: the required checks are named `baton-ci` and `verify`. Renaming the repo keeps them; do not rename the workflow `name:` in the same hour.
- [ ] Secrets and variables are repo-level and move with the repo: confirm none are environment-scoped to a name. Codemagic (`codemagic.yaml`) is connected by repository id; reconnect check after.
- [ ] A fresh `latest` release exists and its `latest.yml` downloads (`gh release view -R RabHanz/baton`), as the baseline for the post-rename check.
- [ ] Both boxes idle: no `baton-auto-sync` run in progress (the sync pushes to `origin`).

## At cutover (manager)

1. GitHub: Settings, rename `baton` to `tessaya`.
2. On each box and each worktree owner: `git remote set-url origin https://github.com/RabHanz/tessaya.git`. The old URL also keeps working through the redirect, so this is hygiene, not urgent. Includes `/mnt/HC_Volume_106652742/dev/t3code` and the `baton-autosync` worktree.
3. `gh repo set-default RabHanz/tessaya` where `gh` is used; `gh` itself follows the redirect.

## Immediately after (verify, in order)

- [ ] `curl -sIL https://github.com/RabHanz/baton/releases/latest/download/latest.yml` ends 200 (the installed apps' feed).
- [ ] `git ls-remote https://github.com/RabHanz/baton.git` works (old clones).
- [ ] `scripts/baton/fetch-server-archive.sh <version>` works with no env set.
- [ ] `baton-ci` and `verify` run on a trivial PR and are still the required checks.
- [ ] The next scheduled auto-sync (22:30 UTC) is watched once; it uses `BATON_REPO`/`TESSAYA_REPO`, default unchanged.
- [ ] An installed app (not the laptop; a Linux/Windows test box) is pointed at an older build and updates.

## Then flip (one PR, after the checks above)

- [ ] `DEFAULT_REPO` in `packages/baton-shared/src/repo.ts` to `RabHanz/tessaya`; the shell scripts' default (`auto-sync.sh`, `disable-upstream-workflows.sh`, `fetch-server-archive.sh`) and `changelog.mjs`'s fallback likewise.
- [ ] `scripts/baton/apply-release-branding.sh`: `RELEASES_URL` (patches upstream `DesktopStartupRecovery.ts`; its `must` assertion too). That is an upstream-file edit: run `patches.sh refresh`, and `verify` must stay green.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` security-advisory URL, which lives in `vendor-patches/t3code/0010-public-hygiene.patch`: refresh the patch, do not hand-edit it.
- [ ] `codemagic.yaml` comment, `docs/baton/PUBLIC_RELEASE_CHECKLIST.md`, `docs/baton/UPSTREAM.md` (two refs, one is a `.git` clone URL), VentureOS notes that name the repo.
- [ ] VentureOS: search its docs and scripts for `RabHanz/baton` and `fabric`/`baton` clone paths; update after the flip, not before.

## Keep (do not change at cutover)

Release tags and asset names, the Electron appId, install dir and userData folder, `fabric_*` data
and wire names, the required check names until the ruleset is edited by hand.

## Rollback

GitHub can rename back (`tessaya` to `baton`); the redirect then reverses. Do not do this after a
release has been built with the new name baked in, because those installs would then rely on the
redirect in the other direction (it also works, but test it).
