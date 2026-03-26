#!/bin/bash

# Single-origin mode: serves demo + verifier on one port.

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
echo "🚀 Starting combined verifier + static server..."
echo ""
echo "  • http://localhost:3003/"
echo ""

VERIFIER_BASE="http://localhost:3003" STATIC_DIR=build/smart-health-checkin-demo PORT=3003 bun demo/relay/serve-demo.ts &

wait
