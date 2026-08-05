#!/bin/bash
# ProjectName — Tail logs from both services
echo "📋 ProjectName Logs (Ctrl+C to stop)"
echo ""
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tail -f "$ROOT/logs/.backend.log" "$ROOT/logs/.frontend.log"
