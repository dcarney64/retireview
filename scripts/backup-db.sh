#!/bin/bash
# Backup RetireView database
BACKUP_DIR="$HOME/projects/retireview/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/retireview_$DATE.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "→ Backing up database..."
docker compose -f "$HOME/projects/retireview/docker-compose.yml" \
  exec -T db pg_dump -U retireview retireview_db \
  | gzip > "$BACKUP_FILE"

echo "✓ Backup saved to $BACKUP_FILE"
echo "  Size: $(du -sh $BACKUP_FILE | cut -f1)"

# Keep only last 30 backups
ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | \
  tail -n +31 | xargs rm -f 2>/dev/null

echo "✓ Old backups cleaned up"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -5
