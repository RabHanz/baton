# Baton's patches to upstream T3 Code

The repository root is upstream T3 Code at the commit in `PIN`, plus these patches, plus the files
Baton adds (anything upstream does not have). `scripts/baton/patches.sh verify` proves it (D76).

| File           | What it is                                                                    |
| -------------- | ----------------------------------------------------------------------------- |
| `PIN`          | the upstream commit                                                           |
| `series`       | patch names, applied in order                                                 |
| `REGENERATED`  | upstream paths Baton changes by regeneration (the lockfile), never by a patch |
| `NNNN-*.patch` | one concern each; every upstream path Baton edits is in exactly one           |

To edit an upstream file, edit it in place, then run `scripts/baton/patches.sh refresh`. The first
edit to a path no patch owns yet is refused until you name its patch once:
`patches.sh refresh --assign 0008-web.patch apps/web/src/foo.tsx`. Prefer a new Baton file plus a
one-line hook to a larger patch, because every patched line is a line a sync can conflict on.

To move to a newer upstream, run `scripts/baton/upstream-sync.sh` (see `docs/baton/UPSTREAM.md`).
