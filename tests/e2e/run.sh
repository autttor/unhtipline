#!/usr/bin/env bash
# End-to-end test: local PostgreSQL + the real server functions + a stand-in for Supabase sign-in,
# driven through a real browser. Needs PostgreSQL 15+ binaries and Playwright with Chromium.
#   usage: npm run test:e2e
# Nothing here touches Supabase, sends email, or uses real student data.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
bindir="${PG_BINDIR:-$(pg_config --bindir 2>/dev/null || true)}"
[ -x "$bindir/initdb" ] || { echo "PostgreSQL binaries not found; set PG_BINDIR" >&2; exit 1; }

work="$(mktemp -d)"
export PGHOST="$work" PGPORT="${PGTEST_PORT:-54331}" E2E_PORT="${E2E_PORT:-8791}"

# PostgreSQL refuses to run as root, so hand the data directory to the postgres user when we are root.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = 0 ]; then chown postgres "$work"; chmod 755 "$work"; fi

server_pid=""
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  as_pg "$bindir/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

as_pg "$bindir/initdb" -D "$work/data" -U postgres -A trust >/dev/null
as_pg "$bindir/pg_ctl" -D "$work/data" -o "-p $PGPORT -c listen_addresses='' -k $work" -l "$work/log" -w start >/dev/null

psql=("$bindir/psql" -h "$work" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${psql[@]}" -f "$root/supabase/tests/local_stub.sql"
"${psql[@]}" -f "$root/supabase/migrations/0001_init.sql"
"${psql[@]}" -f "$root/supabase/migrations/0002_dashboard_outbox.sql"
"${psql[@]}" -f "$root/supabase/migrations/0003_retention_180_days.sql"
# Fictional team: an admin, a reviewer and an advocate, plus an account that is not on the team.
"${psql[@]}" <<'SQL'
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.org'),
  ('00000000-0000-0000-0000-000000000002', 'reviewer@example.org'),
  ('00000000-0000-0000-0000-000000000003', 'advocate@example.org'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.org');
insert into private.staff (user_id, email, display_name, role) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.org', 'Ada Admin', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'reviewer@example.org', 'Riley Reviewer', 'reviewer'),
  ('00000000-0000-0000-0000-000000000003', 'advocate@example.org', 'Avery Advocate', 'advocate');
SQL

PATH="$bindir:$PATH" node "$here/server.mjs" > "$work/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$E2E_PORT/closed/index.html" && break; sleep 0.25; done

node "$here/browser.mjs" "http://localhost:$E2E_PORT" || { echo "--- server log"; tail -20 "$work/server.log"; exit 1; }
