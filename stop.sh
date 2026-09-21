#!/usr/bin/env bash
# Stops the Ellyra Pulse dev server started by start.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE=".ellyra-pulse.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found ($PID_FILE) — Ellyra Pulse doesn't look like it's running via start.sh."
  exit 0
fi

PID="$(cat "$PID_FILE")"

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Process $PID is not running. Cleaning up stale PID file."
  rm -f "$PID_FILE"
  exit 0
fi

echo "Stopping Ellyra Pulse (PID $PID)..."
kill "$PID" 2>/dev/null || true

for _ in $(seq 1 10); do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Stopped."
    exit 0
  fi
  sleep 1
done

echo "Process didn't exit in time, forcing..."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "Stopped."
