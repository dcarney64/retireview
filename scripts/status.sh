#!/bin/bash
# RetireView — Check Status of All Services

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PORT=$(grep -E '^DB_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
DB_PORT=${DB_PORT:-5437}

echo "📊 RetireView Status"
echo "────────────────────────────────"

# Docker containers (if the compose stack is in use)
if command -v docker >/dev/null 2>&1; then
  CONTAINERS=$(cd "$ROOT" && docker compose ps --format '{{.Name}}: {{.Status}}' 2>/dev/null)
  if [ -n "$CONTAINERS" ]; then
    echo "Containers:"
    echo "$CONTAINERS" | sed 's/^/  /'
  else
    echo "Containers:   none running (bare-metal mode or stack down)"
  fi
  echo "────────────────────────────────"
fi

# PostgreSQL
if pg_isready -h localhost -p "$DB_PORT" -q 2>/dev/null; then
  echo "✓ PostgreSQL    accepting connections on :$DB_PORT"
else
  echo "✗ PostgreSQL    NOT reachable on :$DB_PORT"
fi

# Backend health endpoint
HEALTH=$(curl -s --max-time 3 http://localhost:8006/health 2>/dev/null)
if [ "$HEALTH" = '{"status":"ok"}' ]; then
  echo "✓ Backend       healthy on :8006"
else
  echo "✗ Backend       NOT healthy on :8006"
fi

# Frontend
if curl -s --max-time 3 -o /dev/null http://localhost:5178 2>/dev/null; then
  echo "✓ Frontend      serving on :5178"
else
  echo "✗ Frontend      NOT serving on :5178"
fi

echo "────────────────────────────────"
echo "URLs:"
echo "  Frontend → http://localhost:5178"
echo "  Backend  → http://localhost:8006/health"
