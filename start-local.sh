#!/bin/bash

# SMART Health Check-in - Multi-Origin Local Development
# Builds and serves demo apps on different localhost subdomains/ports
# This simulates the multi-origin deployment scenario

# Cleanup function to kill all child processes
cleanup() {
  echo ""
  echo "🛑 Stopping all servers..."
  pkill -P $$ 2>/dev/null
  exit 0
}

# Set up trap to catch Ctrl+C and other termination signals
trap cleanup SIGINT SIGTERM

echo "🔨 Building project..."
bun build.ts

echo ""
echo "🚀 Starting SMART Health Check-in demo in multi-origin mode..."
echo ""
echo "This will start 4 servers:"
echo "  • Requester:  http://requester.localhost:3000"
echo "  • Check-in:   http://checkin.localhost:3001"
echo "  • Flexpa:     http://flexpa.localhost:3002"
echo "  • Relay:      http://relay.localhost:3003"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Serve each app's built output from the build directory
BUILD_DIR="build/smart-health-checkin-demo"

start_server() {
  local app=$1
  local port=$2
  local name=$3

  echo "Starting $name on port $port..."
  (cd "$BUILD_DIR/$app" && bunx http-server -p $port -c-1 2>&1 | sed "s/^/[$name] /") &
}

start_server "." 3000 "Requester"
start_server "checkin" 3001 "Check-in"
start_server "source-flexpa" 3002 "Flexpa"

# Start relay server (runs directly, not from build dir)
echo "Starting Relay on port 3003..."
(bun demo/relay/server.ts 2>&1 | sed "s/^/[Relay] /") &

# Wait a moment for servers to start
sleep 2

echo ""
echo "✓ All servers started!"
echo ""
echo "👉 Open http://requester.localhost:3000 to begin"
echo ""

# Wait for user to press Ctrl+C
wait
