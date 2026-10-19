#!/bin/sh
set -eu
umask 077
export TZ=Asia/Shanghai
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir/../.."
mkdir -p "$script_dir/logs"
# Skip overlapping wakeups; the engine separately locks the authoritative state.
exec /usr/bin/flock -n -E 0 "$script_dir/.scheduler.lock" \
  /usr/bin/docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml -f deploy/nas/compose.proxy.yaml \
  run --rm --name etn-premium-scheduled premium run \
  >> "$script_dir/logs/scheduled-$(date +%F).log" 2>&1
