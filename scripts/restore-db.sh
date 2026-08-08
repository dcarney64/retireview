#!/bin/bash
# Restore RetireView database from backup
BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./scripts/restore-db.sh <backup_file>"
  echo ""
  echo "Available backups:"
  ls -lh "$HOME/projects/retireview/backups/"*.sql.gz \
    2>/dev/null || echo "No backups found"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "✗ Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "⚠️  This will REPLACE all current data!"
read -p "Are you sure? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Cancelled."
  exit 0
fi

echo "→ Restoring from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | \
  docker compose -f "$HOME/projects/retireview/docker-compose.yml" \
  exec -T db psql -U retireview retireview_db

echo "✓ Restore complete"
