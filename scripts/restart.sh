#!/bin/bash
# RetireView — Restart Services
#
# Usage:
#   ./scripts/restart.sh          Restart full Docker stack
#   ./scripts/restart.sh --dev    Restart in hybrid dev mode (db+backend Docker, frontend Vite)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEV_MODE=false
[ "${1:-}" = "--dev" ] && DEV_MODE=true

echo "🔄 Restarting RetireView..."

"$ROOT/scripts/stop.sh"
sleep 2

if "$DEV_MODE"; then
  exec "$ROOT/scripts/start.sh" --dev
else
  exec "$ROOT/scripts/start.sh"
fi
