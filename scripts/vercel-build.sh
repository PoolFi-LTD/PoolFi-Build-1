#!/bin/sh
# Vercel's build (web/vercel.json): update the database first, then build the web app.
# A migration that fails stops the deploy, so code that needs a new column never goes
# live before the column exists. Migrations take a Postgres lock, so two builds at once
# can't apply the same file twice.
#
# Set SKIP_MIGRATIONS=1 on a Vercel environment to skip this (e.g. Preview deployments
# that share the production database and shouldn't change it).
set -eu

if [ "${SKIP_MIGRATIONS:-}" = "1" ]; then
  echo "SKIP_MIGRATIONS=1: not touching the database."
elif [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL isn't set; can't apply migrations." >&2
  exit 1
else
  npm --workspace server run migrate:deploy
fi

npm --workspace web run build
