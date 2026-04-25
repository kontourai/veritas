#!/bin/sh
# .veritas/hooks/stop.sh -- run by AI tools at Stop/turn-end.
# Surfaces unresolved Veritas lint issues back to the agent without blocking the session.

if [ "${VERITAS_HOOK_SKIP:-${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

RESULT=$(npm exec -- veritas shadow run --format feedback --working-tree 2>&1)
EXIT=$?
if [ "$EXIT" -ne 0 ]; then
  echo "$RESULT"
  echo ""
  echo "Veritas: address the FAIL lines above before finishing."
fi

exit 0
