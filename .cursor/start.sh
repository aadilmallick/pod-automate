#!/usr/bin/env bash
# Per-boot startup for Pod Automator: bring up PostgreSQL + Redis and make sure
# the database is present and bootstrapped. Long-running app processes (API,
# worker, Vite) are launched from the environment's `terminals`, not here.
# This script is idempotent and returns after services are confirmed ready.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PG_VERSION=16
PG_CLUSTER=main

echo "==> Starting PostgreSQL cluster if not already online"
if ! pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
  sudo pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start
fi

echo "==> Starting Redis if not already responding"
if ! redis-cli ping >/dev/null 2>&1; then
  sudo redis-server --daemonize yes
fi

echo "==> Waiting for PostgreSQL to accept connections"
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> Ensuring 'pod' role and 'pod_automator' database exist"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pod') THEN
    CREATE ROLE pod LOGIN PASSWORD 'pod';
  END IF;
END$$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='pod_automator'" | grep -q 1; then
  sudo -u postgres createdb -O pod pod_automator
fi

echo "==> Bootstrapping database schema (idempotent)"
npm run db:bootstrap

echo "==> Services ready: PostgreSQL on :5432, Redis on :6379."
