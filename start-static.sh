#!/bin/bash

# Test static build in single-origin mode (like GitHub Pages)
# This serves the built demo site from one origin.
# If RELAY_URL is not set, also starts a local relay on port 3003.

# Cleanup function to kill all child processes
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
echo "🚀 Starting static server in single-origin mode..."
echo ""
echo "  • Clinic:    http://localhost:8080/smart-health-checkin-demo/"
echo "  • Check-in:  http://localhost:8080/smart-health-checkin-demo/checkin/"
echo "  • Flexpa:    http://localhost:8080/smart-health-checkin-demo/source-flexpa/"

if [ -z "$RELAY_URL" ]; then
  echo "  • Relay:     http://localhost:3003 (local)"
  echo ""
  # Start local relay server
  (bun demo/relay/server.ts 2>&1 | sed "s/^/[Relay] /") &
else
  echo "  • Relay:     $RELAY_URL (external)"
  echo ""
fi

echo "Press Ctrl+C to stop"
echo ""

# Start static file server
(cd build && bunx http-server -p 8080 -c-1 2>&1 | sed "s/^/[Static] /") &

wait
