#!/usr/bin/env bash
# Starts the Ellyra Pulse app (frontend + backend API, single TanStack Start process).
# Usage: ./start.sh [--port 5173] [--host 127.0.0.1]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-5173}"
HOST="${HOST:-127.0.0.1}"
PID_FILE=".ellyra-pulse.pid"
LOG_FILE=".ellyra-pulse.log"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Ellyra Pulse is already running (PID $(cat "$PID_FILE")). Run ./stop.sh first if you want to restart it."
  exit 0
fi
rm -f "$PID_FILE"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH. Install it from https://nodejs.org (v18+)." >&2
  exit 1
fi

PKG_RUNNER="npm"
if command -v bun >/dev/null 2>&1 && [[ -f "bun.lock" ]]; then
  PKG_RUNNER="bun"
fi

if [[ ! -d "node_modules" ]]; then
  echo "Installing dependencies with $PKG_RUNNER (first run only)..."
  if [[ "$PKG_RUNNER" == "bun" ]]; then
    bun install
  else
    npm install
  fi
fi

echo "Starting Ellyra Pulse on http://$HOST:$PORT ..."
if [[ "$PKG_RUNNER" == "bun" ]]; then
  nohup bun run dev --host "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &
else
  nohup npm run dev -- --host "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &
fi
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

# Wait for the dev server to report readiness (or fail) rather than guessing with a fixed sleep.
for _ in $(seq 1 30); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "Ellyra Pulse failed to start. Last log lines:" >&2
    tail -n 30 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  if grep -q "ready in\|Local:" "$LOG_FILE" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "Ellyra Pulse is running (PID $APP_PID). Logs: $LOG_FILE"
echo "Open: http://$HOST:$PORT"
echo "Stop with: ./stop.sh"
