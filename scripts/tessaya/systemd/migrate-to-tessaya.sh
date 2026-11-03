#!/usr/bin/env bash
#
# Rename the three systemd user units baton-* to tessaya-*, on one box (run once per box).
#
#   migrate-to-tessaya.sh plan       print what apply would do; changes nothing (default)
#   migrate-to-tessaya.sh apply      write tessaya-* units from the LIVE baton-* ones, verify them,
#                                    then stop the old timers and start the new ones
#   migrate-to-tessaya.sh rollback   stop the new timers, start the old ones again
#   migrate-to-tessaya.sh finish     after a clean day: remove the old unit files (not reversible
#                                    except by re-running install.sh)
#
# Safe by construction: the new files are copies of what is installed on THIS box (so per-box edits
# survive), with only the unit names and the word Baton in Description= changed. ExecStart= paths
# (~/.local/bin/baton-cloud-logins, ~/.t3/baton/limits-probe.py, ~/.t3/baton-auto-sync.sh) are left
# alone on purpose: those files keep their names until the script rename in phase 3 ships its
# forwarding wrappers. Nothing is deleted by apply. If verification fails, the old timers are
# never touched. Refuses to run while an old service is mid-run, so a sync is never doubled.
set -euo pipefail

units=(auto-sync cloud-logins limits-probe)
dir="${UNIT_DIR:-$HOME/.config/systemd/user}"
sc="${SYSTEMCTL:-systemctl --user}"
mode="${1:-plan}"
say() { printf '%s\n' "$*"; }

case "$mode" in plan | apply | rollback | finish) ;; *) say "usage: $0 plan|apply|rollback|finish" >&2; exit 2 ;; esac

for u in "${units[@]}"; do
  [ -f "$dir/baton-$u.service" ] && [ -f "$dir/baton-$u.timer" ] || { say "missing $dir/baton-$u.{service,timer}: install the old units first" >&2; exit 1; }
done

if [ "$mode" = rollback ]; then
  for u in "${units[@]}"; do
    $sc disable --now "tessaya-$u.timer" || true
    $sc enable --now "baton-$u.timer"
  done
  say "rolled back: baton-*.timer active, tessaya-*.timer stopped (files kept)"; exit 0
fi

if [ "$mode" = finish ]; then
  for u in "${units[@]}"; do
    $sc is-enabled "tessaya-$u.timer" > /dev/null || { say "tessaya-$u.timer is not enabled; run apply first" >&2; exit 1; }
    rm -f "$dir/baton-$u.service" "$dir/baton-$u.timer"
  done
  $sc daemon-reload; say "old unit files removed"; exit 0
fi

for u in "${units[@]}"; do
  if [ "$($sc is-active "baton-$u.service" 2> /dev/null || true)" = activating ] || [ "$($sc is-active "baton-$u.service" 2> /dev/null || true)" = active ]; then
    say "baton-$u.service is running now; try again when it has finished" >&2; exit 1
  fi
done

for u in "${units[@]}"; do
  for kind in service timer; do
    say "tessaya-$u.$kind  <-  baton-$u.$kind"
    [ "$mode" = plan ] || sed -e 's/^\(Description=\)Baton:\? \?/\1Tessaya: /' "$dir/baton-$u.$kind" > "$dir/tessaya-$u.$kind"
  done
done
[ "$mode" = plan ] && { say "then: daemon-reload, systemd-analyze verify, disable --now baton-*.timer, enable --now tessaya-*.timer"; exit 0; }

$sc daemon-reload
# Verify before touching the old timers; on failure remove only what this run wrote.
for u in "${units[@]}"; do
  if ! systemd-analyze --user verify "$dir/tessaya-$u.service" "$dir/tessaya-$u.timer"; then
    for v in "${units[@]}"; do rm -f "$dir/tessaya-$v.service" "$dir/tessaya-$v.timer"; done
    $sc daemon-reload; say "verification failed; nothing changed" >&2; exit 1
  fi
done
for u in "${units[@]}"; do
  $sc disable --now "baton-$u.timer"
  $sc enable --now "tessaya-$u.timer"
done
$sc list-timers 'tessaya-*' --no-pager
say "done. Roll back with: $0 rollback. After a clean day: $0 finish"
