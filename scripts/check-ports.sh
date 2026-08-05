#!/bin/bash
# RetireView — Verify the app's ports are available before starting.
# Exits 0 if all free, 1 if any are in use (showing what holds them).

echo "🔍 Port check (db :5437, backend :8006, frontend :5178)"
echo "────────────────────────────────"

# ss sees every listener including root-owned docker-proxy sockets,
# which lsof misses without sudo.
port_busy() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
}

BUSY=0
for PORT in 5437 8006 5178; do
  if port_busy "$PORT"; then
    BUSY=1
    OWNER=$(lsof -i:$PORT -P -n 2>/dev/null | grep -v '^COMMAND' | \
      awk '{print "PID " $2 " — " $1}' | sort -u | head -1)
    echo "✗ Port $PORT in use${OWNER:+: $OWNER}${OWNER:-" (root-owned — likely docker-proxy)"}"
  else
    echo "✓ Port $PORT free"
  fi
done

echo "────────────────────────────────"
if [ "$BUSY" -eq 1 ]; then
  echo "Some ports are in use — if that's the Docker stack, that's expected while it runs."
  exit 1
fi
echo "All ports available."
