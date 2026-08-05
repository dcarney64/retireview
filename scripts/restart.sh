#!/bin/bash
# ProjectName — Restart All Services
echo "🔄 Restarting ProjectName..."
$(dirname "$0")/stop.sh
sleep 2
$(dirname "$0")/start.sh
