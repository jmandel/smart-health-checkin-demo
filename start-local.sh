#!/bin/bash

# SMART Health Check-in - Multi-Origin Local Development
# Builds and serves demo apps on different localhost subdomains/ports
# The requester runs on the combined relay+static server so that
# response_uri is under the requester's redirect_uri (same origin).

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
echo "  • Requester + Relay:  http://requester.localhost:3000"
echo "  • Check-in:           http://checkin.localhost:3001"
echo "  • Flexpa:             http://flexpa.localhost:3002"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

BUILD_DIR="build/smart-health-checkin-demo"

# Requester uses combined relay+static server (relay on same origin)
echo "Starting Requester + Relay on port 3000..."
(STATIC_DIR="$BUILD_DIR" PORT=3000 bun demo/relay/server.ts 2>&1 | sed "s/^/[Requester+Relay] /") &

# Other apps use plain static servers
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
