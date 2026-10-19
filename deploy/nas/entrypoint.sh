#!/bin/sh
set -eu
umask 077
if [ "$#" -gt 1 ]; then echo 'Expected one command only' >&2; exit 2; fi
operation=${1:-status}
case "$operation" in
  init|status|report|archive) ;;
  maintenance|run) ;;
  *) echo 'Allowed commands: init, status, report, archive, maintenance, run' >&2; exit 2 ;;
esac
# A NAS uses hydrated local evidence. Never silently ignore remote archive pointers.
if [ -e /data/archive-manifests/latest.json ]; then
  echo 'Restore GitHub evidence and finish the documented offline handover first' >&2
  exit 2
fi
if [ "$operation" = run ]; then
  if [ "${NAS_TRIAL_ENABLED:-false}" != true ]; then
    echo 'NAS_TRIAL_ENABLED must be true after exclusive handover' >&2; exit 2
  fi
  exec node packages/news-engine/src/main.ts run --data /data --local-authority --maintenance-only false
fi
if [ "$operation" = maintenance ]; then
  exec node packages/news-engine/src/main.ts run --data /data --maintenance-only true
fi
exec node packages/news-engine/src/main.ts "$operation" --data /data
