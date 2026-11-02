#!/usr/bin/env bash
# Runs the day-zero migration and its checks on a throwaway local Postgres 16 (no Supabase needed).
# Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:sql
set -euo pipefail
cd "$(dirname "$0")"
DB=${DB:-hi8_day_zero_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase-stub.sql 2>&1 | grep -v -e "wal_level" || true
psql -v ON_ERROR_STOP=1 -q -d "$DB" -1 -f ../../supabase/migrations/0001_day_zero.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -1 -f ../../supabase/migrations/0001_day_zero.sql   # running it twice is safe
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f day_zero_test.sql
