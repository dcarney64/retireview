#!/bin/bash
# RetireView — Restart All Services (restarts whichever mode is running)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if command -v docker >/dev/null 2>&1; then
  RUNNING=$(cd "$ROOT" && docker compose ps -q --status running 2>/dev/null)
  if [ -n "$RUNNING" ]; then
    echo "🔄 Restarting RetireView (Docker)..."
    cd "$ROOT" && exec docker compose restart
  fi
fi

echo "🔄 Restarting RetireView (bare metal)..."
"$(dirname "$0")/stop.sh"
sleep 2
"$(dirname "$0")/start.sh"
