#!/bin/bash
# RetireView frontend dev server with auto-restart on crash (OOM, port conflict, etc.)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/.frontend.log"
PID_FILE="$ROOT/scripts/.frontend.pid"

cd "$ROOT" || exit 1

# Vite uses --strictPort; if 5178 is taken (e.g. the Docker frontend),
# bail out instead of crash-looping every 3 seconds. ss (not lsof) so
# root-owned docker-proxy listeners are detected too.
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '[:.]5178$'; then
  echo "✗ Port 5178 is already in use (Docker frontend?). Stop it first: docker compose stop frontend"
  exit 1
fi

mkdir -p "$ROOT/logs"
echo $$ > "$PID_FILE"

cleanup() {
  echo "[$(date -Is)] dev-frontend.sh stopping"
  exit 0
}

trap cleanup SIGTERM SIGINT

while true; do
  echo "[$(date -Is)] Starting Vite on port 5178..." | tee -a "$LOG"
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}" \
    npm run dev:frontend >> "$LOG" 2>&1
  EXIT_CODE=$?
  echo "[$(date -Is)] Vite exited with code $EXIT_CODE — restarting in 3 seconds..." | tee -a "$LOG"
  sleep 3
done
