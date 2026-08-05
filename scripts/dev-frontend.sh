#!/bin/bash
# ProjectName frontend dev server with auto-restart on crash (OOM, port conflict, etc.)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/.frontend.log"
PID_FILE="$ROOT/scripts/.frontend.pid"

cd "$ROOT" || exit 1

mkdir -p "$ROOT/logs"
echo $$ > "$PID_FILE"

cleanup() {
  echo "[$(date -Is)] dev-frontend.sh stopping"
  exit 0
}

trap cleanup SIGTERM SIGINT

while true; do
  echo "[$(date -Is)] Starting Vite on port 5176..." | tee -a "$LOG"
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}" \
    npm run dev:frontend >> "$LOG" 2>&1
  EXIT_CODE=$?
  echo "[$(date -Is)] Vite exited with code $EXIT_CODE — restarting in 3 seconds..." | tee -a "$LOG"
  sleep 3
done
