#!/bin/bash

# Test static build in single-origin mode (like GitHub Pages)
# This serves the built demo site from one origin, plus the relay server

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
echo "This simulates GitHub Pages deployment at:"
echo "  • Main:      http://localhost:8080/smart-health-checkin-demo/"
echo "  • Requester: http://localhost:8080/smart-health-checkin-demo/requester/"
echo "  • Check-in:  http://localhost:8080/smart-health-checkin-demo/checkin/"
echo "  • Flexpa:    http://localhost:8080/smart-health-checkin-demo/source-flexpa/"
echo "  • Relay:     http://localhost:3003"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Start relay server
(bun demo/relay/server.ts 2>&1 | sed "s/^/[Relay] /") &

# Start static file server
(cd build && bunx http-server -p 8080 -c-1 2>&1 | sed "s/^/[Static] /") &

wait
