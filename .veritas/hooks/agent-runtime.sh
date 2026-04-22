#!/bin/sh
set -eu

if [ "${VERITAS_HOOK_SKIP:-${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if [ "$#" -eq 0 ]; then
  exec npm exec -- veritas shadow run --working-tree
fi

exec npm exec -- veritas shadow run "$@"
