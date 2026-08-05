#!/bin/bash
# ProjectName — Nuclear kill. Use when stop.sh doesn't work.
# Kills ALL processes related to this project by port and name.

echo "💣 Nuclear kill — terminating all project processes..."
echo ""

# Kill by port
for PORT in 8004 5176; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PIDS" ]; then
    echo "→ Killing PIDs on port $PORT: $PIDS"
    echo $PIDS | xargs kill -KILL 2>/dev/null
    echo "✓ Port $PORT cleared"
  else
    echo "✓ Port $PORT already free"
  fi
done

# Kill by process name
declare -A PROCS=(
  ["node --watch"]="Backend watcher"
  ["vite"]="Frontend dev server"
  ["esbuild"]="ESBuild process"
)

for PROC in "${!PROCS[@]}"; do
  NAME=${PROCS[$PROC]}
  PIDS=$(pgrep -f "$PROC" 2>/dev/null)
  if [ ! -z "$PIDS" ]; then
    echo "→ Killing $NAME (PIDs: $PIDS)"
    echo $PIDS | xargs kill -KILL 2>/dev/null
    echo "✓ $NAME killed"
  else
    echo "✓ $NAME not running"
  fi
done

# Remove stale PID files
rm -f scripts/.backend.pid scripts/.frontend.pid
echo "✓ PID files cleared"

# Verify ports are free
echo ""
echo "Port status after kill:"
for PORT in 8004 5176; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PIDS" ]; then
    echo "  ✗ Port $PORT still occupied by PID $PIDS"
    echo "    Try: sudo kill -KILL $PIDS"
  else
    echo "  ✓ Port $PORT is free"
  fi
done

echo ""
echo "💣 Nuclear kill complete"
echo "   Run npm start to restart"
