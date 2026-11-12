-- UNewHaven Pride Report: database schema.
--
-- Design:
--   * Every table lives in the `private` schema, which the Supabase API does not expose.
--     Row-level security is enabled with no policies as a second lock.
--   * The only way in is through the functions at the bottom of this file:
--       - submit_report / track_view / track_message / purge_expired_reports: service_role only,
--         called by the Edge Functions. The browser never touches the database directly.
--       - reviewer_*: signed-in reviewers only, with two-factor authentication (aal2),
--         and every call that reads or changes a report writes an audit entry.
--   * Access codes are never stored. Only a keyed hash (HMAC, computed in the Edge Function) is.

create schema if not exists private;
revoke all on schema private from public;

create type private.report_status as enum ('received', 'under_review', 'response_available', 'closed');

create sequence private.report_public_seq start 1043;

create table private.reports (
  id               uuid primary key default gen_random_uuid(),
  public_id        text not null unique default ('PR-' || nextval('private.report_public_seq')),
  access_code_hash text not null unique check (access_code_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz not null default now(),
  status           private.report_status not null default 'received',
  contact_mode     text not null check (contact_mode in ('anonymous', 'portal', 'identified')),
  -- Copies of two fixed-choice answers, used only for de-identified statistics. Never free text.
  category         text,
  location         text,
  report           jsonb not null check (octet_length(report::text) <= 32768),
  -- Retention: change the interval here and in the published privacy policy together.
  delete_after     timestamptz not null default (now() + interval '365 days')
);
create index reports_created_idx on private.reports (created_at desc);
create index reports_delete_after_idx on private.reports (delete_after);

create table private.report_messages (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references private.reports (id) on delete cascade,
  sender     text not null check (sender in ('student', 'reviewer')),
  author     uuid,  -- reviewer's auth user id; null for students
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index report_messages_report_idx on private.report_messages (report_id, created_at);

create table private.report_notes (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references private.reports (id) on delete cascade,
  author     uuid not null,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table private.report_referrals (
  report_id  uuid not null references private.reports (id) on delete cascade,
  resource   text not null check (resource ~ '^[A-Za-z0-9_]{1,40}$'),
  author     uuid not null,
  created_at timestamptz not null default now(),
  primary key (report_id, resource)
);

-- Who may review. Rows are added by hand by the project owner (SQL editor), never through the API.
create table private.reviewers (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  active       boolean not null default true,
  added_at     timestamptz not null default now()
);

-- Deliberately has no foreign key to reports: entries must survive deletion, and hold no report content.
create table private.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  public_id text
);
create index audit_log_at_idx on private.audit_log (at desc);

-- `bucket` is a keyed hash of the caller's IP address that changes every day; rows are purged after 2 days.
create table private.rate_limits (
  bucket       text not null,
  action       text not null,
  window_start timestamptz not null,
  hits         integer not null default 1,
  primary key (bucket, action, window_start)
);

alter table private.reports          enable row level security;
alter table private.report_messages  enable row level security;
alter table private.report_notes     enable row level security;
alter table private.report_referrals enable row level security;
alter table private.reviewers        enable row level security;
alter table private.audit_log        enable row level security;
alter table private.rate_limits      enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------

create function private.rate_limit_ok(p_bucket text, p_action text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_hits integer;
begin
  delete from private.rate_limits where window_start < now() - interval '2 days';
  insert into private.rate_limits as rl (bucket, action, window_start, hits)
  values (p_bucket, p_action, date_trunc('hour', now()), 1)
  on conflict (bucket, action, window_start) do update set hits = rl.hits + 1
  returning rl.hits into v_hits;
  return v_hits <= p_limit;
end $$;

create function private.student_view(p_report private.reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_report.public_id,
    'status', p_report.status,
    'created_at', p_report.created_at,
    'contact_mode', p_report.contact_mode,
    'report', p_report.report,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from private.report_messages m where m.report_id = p_report.id), '[]'::jsonb)
  );
$$;

-- Raises unless the caller is an active reviewer who signed in with a second factor.
create function private.require_reviewer()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from private.reviewers r where r.user_id = v_uid and r.active) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create function private.find_report(p_public_id text)
returns private.reports language plpgsql stable security definer set search_path = '' as $$
declare
  v_report private.reports;
begin
  select * into v_report from private.reports where public_id = p_public_id;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  return v_report;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Student-facing functions (service_role only; called from the Edge Functions)
-- ---------------------------------------------------------------------------------------------

create function public.submit_report(p_code_hash text, p_report jsonb, p_bucket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_public_id text;
begin
  if not private.rate_limit_ok(p_bucket, 'submit', 5) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  insert into private.reports (access_code_hash, contact_mode, category, location, report)
  values (
    p_code_hash,
    p_report ->> 'contact_mode',
    nullif(p_report -> 'category' ->> 'value', ''),
    nullif(p_report -> 'where' ->> 'value', ''),
    p_report
  )
  returning public_id into v_public_id;
  return jsonb_build_object('id', v_public_id);
end $$;

create function public.track_view(p_code_hash text, p_bucket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report private.reports;
begin
  if not private.rate_limit_ok(p_bucket, 'track', 30) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into v_report from private.reports where access_code_hash = p_code_hash;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  return private.student_view(v_report);
end $$;

create function public.track_message(p_code_hash text, p_body text, p_bucket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report private.reports;
begin
  if not private.rate_limit_ok(p_bucket, 'track', 30) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into v_report from private.reports where access_code_hash = p_code_hash;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_report.contact_mode = 'anonymous' then
    return jsonb_build_object('error', 'messaging_disabled');
  end if;
  if v_report.status = 'closed' then
    return jsonb_build_object('error', 'closed');
  end if;
  insert into private.report_messages (report_id, sender, body) values (v_report.id, 'student', p_body);
  return private.student_view(v_report);
end $$;

-- Run daily (see the pg_cron note at the end of this file).
create function public.purge_expired_reports()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with gone as (
    delete from private.reports where delete_after < now() returning public_id
  ), logged as (
    insert into private.audit_log (actor, action, public_id)
    select null, 'retention_deleted', public_id from gone returning 1
  )
  select count(*) into v_count from logged;
  delete from private.rate_limits where window_start < now() - interval '2 days';
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reviewer functions (authenticated reviewers with MFA only)
-- ---------------------------------------------------------------------------------------------

create function public.reviewer_list_reports()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_reviewer();
  -- Metadata only: reading the content requires reviewer_open_report, which is audited.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.public_id, 'created_at', r.created_at, 'status', r.status,
      'category', r.category, 'location', r.location, 'contact_mode', r.contact_mode,
      'awaiting_reply', r.status <> 'closed' and r.contact_mode <> 'anonymous' and coalesce(
        (select m.sender = 'student' from private.report_messages m
          where m.report_id = r.id order by m.created_at desc, m.id desc limit 1),
        r.report -> 'wants' ? 'reply')
    ) order by r.created_at desc)
    from private.reports r), '[]'::jsonb);
end $$;

create function public.reviewer_open_report(p_public_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_report private.reports := private.find_report(p_public_id);
begin
  if v_report.status = 'received' then
    update private.reports set status = 'under_review' where id = v_report.id returning * into v_report;
  end if;
  insert into private.audit_log (actor, action, public_id) values (v_uid, 'opened_report', p_public_id);
  return private.student_view(v_report) || jsonb_build_object(
    'delete_after', v_report.delete_after,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('body', n.body, 'created_at', n.created_at,
        'by', (select rv.display_name from private.reviewers rv where rv.user_id = n.author)) order by n.created_at, n.id)
      from private.report_notes n where n.report_id = v_report.id), '[]'::jsonb),
    'referrals', coalesce((
      select jsonb_agg(f.resource order by f.created_at)
      from private.report_referrals f where f.report_id = v_report.id), '[]'::jsonb)
  );
end $$;

create function public.reviewer_set_status(p_public_id text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_report private.reports := private.find_report(p_public_id);
begin
  update private.reports set status = p_status::private.report_status where id = v_report.id;
  insert into private.audit_log (actor, action, public_id) values (v_uid, 'status_' || p_status, p_public_id);
end $$;

create function public.reviewer_reply(p_public_id text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_report private.reports := private.find_report(p_public_id);
begin
  if v_report.contact_mode = 'anonymous' then
    raise exception 'messaging_disabled';
  end if;
  if v_report.status = 'closed' then
    raise exception 'closed';
  end if;
  insert into private.report_messages (report_id, sender, author, body) values (v_report.id, 'reviewer', v_uid, p_body);
  update private.reports set status = 'response_available' where id = v_report.id;
  insert into private.audit_log (actor, action, public_id) values (v_uid, 'replied_to_student', p_public_id);
end $$;

create function public.reviewer_add_note(p_public_id text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_report private.reports := private.find_report(p_public_id);
begin
  insert into private.report_notes (report_id, author, body) values (v_report.id, v_uid, p_body);
  insert into private.audit_log (actor, action, public_id) values (v_uid, 'added_internal_note', p_public_id);
end $$;

create function public.reviewer_set_referral(p_public_id text, p_resource text, p_shared boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_report private.reports := private.find_report(p_public_id);
begin
  if p_shared then
    insert into private.report_referrals (report_id, resource, author) values (v_report.id, p_resource, v_uid)
    on conflict do nothing;
  else
    delete from private.report_referrals where report_id = v_report.id and resource = p_resource;
  end if;
  insert into private.audit_log (actor, action, public_id)
  values (v_uid, case when p_shared then 'recorded_referral:' else 'removed_referral:' end || p_resource, p_public_id);
end $$;

create function public.reviewer_delete_report(p_public_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_report private.reports := private.find_report(p_public_id);
begin
  delete from private.reports where id = v_report.id;
  insert into private.audit_log (actor, action, public_id) values (v_uid, 'deleted_report', p_public_id);
end $$;

-- De-identified counts. Groups smaller than 5 are suppressed: the count comes back as null.
create function public.reviewer_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_reviewer();
  v_min constant integer := 5;
  v_result jsonb;
begin
  select jsonb_build_object(
    'suppressed_below', v_min,
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'count', case when n >= v_min then n end) order by key)
      from (select coalesce(category, 'none') as key, count(*) as n from private.reports group by 1) c), '[]'::jsonb),
    'by_location', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'count', case when n >= v_min then n end) order by key)
      from (select coalesce(location, 'none') as key, count(*) as n from private.reports group by 1) l), '[]'::jsonb)
  ) into v_result;
  insert into private.audit_log (actor, action) values (v_uid, 'viewed_statistics');
  return v_result;
end $$;

create function public.reviewer_audit_log(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_reviewer();
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e.at desc, e.id desc)
    from (
      select a.id, a.at, a.action, a.public_id,
             (select rv.display_name from private.reviewers rv where rv.user_id = a.actor) as actor
      from private.audit_log a order by a.at desc, a.id desc limit least(greatest(p_limit, 1), 1000)
    ) e), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges. Supabase grants broadly by default, so everything is revoked and re-granted narrowly.
-- ---------------------------------------------------------------------------------------------

revoke all on all tables    in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function
  public.submit_report(text, jsonb, text),
  public.track_view(text, text),
  public.track_message(text, text, text),
  public.purge_expired_reports(),
  public.reviewer_list_reports(),
  public.reviewer_open_report(text),
  public.reviewer_set_status(text, text),
  public.reviewer_reply(text, text),
  public.reviewer_add_note(text, text),
  public.reviewer_set_referral(text, text, boolean),
  public.reviewer_delete_report(text),
  public.reviewer_stats(),
  public.reviewer_audit_log(integer)
from public, anon, authenticated;

grant execute on function
  public.submit_report(text, jsonb, text),
  public.track_view(text, text),
  public.track_message(text, text, text),
  public.purge_expired_reports()
to service_role;

grant execute on function
  public.reviewer_list_reports(),
  public.reviewer_open_report(text),
  public.reviewer_set_status(text, text),
  public.reviewer_reply(text, text),
  public.reviewer_add_note(text, text),
  public.reviewer_set_referral(text, text, boolean),
  public.reviewer_delete_report(text),
  public.reviewer_stats(),
  public.reviewer_audit_log(integer)
to authenticated;

-- Retention job. Enable the pg_cron extension in the Supabase dashboard, then run once:
--   select cron.schedule('purge-expired-reports', '17 8 * * *', 'select public.purge_expired_reports()');
