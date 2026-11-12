-- UNewHaven Pride Report: reviewer dashboard, roles, case assignment and the email outbox.
--
-- This is an UPGRADE of 0001_init.sql and keeps every existing report. It:
--   * replaces private.reviewers with private.staff (roles: admin, reviewer, advocate)
--   * renames case statuses to New / In review / Awaiting follow-up / Closed
--   * adds request type, advocacy and safety flags, assignment, due dates and access restrictions
--   * adds a durable email outbox (queued, sending, sent, failed) with bounded retries
--   * makes submission idempotent, so a retried request can never create a second report
--   * replaces the reviewer_* functions with staff_* functions that enforce the access policy below
--
-- ACCESS POLICY (enforced in private.can_open and the staff_* functions, never in the browser):
--   Everyone must be an active staff member signed in with a second factor (aal2).
--   Queue      every staff member sees case metadata, except cases they are restricted from.
--   Read       admins; the assignee; anyone while a case is unassigned, except that unassigned
--              advocacy cases can only be read by admins and advocates.
--   Claim      whoever may read an unassigned case may claim it. One assignee at a time.
--   Change     status, due date, contact log: the assignee or an admin.
--   Assign, restrict, delete, manage staff, retry email: admins only.
--   Restricted a staff member restricted from a case cannot see it at all, whatever their role,
--              and cannot lift their own restriction.

-- ---------------------------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------------------------

create table private.staff (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role         text not null default 'reviewer' check (role in ('admin', 'reviewer', 'advocate')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid
);
alter table private.staff enable row level security;

insert into private.staff (user_id, email, display_name, role, active, created_at)
select r.user_id, coalesce((select u.email from auth.users u where u.id = r.user_id), ''), r.display_name, 'reviewer', r.active, r.added_at
from private.reviewers r;

drop function public.reviewer_list_reports();
drop function public.reviewer_open_report(text);
drop function public.reviewer_set_status(text, text);
drop function public.reviewer_reply(text, text);
drop function public.reviewer_add_note(text, text);
drop function public.reviewer_set_referral(text, text, boolean);
drop function public.reviewer_delete_report(text);
drop function public.reviewer_stats();
drop function public.reviewer_audit_log(integer);
drop function private.require_reviewer();
drop function public.submit_report(text, jsonb, text);
drop table private.reviewers;

-- ---------------------------------------------------------------------------------------------
-- Reports: new statuses and triage columns
-- ---------------------------------------------------------------------------------------------

create type private.case_status as enum ('new', 'in_review', 'awaiting_follow_up', 'closed');

alter table private.reports alter column status drop default;
alter table private.reports alter column status type private.case_status using (
  case status::text
    when 'received' then 'new'
    when 'under_review' then 'in_review'
    when 'response_available' then 'awaiting_follow_up'
    else 'closed'
  end)::private.case_status;
alter table private.reports alter column status set default 'new';
drop type private.report_status;

-- Access codes and contact_mode belong to the earlier tracking design. They stay on old rows only.
alter table private.reports alter column access_code_hash drop not null;
alter table private.reports alter column contact_mode drop not null;

alter table private.reports
  add column idem_hash              text unique check (idem_hash ~ '^[0-9a-f]{64}$'),
  add column help                   text,
  add column advocacy_requested     boolean not null default false,
  add column safety_flag            boolean not null default false,
  add column contact_requested      boolean not null default false,
  add column deadline               text,
  add column categories             text[] not null default '{}',
  add column assigned_to            uuid references private.staff (user_id) on delete set null,
  add column assigned_at            timestamptz,
  add column due_on                 date,
  add column follow_up_attempted_at timestamptz,
  add column follow_up_channel      text,
  add column last_action_at         timestamptz;

-- Carry earlier (version 2) reports into the new triage columns.
update private.reports set
  help = case
    when report -> 'needs' ? 'advocate' then 'advocate'
    when report -> 'needs' ? 'office' then 'office'
    when report -> 'needs' ? 'support' then 'peer'
    else 'report' end,
  advocacy_requested = coalesce(report -> 'needs' ? 'advocate', false),
  contact_requested = coalesce(contact_mode in ('portal', 'identified'), false),
  deadline = case
    when report -> 'timing' ->> 'value' = 'other' then report -> 'timing' ->> 'text'
    when report -> 'timing' ->> 'value' in ('days', 'weeks') then report -> 'timing' ->> 'value'
    else null end,
  categories = case when category is null then '{}'::text[] else array[category] end
where help is null;

create index reports_status_idx on private.reports (status, created_at);
create index reports_assigned_idx on private.reports (assigned_to);

alter table private.report_notes
  add column kind text not null default 'note' check (kind in ('note', 'contact_attempt')),
  add column channel text check (channel is null or char_length(channel) <= 40);

alter table private.audit_log add column detail text;
create index audit_log_public_id_idx on private.audit_log (public_id, at desc);

-- A staff member listed here cannot see the case at all (conflict of interest).
create table private.report_restrictions (
  report_id  uuid not null references private.reports (id) on delete cascade,
  user_id    uuid not null references private.staff (user_id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);
alter table private.report_restrictions enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Email outbox
-- ---------------------------------------------------------------------------------------------

create type private.outbox_status as enum ('queued', 'sending', 'sent', 'failed');

create table private.outbox (
  id                  bigint generated always as identity primary key,
  report_id           uuid not null references private.reports (id) on delete cascade,
  kind                text not null default 'new_report',
  recipient           text not null check (char_length(recipient) between 3 and 254),
  status              private.outbox_status not null default 'queued',
  attempts            integer not null default 0,
  max_attempts        integer not null default 6,
  next_attempt_at     timestamptz not null default now(),
  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  error_category      text,
  created_at          timestamptz not null default now(),
  -- One notification of each kind per recipient per report, however often the request is repeated.
  unique (report_id, kind, recipient)
);
alter table private.outbox enable row level security;
create index outbox_due_idx on private.outbox (status, next_attempt_at);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------

-- Raises unless the caller is an active staff member who signed in with a second factor.
create function private.current_staff()
returns private.staff language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff private.staff;
begin
  select * into v_staff from private.staff s where s.user_id = auth.uid() and s.active;
  if not found or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_staff;
end $$;

create function private.require_admin()
returns private.staff language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
begin
  if v_staff.role <> 'admin' then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return v_staff;
end $$;

create function private.is_restricted(p_report_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.report_restrictions x where x.report_id = p_report_id and x.user_id = p_user_id);
$$;

create function private.can_open(p_staff private.staff, p_report private.reports)
returns boolean language sql stable security definer set search_path = '' as $$
  -- coalesce: comparing against an empty assignee must give a plain "no", never an unknown.
  select not private.is_restricted(p_report.id, p_staff.user_id)
     and coalesce(p_staff.role = 'admin'
          or p_report.assigned_to = p_staff.user_id
          or (p_report.assigned_to is null and (not p_report.advocacy_requested or p_staff.role = 'advocate')), false);
$$;

-- Finds a report the caller may read. A restricted or unknown case gives the same error.
create function private.open_for(p_staff private.staff, p_public_id text)
returns private.reports language plpgsql stable security definer set search_path = '' as $$
declare
  v_report private.reports;
begin
  select * into v_report from private.reports r where r.public_id = p_public_id;
  if not found or private.is_restricted(v_report.id, p_staff.user_id) then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if not private.can_open(p_staff, v_report) then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  return v_report;
end $$;

-- As open_for, and additionally requires the caller to be the assignee or an admin.
create function private.own_for(p_staff private.staff, p_public_id text)
returns private.reports language plpgsql stable security definer set search_path = '' as $$
declare
  v_report private.reports := private.open_for(p_staff, p_public_id);
begin
  if p_staff.role <> 'admin' and v_report.assigned_to is distinct from p_staff.user_id then
    raise exception 'claim_first' using errcode = '42501';
  end if;
  return v_report;
end $$;

create function private.log_action(p_actor uuid, p_action text, p_public_id text, p_detail text default null)
returns void language sql security definer set search_path = '' as $$
  insert into private.audit_log (actor, action, public_id, detail) values (p_actor, p_action, p_public_id, p_detail);
  update private.reports set last_action_at = now() where public_id = p_public_id and p_actor is not null;
$$;

create function private.staff_name(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.display_name from private.staff s where s.user_id = p_user_id;
$$;

-- Worst delivery state across a report's notifications: failed, then pending, then sent.
create function private.mail_state(p_report_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when count(*) = 0 then 'none'
    when count(*) filter (where o.status = 'failed') > 0 then 'failed'
    when count(*) filter (where o.status in ('queued', 'sending')) > 0 then 'queued'
    else 'sent' end
  from private.outbox o where o.report_id = p_report_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Submission and email dispatch (service_role only; called from the Edge Functions)
-- ---------------------------------------------------------------------------------------------

create function public.submit_report(p_idem_hash text, p_report jsonb, p_bucket text, p_recipients text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report private.reports;
  v_deadline text;
begin
  -- A repeated request (double click, retry after a timeout) returns the report already stored.
  select * into v_report from private.reports r where r.idem_hash = p_idem_hash;
  if found then
    return jsonb_build_object('id', v_report.public_id, 'received_at', v_report.created_at, 'duplicate', true);
  end if;

  if not private.rate_limit_ok(p_bucket, 'submit', 5) then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_deadline := case
    when p_report -> 'deadline' ->> 'value' = 'other' then p_report -> 'deadline' ->> 'text'
    when p_report -> 'deadline' ->> 'value' in ('days', 'weeks') then p_report -> 'deadline' ->> 'value'
    else null end;

  begin
    insert into private.reports (idem_hash, help, advocacy_requested, safety_flag, contact_requested, deadline, categories, category, location, report)
    values (
      p_idem_hash,
      p_report ->> 'help',
      coalesce(p_report ->> 'help' = 'advocate' or p_report -> 'wants' ? 'advocacy' or p_report -> 'next_steps' ? 'advocacy', false),
      coalesce(p_report ->> 'safe' in ('no', 'unsure') or p_report -> 'categories' ? 'safety', false),
      coalesce(p_report ->> 'contact_want' = 'yes', false),
      v_deadline,
      coalesce((select array_agg(c) from jsonb_array_elements_text(coalesce(p_report -> 'categories', '[]'::jsonb)) as c), '{}'),
      p_report -> 'categories' ->> 0,
      nullif(p_report -> 'where' ->> 'value', ''),
      p_report
    )
    returning * into v_report;
  exception when unique_violation then
    -- Two copies of the same request arrived together: the other one won.
    select * into v_report from private.reports r where r.idem_hash = p_idem_hash;
    return jsonb_build_object('id', v_report.public_id, 'received_at', v_report.created_at, 'duplicate', true);
  end;

  insert into private.outbox (report_id, recipient)
  select v_report.id, lower(trim(r)) from unnest(coalesce(p_recipients, '{}')) as r where trim(r) <> ''
  on conflict do nothing;

  return jsonb_build_object('id', v_report.public_id, 'received_at', v_report.created_at, 'duplicate', false);
end $$;

-- Hands out notifications that are due, marking them "sending". Rows stuck in "sending" for ten
-- minutes (a crashed worker) are handed out again. Safe to call from several workers at once.
create function public.outbox_claim(p_limit integer, p_include_details boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  with due as (
    select o.id from private.outbox o
    where (o.status = 'queued' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.last_attempt_at < now() - interval '10 minutes')
    order by o.next_attempt_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  ), claimed as (
    update private.outbox o set status = 'sending', attempts = o.attempts + 1, last_attempt_at = now()
    from due where o.id = due.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'outbox_id', c.id, 'recipient', c.recipient, 'kind', c.kind, 'attempt', c.attempts,
    'id', r.public_id, 'received_at', r.created_at, 'help', r.help,
    'advocacy_requested', r.advocacy_requested, 'safety_flag', r.safety_flag,
    'has_deadline', r.deadline is not null, 'contact_requested', r.contact_requested,
    'report', case when p_include_details then r.report end
  )), '[]'::jsonb) into v_result
  from claimed c join private.reports r on r.id = c.report_id;
  return v_result;
end $$;

create function public.outbox_mark(p_outbox_id bigint, p_ok boolean, p_provider_message_id text default null, p_error_category text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_row private.outbox;
begin
  select * into v_row from private.outbox o where o.id = p_outbox_id for update;
  if not found or v_row.status <> 'sending' then
    return 'ignored';
  end if;
  if p_ok then
    update private.outbox set status = 'sent', sent_at = now(), provider_message_id = left(p_provider_message_id, 200), error_category = null
    where id = p_outbox_id;
    return 'sent';
  end if;
  if v_row.attempts >= v_row.max_attempts then
    update private.outbox set status = 'failed', error_category = left(coalesce(p_error_category, 'unknown'), 40) where id = p_outbox_id;
    return 'failed';
  end if;
  -- Back off: 2, 4, 8, 16, 32 minutes.
  update private.outbox set status = 'queued', error_category = left(coalesce(p_error_category, 'unknown'), 40),
    next_attempt_at = now() + make_interval(mins => least(power(2, v_row.attempts)::integer, 60))
  where id = p_outbox_id;
  return 'queued';
end $$;

-- Called by the admin-users Edge Function after it has created or invited the sign-in account.
create function public.admin_upsert_staff(p_actor uuid, p_user_id uuid, p_email text, p_display_name text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.staff s where s.user_id = p_actor and s.active and s.role = 'admin') then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  insert into private.staff (user_id, email, display_name, role, created_by)
  values (p_user_id, lower(p_email), p_display_name, p_role, p_actor)
  on conflict (user_id) do update set email = excluded.email, display_name = excluded.display_name, role = excluded.role, active = true;
  perform private.log_action(p_actor, 'staff_invited', null, p_display_name || ' as ' || p_role);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff functions
-- ---------------------------------------------------------------------------------------------

-- The one function that works before the second factor: it tells the dashboard what to ask for next.
create function public.staff_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_staff', s.user_id is not null,
    'role', s.role, 'display_name', s.display_name, 'user_id', auth.uid(),
    'mfa_ok', coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  from (select 1) one left join private.staff s on s.user_id = auth.uid() and s.active;
$$;

create function public.staff_list_reports()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
begin
  -- Metadata only. Reading the content goes through staff_open_report, which is logged.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.public_id, 'received_at', r.created_at, 'status', r.status, 'help', r.help,
      'categories', to_jsonb(r.categories), 'deadline', r.deadline, 'due_on', r.due_on,
      'advocacy_requested', r.advocacy_requested, 'safety_flag', r.safety_flag,
      'contact_requested', r.contact_requested,
      'assigned_to', r.assigned_to, 'assigned_name', private.staff_name(r.assigned_to),
      'can_open', private.can_open(v_staff, r),
      'mail', private.mail_state(r.id),
      'follow_up_attempted_at', r.follow_up_attempted_at, 'last_action_at', r.last_action_at
    ) order by r.created_at)
    from private.reports r
    where not private.is_restricted(r.id, v_staff.user_id)), '[]'::jsonb);
end $$;

create function public.staff_open_report(p_public_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.open_for(v_staff, p_public_id);
begin
  perform private.log_action(v_staff.user_id, 'read', p_public_id);
  return jsonb_build_object(
    'id', v_report.public_id, 'received_at', v_report.created_at, 'status', v_report.status, 'help', v_report.help,
    'categories', to_jsonb(v_report.categories), 'deadline', v_report.deadline, 'due_on', v_report.due_on,
    'advocacy_requested', v_report.advocacy_requested, 'safety_flag', v_report.safety_flag,
    'contact_requested', v_report.contact_requested,
    'assigned_to', v_report.assigned_to, 'assigned_name', private.staff_name(v_report.assigned_to),
    'follow_up_attempted_at', v_report.follow_up_attempted_at, 'follow_up_channel', v_report.follow_up_channel,
    'delete_after', v_report.delete_after,
    'report', v_report.report,
    'legacy_contact_mode', v_report.contact_mode,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('body', n.body, 'kind', n.kind, 'channel', n.channel, 'created_at', n.created_at,
        'by', private.staff_name(n.author)) order by n.created_at, n.id)
      from private.report_notes n where n.report_id = v_report.id), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from private.report_messages m where m.report_id = v_report.id), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'detail', a.detail,
        'by', coalesce(private.staff_name(a.actor), 'System')) order by a.at desc, a.id desc)
      from private.audit_log a where a.public_id = p_public_id), '[]'::jsonb),
    'mail', coalesce((
      select jsonb_agg(jsonb_build_object('outbox_id', o.id, 'status', o.status, 'attempts', o.attempts,
        'last_attempt_at', o.last_attempt_at, 'sent_at', o.sent_at, 'error_category', o.error_category,
        'recipient', case when v_staff.role = 'admin' then o.recipient end) order by o.id)
      from private.outbox o where o.report_id = v_report.id), '[]'::jsonb),
    'restricted', case when v_staff.role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', private.staff_name(x.user_id)))
      from private.report_restrictions x where x.report_id = v_report.id), '[]'::jsonb) end
  );
end $$;

create function public.staff_claim(p_public_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.open_for(v_staff, p_public_id);
  v_rows integer;
begin
  update private.reports set assigned_to = v_staff.user_id, assigned_at = now(),
    status = case when status = 'new' then 'in_review'::private.case_status else status end
  where id = v_report.id and assigned_to is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'already_assigned';
  end if;
  perform private.log_action(v_staff.user_id, 'claimed', p_public_id);
end $$;

-- p_user_id null unassigns.
create function public.staff_assign(p_public_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
  v_report private.reports := private.open_for(v_admin, p_public_id);
  v_target private.staff;
begin
  if p_user_id is null then
    update private.reports set assigned_to = null, assigned_at = null where id = v_report.id;
    perform private.log_action(v_admin.user_id, 'unassigned', p_public_id);
    return;
  end if;
  select * into v_target from private.staff s where s.user_id = p_user_id and s.active;
  if not found then
    raise exception 'unknown_staff';
  end if;
  if private.is_restricted(v_report.id, p_user_id) then
    raise exception 'staff_restricted';
  end if;
  if v_report.advocacy_requested and v_target.role = 'reviewer' then
    raise exception 'needs_advocate';
  end if;
  update private.reports set assigned_to = p_user_id, assigned_at = now(),
    status = case when status = 'new' then 'in_review'::private.case_status else status end
  where id = v_report.id;
  perform private.log_action(v_admin.user_id, 'assigned', p_public_id, v_target.display_name);
end $$;

create function public.staff_set_status(p_public_id text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.own_for(v_staff, p_public_id);
begin
  update private.reports set status = p_status::private.case_status where id = v_report.id;
  perform private.log_action(v_staff.user_id, 'status', p_public_id, p_status);
end $$;

create function public.staff_set_due(p_public_id text, p_due_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.own_for(v_staff, p_public_id);
begin
  update private.reports set due_on = p_due_on where id = v_report.id;
  perform private.log_action(v_staff.user_id, 'due_date', p_public_id, coalesce(p_due_on::text, 'cleared'));
end $$;

create function public.staff_add_note(p_public_id text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.open_for(v_staff, p_public_id);
begin
  insert into private.report_notes (report_id, author, body) values (v_report.id, v_staff.user_id, p_body);
  perform private.log_action(v_staff.user_id, 'note', p_public_id);
end $$;

-- Records that a reviewer tried to reach the student outside this system. Nothing is sent from here,
-- and it is refused when the student said they did not want to be contacted.
create function public.staff_log_contact(p_public_id text, p_channel text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.own_for(v_staff, p_public_id);
begin
  if not v_report.contact_requested then
    raise exception 'contact_not_requested';
  end if;
  insert into private.report_notes (report_id, author, body, kind, channel)
  values (v_report.id, v_staff.user_id, p_note, 'contact_attempt', p_channel);
  update private.reports set follow_up_attempted_at = now(), follow_up_channel = p_channel where id = v_report.id;
  perform private.log_action(v_staff.user_id, 'contact_attempt', p_public_id, p_channel);
end $$;

-- Records that a case was printed, exported or shared outside the dashboard.
create function public.staff_log_disclosure(p_public_id text, p_kind text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.open_for(v_staff, p_public_id);
begin
  if p_kind not in ('exported', 'shared') then
    raise exception 'unknown_kind';
  end if;
  perform private.log_action(v_staff.user_id, p_kind, p_public_id, left(p_detail, 300));
end $$;

-- Reply on the earlier tracking channel. Only for reports whose student chose that channel.
create function public.staff_reply(p_public_id text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
  v_report private.reports := private.own_for(v_staff, p_public_id);
begin
  if coalesce(v_report.contact_mode, 'anonymous') not in ('portal', 'identified') then
    raise exception 'no_reply_channel';
  end if;
  if v_report.status = 'closed' then
    raise exception 'closed';
  end if;
  insert into private.report_messages (report_id, sender, author, body) values (v_report.id, 'reviewer', v_staff.user_id, p_body);
  update private.reports set status = 'awaiting_follow_up' where id = v_report.id;
  perform private.log_action(v_staff.user_id, 'replied', p_public_id);
end $$;

create function public.staff_set_restriction(p_public_id text, p_user_id uuid, p_restricted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
  v_report private.reports := private.open_for(v_admin, p_public_id);
begin
  if not exists (select 1 from private.staff s where s.user_id = p_user_id) then
    raise exception 'unknown_staff';
  end if;
  if p_restricted then
    insert into private.report_restrictions (report_id, user_id, created_by) values (v_report.id, p_user_id, v_admin.user_id)
    on conflict do nothing;
    update private.reports set assigned_to = null, assigned_at = null where id = v_report.id and assigned_to = p_user_id;
    perform private.log_action(v_admin.user_id, 'restricted', p_public_id, private.staff_name(p_user_id));
  else
    -- open_for above already refuses a restricted admin, so nobody can lift their own restriction.
    delete from private.report_restrictions where report_id = v_report.id and user_id = p_user_id;
    perform private.log_action(v_admin.user_id, 'restriction_lifted', p_public_id, private.staff_name(p_user_id));
  end if;
end $$;

create function public.staff_delete_report(p_public_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
  v_report private.reports := private.open_for(v_admin, p_public_id);
begin
  delete from private.reports where id = v_report.id;
  insert into private.audit_log (actor, action, public_id) values (v_admin.user_id, 'deleted', p_public_id);
end $$;

create function public.staff_team()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff private.staff := private.current_staff();
begin
  return coalesce((
    select jsonb_agg(case when v_staff.role = 'admin'
      then jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name, 'role', s.role, 'active', s.active, 'email', s.email, 'created_at', s.created_at)
      else jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name, 'role', s.role, 'active', s.active) end
      order by s.active desc, s.display_name)
    from private.staff s where v_staff.role = 'admin' or s.active), '[]'::jsonb);
end $$;

-- Change a staff member's role or switch their access off. Takes effect on their very next request.
create function public.staff_admin_update(p_user_id uuid, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
  v_target private.staff;
begin
  select * into v_target from private.staff s where s.user_id = p_user_id for update;
  if not found then
    raise exception 'unknown_staff';
  end if;
  if p_user_id = v_admin.user_id and (not p_active or p_role <> 'admin') then
    raise exception 'cannot_demote_self';
  end if;
  update private.staff set role = p_role, active = p_active where user_id = p_user_id;
  if not p_active then
    update private.reports set assigned_to = null, assigned_at = null where assigned_to = p_user_id and status <> 'closed';
  end if;
  perform private.log_action(v_admin.user_id, 'staff_updated', null,
    v_target.display_name || ': ' || p_role || case when p_active then ', active' else ', access removed' end);
end $$;

create function public.staff_mail_queue()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('outbox_id', o.id, 'id', r.public_id, 'recipient', o.recipient, 'status', o.status,
      'attempts', o.attempts, 'max_attempts', o.max_attempts, 'last_attempt_at', o.last_attempt_at,
      'next_attempt_at', o.next_attempt_at, 'sent_at', o.sent_at, 'error_category', o.error_category) order by o.id desc)
    from (select * from private.outbox order by id desc limit 200) o
    join private.reports r on r.id = o.report_id
    where not private.is_restricted(r.id, v_admin.user_id)), '[]'::jsonb);
end $$;

create function public.staff_retry_notification(p_outbox_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
  v_public_id text;
begin
  update private.outbox o set status = 'queued', attempts = 0, next_attempt_at = now(), error_category = null
  from private.reports r
  where o.id = p_outbox_id and r.id = o.report_id and o.status in ('failed', 'queued')
  returning r.public_id into v_public_id;
  if v_public_id is null then
    raise exception 'not_retryable';
  end if;
  perform private.log_action(v_admin.user_id, 'email_retry', v_public_id);
end $$;

create function public.staff_audit_log(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin private.staff := private.require_admin();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e.at desc, e.id desc)
    from (
      select a.id, a.at, a.action, a.public_id, a.detail, coalesce(private.staff_name(a.actor), 'System') as actor
      from private.audit_log a order by a.at desc, a.id desc limit least(greatest(p_limit, 1), 1000)
    ) e), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on all tables    in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function
  public.submit_report(text, jsonb, text, text[]),
  public.outbox_claim(integer, boolean),
  public.outbox_mark(bigint, boolean, text, text),
  public.admin_upsert_staff(uuid, uuid, text, text, text),
  public.staff_me(),
  public.staff_list_reports(),
  public.staff_open_report(text),
  public.staff_claim(text),
  public.staff_assign(text, uuid),
  public.staff_set_status(text, text),
  public.staff_set_due(text, date),
  public.staff_add_note(text, text),
  public.staff_log_contact(text, text, text),
  public.staff_log_disclosure(text, text, text),
  public.staff_reply(text, text),
  public.staff_set_restriction(text, uuid, boolean),
  public.staff_delete_report(text),
  public.staff_team(),
  public.staff_admin_update(uuid, text, boolean),
  public.staff_mail_queue(),
  public.staff_retry_notification(bigint),
  public.staff_audit_log(integer)
from public, anon, authenticated;

grant execute on function
  public.submit_report(text, jsonb, text, text[]),
  public.outbox_claim(integer, boolean),
  public.outbox_mark(bigint, boolean, text, text),
  public.admin_upsert_staff(uuid, uuid, text, text, text)
to service_role;

grant execute on function
  public.staff_me(),
  public.staff_list_reports(),
  public.staff_open_report(text),
  public.staff_claim(text),
  public.staff_assign(text, uuid),
  public.staff_set_status(text, text),
  public.staff_set_due(text, date),
  public.staff_add_note(text, text),
  public.staff_log_contact(text, text, text),
  public.staff_log_disclosure(text, text, text),
  public.staff_reply(text, text),
  public.staff_set_restriction(text, uuid, boolean),
  public.staff_delete_report(text),
  public.staff_team(),
  public.staff_admin_update(uuid, text, boolean),
  public.staff_mail_queue(),
  public.staff_retry_notification(bigint),
  public.staff_audit_log(integer)
to authenticated;

-- FIRST ADMIN. Create the person's sign-in account in the Supabase dashboard (Authentication,
-- Users, Add user), then run this once in the SQL editor with their details:
--
--   insert into private.staff (user_id, email, display_name, role)
--   select id, email, 'Their Name', 'admin' from auth.users where email = 'them@example.org';
--
-- Every later account is invited from the dashboard's Team tab.
