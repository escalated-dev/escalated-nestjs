#!/bin/sh
set -eu

cd /host

echo "[demo] waiting for postgres..."
until pg_isready -h "${DB_HOST:-db}" -p "${DB_PORT:-5432}" -U "${DB_USER:-escalated}" >/dev/null 2>&1; do
    sleep 1
done

echo "[demo] running seed"
node dist/seed.js || echo "[demo] seed skipped/failed; continuing"

echo "[demo] ready — landing page: http://localhost:${APP_PORT:-8000}/demo"

exec "$@"
