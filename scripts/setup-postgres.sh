#!/usr/bin/env bash
# Idempotent local Postgres setup for Ellyra Pulse: creates the role/database (if missing) and
# applies db/migrations/0001_init.sql. Assumes a Postgres server is already running locally and
# reachable with a superuser (defaults assume the `postgres` OS user can run `psql` locally —
# adjust PGSUPERUSER/PGHOST/PGPORT for your environment).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

DB_NAME="${ELLYRA_DB_NAME:-ellyra_pulse}"
DB_USER="${ELLYRA_DB_USER:-ellyra}"
DB_PASSWORD="${ELLYRA_DB_PASSWORD:-ellyra_dev_pw}"
PSQL_SUPERUSER_CMD="${PSQL_SUPERUSER_CMD:-sudo -u postgres psql}"

echo "Checking for existing role '$DB_USER'..."
if ! $PSQL_SUPERUSER_CMD -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  echo "Creating role '$DB_USER'..."
  $PSQL_SUPERUSER_CMD -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
else
  echo "Role '$DB_USER' already exists."
fi

echo "Checking for existing database '$DB_NAME'..."
if ! $PSQL_SUPERUSER_CMD -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "Creating database '$DB_NAME'..."
  $PSQL_SUPERUSER_CMD -c "CREATE DATABASE $DB_NAME;"
else
  echo "Database '$DB_NAME' already exists."
fi

$PSQL_SUPERUSER_CMD -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
$PSQL_SUPERUSER_CMD -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

echo "Applying db/migrations/0001_init.sql (safe to re-run only on a fresh database)..."
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" \
  --set ON_ERROR_STOP=1 -f "$REPO_ROOT/db/migrations/0001_init.sql"

echo ""
echo "Done. Set this before starting the app (or pass --with-postgres to start.sh):"
echo "  DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME"
echo ""
echo "To load the synthetic dataset into it: node scripts/seed-postgres.mjs"
