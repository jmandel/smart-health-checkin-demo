#!/bin/bash
set -m  # enable job control so we get a process group

# SMART Health Check-in - Local Development

cleanup() {
  trap - SIGINT SIGTERM EXIT
  echo ""
  echo "🛑 Stopping all servers..."
  jobs -pr | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

MODE="${1:---single-port}"
if [[ "$MODE" != "--single-port" && "$MODE" != "--multi-origin" ]]; then
  echo "Usage: ./start-local.sh [--single-port|--multi-origin]"
  exit 1
fi

echo "🔨 Building project..."
bun build.ts

echo ""
echo "🚀 Starting SMART Health Check-in demo..."
echo ""

BUILD_DIR="build/smart-health-checkin-demo"

if [[ "$MODE" == "--single-port" ]]; then
  echo "  • Mode:                 single-port"
  echo "  • Landing:              http://localhost:3000"
  echo "  • Portal (same-device): http://localhost:3000/portal/"
  echo "  • Kiosk (cross-device): http://localhost:3000/kiosk/"
  echo "  • Check-in picker:      http://localhost:3000/checkin/"
  echo "  • Sample Health App:    http://localhost:3000/source-app/"
  echo ""
  echo "Press Ctrl+C to stop the server"
  echo ""

  CANONICAL_ORIGIN="http://localhost:3000" VERIFIER_BASE="http://localhost:3000" STATIC_DIR="$BUILD_DIR" ALLOWED_SAME_DEVICE_ORIGINS="*" PORT=3000 bun demo/serve-demo.ts &
else
  echo "  • Mode:                 multi-origin"
  echo "  • Landing:              http://requester.localhost:3000"
  echo "  • Portal (same-device): http://requester.localhost:3000/portal/"
  echo "  • Kiosk (cross-device): http://requester.localhost:3000/kiosk/"
  echo "  • Check-in picker:      http://checkin.localhost:3001"
  echo "  • Sample Health App:    http://sample-health.localhost:3002"
  echo ""
  echo "Press Ctrl+C to stop all servers"
  echo ""

  VERIFIER_BASE="http://requester.localhost:3000" STATIC_DIR="$BUILD_DIR" ALLOWED_SAME_DEVICE_ORIGINS="*" PORT=3000 bun demo/serve-demo.ts &
  STATIC_DIR="$BUILD_DIR/checkin" PORT=3001 bun demo/serve-demo.ts &
  STATIC_DIR="$BUILD_DIR/source-app" PORT=3002 bun demo/serve-demo.ts &
fi

sleep 2

echo ""
echo "✓ All servers started!"
echo ""
if [[ "$MODE" == "--single-port" ]]; then
  echo "👉 Open http://localhost:3000 to begin"
else
  echo "👉 Open http://requester.localhost:3000 to begin"
fi
echo ""

wait
