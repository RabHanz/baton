#!/usr/bin/env bash
#
# Baton's edits to upstream T3 Code, kept as a named patch series over a pinned upstream commit.
#
# The tree at the repo root IS the vendor tree: upstream's files at the pin, plus this series,
# plus files Baton adds. Upstream stays at the root rather than under vendor/ because its release
# chain, workspace globs and root configs all assume the root; moving it would itself need patches
# (D76). What makes it a vendor tree is the rule `verify` enforces: no upstream path differs from
# the pin except through a patch in the series.
#
#   vendor-patches/t3code/PIN          upstream commit the tree is built on
#   vendor-patches/t3code/series       patch names, applied in order
#   vendor-patches/t3code/REGENERATED  upstream paths changed by regeneration, not by patch
#   vendor-patches/t3code/NNNN-*.patch one concern each; every edited upstream path in exactly one
#
# Usage:
#   patches.sh verify [<commit>]          <commit> (default HEAD) == PIN + series on upstream paths
#   patches.sh refresh [--assign <patch> <path>...]
#                                         rewrite every patch from the working tree; new upstream
#                                         edits must be assigned to a patch once
#   patches.sh rebase <upstream-commit>   move the working tree to a new pin and re-apply the
#                                         series with --3way (exit 2 = conflicts left in the tree)
#   patches.sh files [<patch>]            upstream paths a patch, or the whole series, touches
#
# Exit codes: 0 ok, 1 refused or drift found, 2 rebase left conflicts for a human.

set -euo pipefail

export LC_ALL=C
cd "$(git rev-parse --show-toplevel)"
dir="${BATON_PATCH_DIR:-vendor-patches/t3code}"

die() { echo "patches: $*" >&2; exit 1; }
[ -f "$dir/PIN" ] || die "no $dir/PIN"
pin="$(tr -d '[:space:]' < "$dir/PIN")"
git cat-file -e "$pin^{commit}" 2> /dev/null || die "PIN $pin is not a commit here (git fetch upstream?)"

series() { grep -vE '^\s*(#|$)' "$dir/series" || true; }
regenerated() { [ -f "$dir/REGENERATED" ] && grep -vE '^\s*(#|$)' "$dir/REGENERATED" || true; }
patch_paths() { sed -n 's|^diff --git a/\(.*\) b/.*$|\1|p' "$1"; }

# The pin's index with the whole series applied, as a tree id. Never touches the working tree.
series_tree() {
  local idx
  idx="$(mktemp)"
  GIT_INDEX_FILE="$idx" git read-tree "$pin"
  local p
  while read -r p; do
    GIT_INDEX_FILE="$idx" git apply --cached --whitespace=nowarn "$dir/$p" \
      || { rm -f "$idx"; die "$p no longer applies to PIN $pin"; }
  done < <(series)
  GIT_INDEX_FILE="$idx" git write-tree
  rm -f "$idx"
}

cmd_verify() {
  local target="${1:-HEAD}" expected drift pin_paths
  expected="$(series_tree)"
  pin_paths="$(mktemp)"
  git ls-tree -r --name-only "$pin" | sort > "$pin_paths"
  # Paths that differ between PIN+series and the target, limited to paths upstream owns.
  # Everything else that differs is a file Baton added, which needs no patch.
  drift="$(git diff-tree -r --no-renames --name-only "$expected" "$target^{tree}" | sort |
    comm -12 - "$pin_paths" | comm -23 - <(regenerated | sort) || true)"
  rm -f "$pin_paths"
  if [ -n "$drift" ]; then
    echo "patches: these upstream paths differ from PIN + series. Edit them through a patch:" >&2
    echo "         scripts/baton/patches.sh refresh [--assign <patch> <path>]" >&2
    printf '  %s\n' $drift >&2
    exit 1
  fi
  echo "patches: ok — $(git rev-parse --short "$target") is upstream $(git rev-parse --short "$pin") + $(series | wc -l | tr -d ' ') patches"
}

cmd_refresh() {
  declare -A owner=()
  local p f
  while read -r p; do
    while read -r f; do owner["$f"]="$p"; done < <(patch_paths "$dir/$p")
  done < <(series)
  if [ "${1:-}" = "--assign" ]; then
    shift
    local target="${1:?--assign needs a patch name}"
    shift
    series | grep -qxF "$target" || die "$target is not in $dir/series"
    for f in "$@"; do owner["$f"]="$target"; done
  fi

  # Upstream paths the working tree changes (added files are Baton's own and are excluded).
  local changed unassigned=()
  changed="$(git diff --no-renames --name-only --diff-filter=MDT "$pin" -- . | comm -23 - <(regenerated | sort) || true)"
  for f in $changed; do [ -n "${owner[$f]:-}" ] || unassigned+=("$f"); done
  if [ "${#unassigned[@]}" -gt 0 ]; then
    echo "patches: upstream paths edited but in no patch. Assign each once:" >&2
    printf '  scripts/baton/patches.sh refresh --assign <NNNN-name.patch> %s\n' "${unassigned[@]}" >&2
    exit 1
  fi

  while read -r p; do
    local paths=() header tmp
    for f in $changed; do [ "${owner[$f]}" = "$p" ] && paths+=("$f"); done
    if [ "${#paths[@]}" -eq 0 ]; then
      echo "patches: $p is now empty; upstream took it or the edit was reverted. Drop it from series." >&2
      continue
    fi
    # Keep the patch's description: everything above its first diff.
    header="$(sed '/^diff --git /,$d' "$dir/$p" 2> /dev/null || true)"
    tmp="$(mktemp)"
    { [ -n "$header" ] && printf '%s\n\n' "$header"
      git diff --full-index --binary --no-renames "$pin" -- "${paths[@]}"; } > "$tmp"
    mv "$tmp" "$dir/$p"
  done < <(series)
  echo "patches: refreshed $(series | wc -l | tr -d ' ') patches against $(git rev-parse --short "$pin")"
}

cmd_rebase() {
  local new
  new="$(git rev-parse --verify "${1:?rebase needs an upstream commit}^{commit}")"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "the working tree is dirty"
  [ "$new" != "$pin" ] || { echo "patches: already on $new"; return 0; }

  # A path Baton added that upstream now adds too cannot be decided mechanically.
  local collide
  collide="$(comm -12 \
    <(git diff --no-renames --name-only --diff-filter=A "$pin" HEAD | sort) \
    <(git diff --no-renames --name-only --diff-filter=A "$pin" "$new" | sort) || true)"
  if [ -n "$collide" ]; then
    echo "patches: upstream now adds paths Baton also added. Rename or drop Baton's first:" >&2
    printf '  %s\n' $collide >&2
    exit 1
  fi

  echo "==> Upstream paths to $(git rev-parse --short "$new")"
  git checkout -q "$new" -- .
  git diff --no-renames --name-only --diff-filter=D "$pin" "$new" | xargs -r git rm -q --ignore-unmatch --

  echo "==> Re-applying the series"
  local p failed=()
  while read -r p; do
    if git apply --index --3way --whitespace=nowarn "$dir/$p" 2> "$dir/.$p.log"; then
      echo "  ok        $p"
      rm -f "$dir/.$p.log"
    else
      echo "  CONFLICT  $p  (see $dir/.$p.log)"
      failed+=("$p")
    fi
  done < <(series)

  printf '%s\n' "$new" > "$dir/PIN"
  git add "$dir/PIN"
  pin="$new"
  if [ "${#failed[@]}" -gt 0 ]; then
    echo "patches: ${#failed[@]} patch(es) need a human: ${failed[*]}" >&2
    echo "         fix the markers, then: scripts/baton/patches.sh refresh && scripts/baton/patches.sh verify" >&2
    exit 2
  fi
  cmd_refresh > /dev/null
  git add "$dir"
  echo "patches: series applies to $(git rev-parse --short "$new"); patches refreshed"
}

cmd_files() {
  if [ -n "${1:-}" ]; then patch_paths "$dir/$1"; else
    local p
    while read -r p; do patch_paths "$dir/$p"; done < <(series)
  fi
}

case "${1:-}" in
  verify) shift; cmd_verify "$@" ;;
  refresh) shift; cmd_refresh "$@" ;;
  rebase) shift; cmd_rebase "$@" ;;
  files) shift; cmd_files "$@" ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 1 ;;
esac
