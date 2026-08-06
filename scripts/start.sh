#!/bin/bash
# RetireView — Start Services
#
# Usage:
#   ./scripts/start.sh          Full Docker mode  (all 3 containers)
#   ./scripts/start.sh --dev    Hybrid dev mode   (db+backend Docker, frontend Vite)
#
# Use ./scripts/rebuild.sh [backend|frontend|all] to pick up code changes.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEV_MODE=false
[ "${1:-}" = "--dev" ] && DEV_MODE=true

# Enforce secret file permissions on every start
chmod 600 "$ROOT/.env" 2>/dev/null || true

# ── Hybrid dev mode ──────────────────────────────────────────────────────────
if "$DEV_MODE"; then
  echo "🚀 Starting RetireView (hybrid dev mode)..."
  echo "   Docker: db + backend"
  echo "   Host:   Vite dev server (hot reload)"
  echo ""

  cd "$ROOT"
  docker compose up -d db backend

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

  echo ""
  # Hand off to Vite in the foreground (Ctrl+C stops the dev server)
  exec "$ROOT/scripts/dev-frontend.sh"
fi

# ── Full Docker mode (default) ────────────────────────────────────────────────
echo "🚀 Starting RetireView (full Docker mode)..."

cd "$ROOT"

RUNNING=$(docker compose ps -q --status running 2>/dev/null)
if [ -n "$RUNNING" ]; then
  echo "⚠️  Containers are already running."
  echo "   Use ./scripts/status.sh to inspect, or ./scripts/stop.sh to shut down first."
  exit 1
fi

docker compose up -d

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

echo ""
echo "✅ RetireView is running (full Docker)"
echo "   Frontend  →  http://localhost:5178"
echo "   Backend   →  http://localhost:8006"
echo ""
echo "   Shut down:              ./scripts/stop.sh"
echo "   Pick up backend changes: ./scripts/rebuild.sh backend"
echo "   Pick up all changes:     ./scripts/rebuild.sh all"
