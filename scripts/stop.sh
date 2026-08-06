#!/bin/bash
# RetireView — Stop All Services
# Stops Docker containers (all modes) and any host Vite process (hybrid dev mode).

echo "🛑 Stopping RetireView..."

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Docker stack ──────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  RUNNING=$(cd "$ROOT" && docker compose ps -q 2>/dev/null)
  if [ -n "$RUNNING" ]; then
    echo "→ Stopping Docker containers..."
    (cd "$ROOT" && docker compose down) && echo "✓ Docker stack stopped"
  fi
fi

# ── Host Vite process (hybrid dev mode) ──────────────────────────────────────
# Kill any dev-frontend.sh supervisor that may be running in the background
pkill -f "scripts/dev-frontend.sh" 2>/dev/null || true

# Clear port 5178 regardless of how Vite was started
VITE_PIDS=$(lsof -ti:5178 2>/dev/null)
if [ -n "$VITE_PIDS" ]; then
  echo "→ Stopping Vite dev server (PID $VITE_PIDS)..."
  echo "$VITE_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 2
  REMAINING=$(lsof -ti:5178 2>/dev/null)
  if [ -n "$REMAINING" ]; then
    echo "$REMAINING" | xargs kill -KILL 2>/dev/null || true
  fi
  echo "✓ Vite dev server stopped"
fi

# ── Clean up leftover PID files ───────────────────────────────────────────────
rm -f "$ROOT/scripts/.backend.pid" "$ROOT/scripts/.frontend.pid"

echo ""
echo "✅ RetireView stopped"
