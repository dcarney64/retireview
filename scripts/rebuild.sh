#!/bin/bash
# RetireView — Rebuild and restart a container
#
# Solves "I changed code but it's not showing up" for image-based containers.
# In hybrid dev mode the frontend rebuilds automatically via Vite hot-reload —
# you only need this script for backend changes.
#
# Usage:
#   ./scripts/rebuild.sh backend     Rebuild backend image and restart (most common)
#   ./scripts/rebuild.sh frontend    Rebuild frontend Docker image and restart
#   ./scripts/rebuild.sh db          Restart the db container (no image build needed)
#   ./scripts/rebuild.sh all         Rebuild and restart every container

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "Usage: ./scripts/rebuild.sh backend|frontend|db|all"
  echo ""
  echo "  backend    Pick up backend code changes (most common)"
  echo "  frontend   Rebuild Docker frontend image (full Docker mode only)"
  echo "  db         Restart the database container (no build)"
  echo "  all        Rebuild and restart everything"
  echo ""
  echo "Tip: In hybrid dev mode (./scripts/start.sh --dev), frontend changes"
  echo "     appear instantly via Vite — no rebuild needed."
  exit 1
fi

cd "$ROOT"

wait_for_backend() {
  echo "→ Waiting for backend..."
  for i in {1..60}; do
    if curl -s http://localhost:8006/health > /dev/null 2>&1; then
      echo "✓ Backend ready on :8006"
      return 0
    fi
    if [ "$i" -eq 60 ]; then
      echo "✗ Backend did not become ready in 60 s"
      echo "  Check logs:  docker compose logs backend"
      return 1
    fi
    sleep 1
  done
}

case "$TARGET" in
  backend)
    echo "🔨 Rebuilding backend..."
    docker compose up --build -d backend
    wait_for_backend
    ;;

  frontend)
    echo "🔨 Rebuilding frontend..."
    echo "   Tip: In hybrid dev mode, Vite hot-reloads automatically — rebuild only needed in full Docker mode."
    docker compose up --build -d frontend
    echo "✓ Frontend rebuilt and restarted on :5178"
    ;;

  db)
    echo "🔄 Restarting database container..."
    docker compose restart db
    echo "✓ Database restarted"
    ;;

  all)
    echo "🔨 Rebuilding all containers..."
    docker compose up --build -d
    wait_for_backend
    ;;

  *)
    echo "✗ Unknown target: '$TARGET'"
    echo "   Valid targets: backend, frontend, db, all"
    exit 1
    ;;
esac

echo ""
echo "✅ Rebuild complete"
echo "   Frontend  →  http://localhost:5178"
echo "   Backend   →  http://localhost:8006"
