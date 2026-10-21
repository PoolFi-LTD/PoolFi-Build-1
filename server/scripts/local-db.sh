#!/bin/sh
# Starts a private PostgreSQL for local development in server/.local/postgres,
# separate from any system database. Safe to run repeatedly.
set -eu

cd "$(dirname "$0")/.."
BIN="$(pg_config --bindir)"
DATA="$(pwd)/.local/postgres"
PORT="${LOCAL_DB_PORT:-54329}"

if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DATA"
  "$BIN/initdb" --pgdata="$DATA" --username=poolfi --auth=trust --encoding=UTF8 >/dev/null
fi

if ! "$BIN/pg_ctl" --pgdata="$DATA" status >/dev/null 2>&1; then
  "$BIN/pg_ctl" --pgdata="$DATA" --log="$DATA/server.log" --wait \
    -o "-p $PORT -k $(pwd)/.local -c listen_addresses=localhost" start >/dev/null
fi

if ! "$BIN/psql" -h localhost -p "$PORT" -U poolfi -d postgres -Atc \
  "select 1 from pg_database where datname = 'poolfi'" | grep -q 1; then
  "$BIN/createdb" -h localhost -p "$PORT" -U poolfi poolfi
fi

echo "Local database running: postgres://poolfi@localhost:$PORT/poolfi"
echo "Stop it with: $BIN/pg_ctl --pgdata=$DATA stop"
