#!/usr/bin/env bash
# Runs the migration and its tests against a throwaway local PostgreSQL cluster.
# Needs PostgreSQL 15+ binaries (initdb, pg_ctl, psql). Nothing here touches Supabase.
#   usage: supabase/tests/run_local.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
bindir="${PG_BINDIR:-$(pg_config --bindir 2>/dev/null || true)}"
[ -x "$bindir/initdb" ] || { echo "PostgreSQL binaries not found; set PG_BINDIR" >&2; exit 1; }

work="$(mktemp -d)"
port="${PGTEST_PORT:-54329}"
cleanup() { "$bindir/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

"$bindir/initdb" -D "$work/data" -U postgres -A trust >/dev/null
"$bindir/pg_ctl" -D "$work/data" -o "-p $port -c listen_addresses='' -k $work" -l "$work/log" -w start >/dev/null

psql=("$bindir/psql" -h "$work" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${psql[@]}" -f "$here/local_stub.sql"
"${psql[@]}" -f "$root/supabase/migrations/0001_init.sql"
# Data in the shape the first version stored, so the upgrade path is tested, not just a fresh install.
"${psql[@]}" -o /dev/null -f "$here/legacy_seed.sql"
"${psql[@]}" -f "$root/supabase/migrations/0002_dashboard_outbox.sql"
"${psql[@]}" -f "$root/supabase/migrations/0003_retention_180_days.sql"
# Query results are discarded; each check prints an "ok" notice or aborts the run.
"${psql[@]}" -o /dev/null -f "$here/schema_test.sql" 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
