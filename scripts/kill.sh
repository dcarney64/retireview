#!/bin/bash
# RetireView — Nuclear kill. Use when stop.sh doesn't work.
# Force-stops this project's containers and bare-metal processes ONLY —
# never touches other projects' node/vite processes.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "💣 Force-stopping RetireView..."
echo ""

# Docker containers first (force, no grace period)
if command -v docker >/dev/null 2>&1; then
  RUNNING=$(cd "$ROOT" && docker compose ps -q 2>/dev/null)
  if [ -n "$RUNNING" ]; then
    echo "→ Killing Docker stack"
    (cd "$ROOT" && docker compose down -t 0) && echo "✓ Containers stopped"
  else
    echo "✓ No containers running"
  fi
fi

# Bare-metal processes — matched by this project's path, not by generic names
for PATTERN in "$ROOT/backend" "$ROOT/node_modules/.bin/vite" "scripts/dev-frontend.sh"; do
  PIDS=$(pgrep -f "$PATTERN" 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "→ Killing processes matching $PATTERN (PIDs: $PIDS)"
    echo "$PIDS" | xargs kill -KILL 2>/dev/null
  fi
done

# Anything still holding our ports that we own
for PORT in 8006 5178; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "→ Clearing port $PORT (PIDs: $PIDS)"
    echo "$PIDS" | xargs kill -KILL 2>/dev/null || echo "  (some PIDs not ours — likely docker-proxy; run docker compose down)"
  fi
done

rm -f "$ROOT/scripts/.backend.pid" "$ROOT/scripts/.frontend.pid"
echo "✓ PID files cleared"

echo ""
echo "Port status after kill:"
for PORT in 8006 5178; do
  if [ -n "$(lsof -ti:$PORT 2>/dev/null)" ]; then
    echo "  ✗ Port $PORT still occupied"
  else
    echo "  ✓ Port $PORT free"
  fi
done

echo ""
echo "💣 Done"
