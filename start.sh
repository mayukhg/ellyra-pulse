#!/usr/bin/env bash
# Starts the Ellyra Pulse app (frontend + backend API, single TanStack Start process).
# Usage: ./start.sh [--port 5173] [--host 127.0.0.1] [--with-postgres] [--shadow]
#
# On first run, generates .env with AUTH_JWT_SECRET/INGEST_HMAC_SECRET if missing (see
# .env.example). Without --with-postgres, the backend uses the in-memory store seeded from
# data/synthetic/. --with-postgres points it at the local dev database created by
# scripts/setup-postgres.sh (run that first) — it does not start Postgres itself.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-5173}"
HOST="${HOST:-127.0.0.1}"
PID_FILE=".ellyra-pulse.pid"
LOG_FILE=".ellyra-pulse.log"
ENV_FILE=".env"
WITH_POSTGRES=false
SHADOW_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --with-postgres) WITH_POSTGRES=true; shift ;;
    --shadow) SHADOW_MODE=true; shift ;;
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

# Generate .env with secrets on first run — auth.ts/verifyIngestionSignature require these to be
# set, or every request fails with a 500. See .env.example for the full list of options.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "No .env found — generating one with fresh secrets (see .env.example for what else you can set)."
  {
    echo "AUTH_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    echo "INGEST_HMAC_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  } > "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "$WITH_POSTGRES" == true ]]; then
  export DATABASE_URL="${DATABASE_URL:-postgres://ellyra:ellyra_dev_pw@127.0.0.1:5432/ellyra_pulse}"
  if ! psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    echo "Could not connect to $DATABASE_URL." >&2
    echo "Run scripts/setup-postgres.sh first (and check Postgres is running)." >&2
    exit 1
  fi
  echo "Using Postgres at $DATABASE_URL"
else
  unset DATABASE_URL
  echo "Using the in-memory store (pass --with-postgres to use a real database instead)."
fi

if [[ "$SHADOW_MODE" == true ]]; then
  export INGESTION_MODE=shadow
  echo "INGESTION_MODE=shadow — ingest requests will be evaluated but not persisted or paged."
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
echo "Mint a dev API token with: AUTH_JWT_SECRET=... node scripts/mint-dev-token.mjs"
echo "Stop with: ./stop.sh"
