#!/bin/bash
# RetireView — Stop All Services

echo "🛑 Stopping RetireView..."

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Docker stack first — its ports are held by root-owned docker-proxy
# processes that kill(1) can't touch; docker compose down releases them.
if command -v docker >/dev/null 2>&1; then
  RUNNING=$(cd "$ROOT" && docker compose ps -q 2>/dev/null)
  if [ -n "$RUNNING" ]; then
    echo "→ Stopping Docker stack"
    (cd "$ROOT" && docker compose down) && echo "✓ Docker stack stopped"
  fi
fi

graceful_kill() {
  local PID=$1
  local NAME=$2

  if kill -0 $PID 2>/dev/null; then
    # Try graceful SIGTERM first
    kill -TERM $PID 2>/dev/null

    # Wait up to 5 seconds for graceful shutdown
    for i in {1..5}; do
      if ! kill -0 $PID 2>/dev/null; then
        echo "✓ $NAME stopped gracefully"
        return 0
      fi
      sleep 1
    done

    # Force kill if still running
    echo "⚠️  $NAME didn't stop gracefully — force killing..."
    kill -KILL $PID 2>/dev/null
    sleep 1

    if ! kill -0 $PID 2>/dev/null; then
      echo "✓ $NAME force stopped"
    else
      echo "✗ $NAME could not be stopped — try scripts/kill.sh"
    fi
  fi
}

# Stop frontend supervisor and Vite
if [ -f scripts/.frontend.pid ]; then
  FRONTEND_PID=$(cat scripts/.frontend.pid)
  graceful_kill $FRONTEND_PID "Frontend supervisor"
  rm -f scripts/.frontend.pid
fi
pkill -f "scripts/dev-frontend.sh" 2>/dev/null || true

# Stop backend
if [ -f scripts/.backend.pid ]; then
  BACKEND_PID=$(cat scripts/.backend.pid)
  graceful_kill $BACKEND_PID "Backend"
  rm -f scripts/.backend.pid
fi

# Clean up ports regardless
clear_port() {
  local PORT=$1
  local PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PIDS" ]; then
    echo "→ Clearing port $PORT (PIDs: $PIDS)"
    echo $PIDS | xargs kill -TERM 2>/dev/null
    sleep 2
    # Force if still occupied
    PIDS=$(lsof -ti:$PORT 2>/dev/null)
    if [ ! -z "$PIDS" ]; then
      echo $PIDS | xargs kill -KILL 2>/dev/null
      echo "✓ Port $PORT force cleared"
    else
      echo "✓ Port $PORT cleared"
    fi
  fi
}

clear_port 8006
clear_port 5178

# Clean up orphaned processes from this project only (avoid killing other projects' Vite)
pkill -f "$(basename "$(cd "$(dirname "$0")/.." && pwd)")/backend.*node --watch src/index.js" 2>/dev/null && \
  echo "✓ Cleared orphaned backend watchers" || true
pkill -f "$(basename "$(cd "$(dirname "$0")/.." && pwd)")/node_modules/.bin/vite --port 5178" 2>/dev/null && \
  echo "✓ Cleared orphaned Vite" || true

echo ""
echo "✅ RetireView stopped"

