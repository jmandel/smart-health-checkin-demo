#!/bin/bash

# Test static build in single-origin mode (like GitHub Pages)
# Serves the demo site + relay on a single port.
# If RELAY_URL is set, bakes the external relay URL into the build.

# Cleanup function to kill all child processes
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

if [ -n "$RELAY_URL" ]; then
  echo "🚀 Using external relay: $RELAY_URL"
  echo "Starting static-only server..."
  echo ""
  echo "  • http://localhost:8080/smart-health-checkin-demo/"
  echo ""
  (cd build && bunx http-server -p 8080 -c-1 2>&1) &
else
  echo "🚀 Starting combined relay + static server..."
  echo ""
  echo "  • http://localhost:3003/smart-health-checkin-demo/"
  echo ""
  STATIC_DIR=build PORT=3003 bun demo/relay/server.ts &
fi

wait
