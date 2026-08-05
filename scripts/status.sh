#!/bin/bash
# ProjectName — Check Status of All Services

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PORT=$(grep -E '^DB_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
DB_PORT=${DB_PORT:-5432}
DB_NAME=$(grep -E '^DB_NAME=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
DB_NAME=${DB_NAME:-projectname_db}

echo "📊 ProjectName Status"
echo "────────────────────────────────"

# PostgreSQL
if pg_isready -h localhost -p "$DB_PORT" -q; then
  echo "✓ PostgreSQL    running on :$DB_PORT"
else
  echo "✗ PostgreSQL    NOT running on :$DB_PORT"
fi

# Backend
if curl -s http://localhost:8004/health > /dev/null 2>&1; then
  echo "✓ Backend       running on :8004"
else
  echo "✗ Backend       NOT running on :8004"
fi

# Frontend
if curl -s http://localhost:5176 > /dev/null 2>&1; then
  echo "✓ Frontend      running on :5176"
else
  echo "✗ Frontend      NOT running on :5176"
fi

echo "────────────────────────────────"

# Database stats
if pg_isready -h localhost -p "$DB_PORT" -q; then
  echo ""
  if sudo -n true 2>/dev/null; then
    echo "Database tables:"
    sudo -u postgres psql -p "$DB_PORT" -d "$DB_NAME" -c "
      SELECT tablename,
             pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) as size
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    " 2>/dev/null || true
  else
    echo "  DB stats: (run with sudo for table sizes)"
  fi
fi
