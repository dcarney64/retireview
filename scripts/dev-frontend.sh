#!/bin/bash
# RetireView — Frontend dev server (Vite, hot reload)
#
# Standalone usage:  ./scripts/dev-frontend.sh
# Called by:         ./scripts/start.sh --dev
#
# Checks that db+backend containers are running and starts them if not.
# Kills any existing process on port 5178, then runs Vite in the foreground.
# Changes to frontend/ appear instantly — no rebuild required.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Ensure db + backend containers are up ────────────────────────────────────
DB_RUNNING=$(cd "$ROOT" && docker compose ps -q --status running db 2>/dev/null)
BACKEND_RUNNING=$(cd "$ROOT" && docker compose ps -q --status running backend 2>/dev/null)

if [ -z "$DB_RUNNING" ] || [ -z "$BACKEND_RUNNING" ]; then
  echo "→ db/backend containers not running — starting them..."
  (cd "$ROOT" && docker compose up -d db backend)

  echo "→ Waiting for backend..."
  for i in {1..60}; do
    if curl -s http://localhost:8006/health > /dev/null 2>&1; then
      echo "✓ Backend ready on :8006"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "✗ Backend did not become ready in 60 s"
      echo "  Check logs:  docker compose logs backend"
      exit 1
    fi
    sleep 1
  done
fi

# ── Clear port 5178 if occupied ───────────────────────────────────────────────
EXISTING=$(lsof -ti:5178 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "→ Port 5178 in use (PID $EXISTING) — stopping it..."
  echo "$EXISTING" | xargs kill -TERM 2>/dev/null || true
  sleep 1
  REMAINING=$(lsof -ti:5178 2>/dev/null)
  if [ -n "$REMAINING" ]; then
    echo "$REMAINING" | xargs kill -KILL 2>/dev/null || true
  fi
fi

# ── Install frontend deps if missing ─────────────────────────────────────────
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "→ Installing frontend dependencies..."
  (cd "$ROOT/frontend" && npm install)
fi

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo "  Backend:              http://localhost:8006"
echo "  Frontend (Vite):      http://localhost:5178"
echo "  Hot reload enabled — changes appear instantly"
echo ""
echo "  Press Ctrl+C to stop the dev server"
echo "  (db + backend containers keep running; use ./scripts/stop.sh for full shutdown)"
echo ""

# ── Launch Vite in foreground ─────────────────────────────────────────────────
cd "$ROOT/frontend"
exec npm run dev
