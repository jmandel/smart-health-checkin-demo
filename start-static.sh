#!/bin/bash

# Test static build in single-origin mode (like GitHub Pages)
# Serves the demo site + relay on a single port using the relay server.

cleanup() {
  echo ""
  echo "🛑 Stopping..."
  pkill -P $$ 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM

echo "🔨 Building project..."
bun build.ts

echo ""
echo "🚀 Starting combined relay + static server..."
echo ""
echo "  • http://localhost:3003/smart-health-checkin-demo/"

if [ -n "$RELAY_URL" ]; then
  echo "  • Relay: $RELAY_URL (external, baked into build)"
else
  echo "  • Relay: http://localhost:3003 (local)"
fi

echo ""

STATIC_DIR=build PORT=3003 bun demo/relay/server.ts &

wait
