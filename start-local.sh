#!/bin/bash
set -m  # enable job control so we get a process group

# SMART Health Check-in - Multi-Origin Local Development

cleanup() {
  echo ""
  echo "🛑 Stopping all servers..."
  kill 0 2>/dev/null  # kill entire process group
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "🔨 Building project..."
bun build.ts

echo ""
echo "🚀 Starting SMART Health Check-in demo..."
echo ""
echo "  • Landing:              http://requester.localhost:3000"
echo "  • Portal (same-device): http://requester.localhost:3000/portal/"
echo "  • Kiosk (cross-device): http://requester.localhost:3000/kiosk/"
echo "  • Check-in picker:      http://checkin.localhost:3001"
echo "  • Sample Health App source:        http://sample-health.localhost:3002"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

BUILD_DIR="build/smart-health-checkin-demo"

VERIFIER_BASE="http://requester.localhost:3000" STATIC_DIR="$BUILD_DIR" ALLOWED_SAME_DEVICE_ORIGINS="*" PORT=3000 bun demo/serve-demo.ts &
(cd "$BUILD_DIR/checkin" && bunx http-server -p 3001 -c-1) &
(cd "$BUILD_DIR/source-app" && bunx http-server -p 3002 -c-1) &

sleep 2

echo ""
echo "✓ All servers started!"
echo ""
echo "👉 Open http://requester.localhost:3000 to begin"
echo ""

wait
