-- Minimal stand-in for the parts of Supabase the migration relies on, so it can be tested on plain
-- PostgreSQL. Never run this against a real Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's default privileges hand new tables and functions to the API roles; mimic that so the
-- migration's revokes are actually exercised.
alter default privileges grant all on tables to anon, authenticated, service_role;
alter default privileges grant all on sequences to anon, authenticated, service_role;
alter default privileges grant execute on functions to anon, authenticated, service_role;
