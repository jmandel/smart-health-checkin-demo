#!/bin/bash

# SMART Health Check-in - Multi-Origin Local Development
# The requester runs on the combined verifier+static server.

cleanup() {
  echo ""
  echo "🛑 Stopping all servers..."
  pkill -P $$ 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM

echo "🔨 Building project..."
bun build.ts

echo ""
echo "🚀 Starting SMART Health Check-in demo in multi-origin mode..."
echo ""
echo "  • Requester + Verifier:  http://requester.localhost:3000"
echo "  • Check-in:              http://checkin.localhost:3001"
echo "  • Flexpa:                http://flexpa.localhost:3002"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

BUILD_DIR="build/smart-health-checkin-demo"

echo "Starting Requester + Verifier on port 3000..."
(VERIFIER_BASE="http://requester.localhost:3000" STATIC_DIR="$BUILD_DIR" PORT=3000 bun demo/relay/server.ts 2>&1 | sed "s/^/[Verifier] /") &

echo "Starting Check-in on port 3001..."
(cd "$BUILD_DIR/checkin" && bunx http-server -p 3001 -c-1 2>&1 | sed "s/^/[Check-in] /") &

echo "Starting Flexpa on port 3002..."
(cd "$BUILD_DIR/source-flexpa" && bunx http-server -p 3002 -c-1 2>&1 | sed "s/^/[Flexpa] /") &

sleep 2

echo ""
echo "✓ All servers started!"
echo ""
echo "👉 Open http://requester.localhost:3000 to begin"
echo ""

wait
