#!/bin/bash

# Test static build in single-origin mode
# Serves the demo site + relay on a single port.
# The requester is at the root so response_uri is under redirect_uri.

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
echo "  • http://localhost:3003/"
echo ""

STATIC_DIR=build/smart-health-checkin-demo PORT=3003 bun demo/relay/server.ts &

wait
