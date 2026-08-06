#!/bin/bash
# RetireView — Service Status
# Shows which mode is active: Full Docker, Hybrid dev, or Stopped.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PORT=$(grep -E '^DB_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
DB_PORT=${DB_PORT:-5437}

echo "📊 RetireView Status"
echo "────────────────────────────────"

# ── Detect running containers ─────────────────────────────────────────────────
DB_UP=""
BACKEND_UP=""
FRONTEND_DOCKER_UP=""

if command -v docker >/dev/null 2>&1; then
  DB_UP=$(cd "$ROOT" && docker compose ps -q --status running db 2>/dev/null)
  BACKEND_UP=$(cd "$ROOT" && docker compose ps -q --status running backend 2>/dev/null)
  FRONTEND_DOCKER_UP=$(cd "$ROOT" && docker compose ps -q --status running frontend 2>/dev/null)
fi

# ── Detect host Vite process ─────────────────────────────────────────────────
VITE_PID=$(lsof -ti:5178 2>/dev/null | head -1)

# ── Mode summary ──────────────────────────────────────────────────────────────
if [ -n "$DB_UP" ] && [ -n "$BACKEND_UP" ] && [ -n "$FRONTEND_DOCKER_UP" ]; then
  echo "Mode:  Full Docker mode  (all 3 containers running)"
elif [ -n "$DB_UP" ] && [ -n "$BACKEND_UP" ] && [ -n "$VITE_PID" ]; then
  echo "Mode:  Hybrid dev mode  (Docker: db+backend | Host: Vite PID $VITE_PID)"
elif [ -n "$DB_UP" ] && [ -n "$BACKEND_UP" ]; then
  echo "Mode:  Hybrid dev mode — db+backend running, frontend stopped"
  echo "       → Run ./scripts/dev-frontend.sh to start the frontend"
else
  echo "Mode:  Stopped"
fi

echo "────────────────────────────────"

# ── Container details ─────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  CONTAINERS=$(cd "$ROOT" && docker compose ps --format '{{.Name}}: {{.Status}}' 2>/dev/null)
  if [ -n "$CONTAINERS" ]; then
    echo "Containers:"
    echo "$CONTAINERS" | sed 's/^/  /'
  else
    echo "Containers:  none"
  fi
fi

if [ -n "$VITE_PID" ]; then
  echo "  Vite (host):  PID $VITE_PID on :5178"
fi

echo "────────────────────────────────"

# ── Health checks ─────────────────────────────────────────────────────────────
if pg_isready -h localhost -p "$DB_PORT" -q 2>/dev/null; then
  echo "✓ PostgreSQL    accepting connections on :$DB_PORT"
else
  echo "✗ PostgreSQL    NOT reachable on :$DB_PORT"
fi

HEALTH=$(curl -s --max-time 3 http://localhost:8006/health 2>/dev/null)
if [ "$HEALTH" = '{"status":"ok"}' ]; then
  echo "✓ Backend       healthy on :8006"
else
  echo "✗ Backend       NOT healthy on :8006"
fi

if curl -s --max-time 3 -o /dev/null http://localhost:5178 2>/dev/null; then
  echo "✓ Frontend      serving on :5178"
else
  echo "✗ Frontend      NOT serving on :5178"
fi

echo "────────────────────────────────"
echo "URLs:"
echo "  Frontend  →  http://localhost:5178"
echo "  Backend   →  http://localhost:8006/health"
