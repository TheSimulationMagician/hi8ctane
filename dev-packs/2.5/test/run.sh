#!/usr/bin/env bash
# Runs the schema and the Plan B test on a throwaway local Postgres 16 database.
# Usage: PGHOST=/tmp PGPORT=5433 PGUSER=postgres ./test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=${DB:-hi8_plan_b_test}
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase-stub.sql 2>&1 | grep -v -e "wal_level" -e "Set wal_level" || true
psql -v ON_ERROR_STOP=1 -q -d "$DB" -1 -f ../schema.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f plan_b_test.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f ../analytics/metrics.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f metrics_test.sql
