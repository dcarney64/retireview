#!/bin/bash
# ProjectName — Show what is running on the project ports

echo "🔍 Port diagnostic"
echo "────────────────────────────────"

for PORT in 5432 8004 5176; do
  echo ""
  echo "Port $PORT:"
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PIDS" ]; then
    lsof -i:$PORT 2>/dev/null | grep -v "^COMMAND" | \
      awk '{print "  PID " $2 " — " $1 " (" $8 " " $9 ")"}'
  else
    echo "  (nothing running)"
  fi
done

echo ""
echo "────────────────────────────────"
echo "Active node processes:"
ps aux | grep -E "node|vite" | grep -v grep | \
  awk '{print "  PID " $2 " — " $11 " " $12 " " $13}'
