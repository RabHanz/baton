# Source me. Makes TESSAYA_* the env var names: each TESSAYA_X that is set is copied over BATON_X,
# which the scripts still read internally. BATON_* alone keeps working; we note it once per process tree.
tessaya_env_adopt() {
  local k t legacy=""
  for k in $(compgen -e); do
    case "$k" in
      TESSAYA_ENV_NOTED) ;;
      TESSAYA_*) export "BATON_${k#TESSAYA_}=${!k}" ;;
      BATON_*) t="TESSAYA_${k#BATON_}"; [ -z "${!t+x}" ] && legacy="$legacy $k" ;;
    esac
  done
  if [ -n "$legacy" ] && [ -z "${TESSAYA_ENV_NOTED:-}" ]; then
    echo "tessaya: still reading old env names:$legacy (set the TESSAYA_ name instead; the old one keeps working)" >&2
    export TESSAYA_ENV_NOTED=1
  fi
}
tessaya_env_adopt
