#!/bin/bash
# ProjectName — Start All Services (bare-metal dev; use `npm run docker:up` for Docker)

set -e

echo "🚀 Starting ProjectName..."
echo ""

export NODE_ENV=production

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Read DB settings from .env (defaults if absent)
DB_PORT=$(grep -E '^DB_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
DB_PORT=${DB_PORT:-5432}

# Enforce secret file permissions on every start
chmod 600 "$ROOT/.env" 2>/dev/null || true
chmod 600 "$ROOT/backend/.env" 2>/dev/null || true
chmod 600 "$ROOT/frontend/.env" 2>/dev/null || true

mkdir -p "$ROOT/logs"

# Check PostgreSQL is running
if ! pg_isready -h localhost -p "$DB_PORT" -q; then
  echo "✗ PostgreSQL not reachable on localhost:$DB_PORT"
  echo "  Start it first, e.g.:  docker compose up -d db"
  exit 1
fi

echo "✓ PostgreSQL ready on port $DB_PORT"

# Start backend in background (non-watch mode to avoid EPIPE crash loops)
echo "→ Starting backend on port 8004..."
cd "$ROOT"
nohup npm --prefix backend run start >> logs/.backend.log 2>&1 < /dev/null &
BACKEND_PID=$!
echo $BACKEND_PID > scripts/.backend.pid

# Wait for backend to be ready
echo "→ Waiting for backend..."
backend_ready=0
for i in {1..20}; do
  if curl -s http://localhost:8004/health > /dev/null 2>&1; then
    echo "✓ Backend ready on port 8004"
    backend_ready=1
    break
  fi

  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "✗ Backend process exited before becoming ready"
    echo "  Check logs/.backend.log for the failure reason"
    exit 1
  fi

  sleep 1
done

if [ "$backend_ready" -ne 1 ]; then
  echo "✗ Backend did not become ready in time"
  exit 1
fi

# Start frontend with auto-restart on crash (OOM, etc.)
echo "→ Starting frontend on port 5176 (auto-restart enabled)..."
if lsof -ti:5176 >/dev/null 2>&1; then
  echo "⚠️  Port 5176 already in use — skipping frontend start"
else
  chmod +x scripts/dev-frontend.sh
  nohup bash scripts/dev-frontend.sh >> logs/.frontend.log 2>&1 < /dev/null &
  sleep 3
  FRONTEND_PID=$(lsof -ti:5176 2>/dev/null | head -1)
  if [ -n "$FRONTEND_PID" ]; then
    echo "✓ Frontend ready on port 5176 (Vite PID $FRONTEND_PID)"
    echo "  Supervisor PID $(cat scripts/.frontend.pid 2>/dev/null || echo '?') in scripts/.frontend.pid"
  else
    echo "✗ Frontend did not bind to port 5176"
    echo "  Check logs/.frontend.log for details"
    tail -30 logs/.frontend.log 2>/dev/null || true
  fi
fi

echo ""
echo "✅ ProjectName is running!"
echo "   Frontend → http://localhost:5176"
echo "   Backend  → http://localhost:8004"
echo "   Database → localhost:$DB_PORT"
echo ""
echo "   Run scripts/stop.sh to shut everything down"
echo "   Logs: logs/.backend.log, logs/.frontend.log"
