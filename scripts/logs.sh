#!/bin/bash
# RetireView — Tail logs. Usage: logs.sh [backend|frontend|db]
# Follows Docker container logs when the stack is up, otherwise the
# bare-metal log files in logs/.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="$1"

if command -v docker >/dev/null 2>&1; then
  RUNNING=$(cd "$ROOT" && docker compose ps -q 2>/dev/null)
  if [ -n "$RUNNING" ]; then
    echo "📋 Docker logs${SERVICE:+ ($SERVICE)} — Ctrl+C to stop"
    cd "$ROOT" && exec docker compose logs -f --tail=100 $SERVICE
  fi
fi

echo "📋 Bare-metal logs — Ctrl+C to stop"
case "$SERVICE" in
  backend)  exec tail -f "$ROOT/logs/.backend.log" ;;
  frontend) exec tail -f "$ROOT/logs/.frontend.log" ;;
  db)       echo "No local DB log managed here — check your Postgres install"; exit 1 ;;
  "")       exec tail -f "$ROOT/logs/.backend.log" "$ROOT/logs/.frontend.log" ;;
  *)        echo "Unknown service: $SERVICE (use backend, frontend, or db)"; exit 1 ;;
esac
