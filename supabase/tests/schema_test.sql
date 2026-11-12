-- Behavioural tests for 0001_init.sql. Run with supabase/tests/run_local.sh.
-- Every check raises on failure, so a clean run that prints "ALL SCHEMA TESTS PASSED" means success.
\set ON_ERROR_STOP on

create function pg_temp.expect_denied(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok   denied: %  (%)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % was allowed', p_label;
end $$;

create function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok   %', p_label;
end $$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- active reviewer
  ('00000000-0000-0000-0000-000000000002'),  -- signed-in non-reviewer
  ('00000000-0000-0000-0000-000000000003');  -- deactivated reviewer
insert into private.reviewers (user_id, display_name, active) values
  ('00000000-0000-0000-0000-000000000001', 'Test Reviewer', true),
  ('00000000-0000-0000-0000-000000000003', 'Former Reviewer', false);

-- ---- service_role: the Edge Function path -------------------------------------------------------
set role service_role;

select pg_temp.check(
  public.submit_report(repeat('a', 64),
    '{"version":1,"path":"incident","category":{"value":"housing"},"where":{"value":"residence"},"what":"fictional","wants":["reply"],"contact_mode":"portal"}',
    'bucket-1') ->> 'id' = 'PR-1043', 'first report gets PR-1043');
select pg_temp.check(
  public.submit_report(repeat('b', 64),
    '{"version":1,"path":"concern","category":{"value":"other","text":"own words"},"wants":[],"contact_mode":"anonymous"}',
    'bucket-1') ->> 'id' = 'PR-1044', 'second report gets PR-1044');

select pg_temp.check(public.track_view(repeat('a', 64), 'bucket-2') ->> 'status' = 'received', 'student can view by code hash');
select pg_temp.check(public.track_view(repeat('a', 64), 'bucket-2') -> 'report' ->> 'what' = 'fictional', 'student view returns their own text');
select pg_temp.check(public.track_view(repeat('c', 64), 'bucket-2') ->> 'error' = 'not_found', 'unknown code hash is not_found');
select pg_temp.check(jsonb_array_length(public.track_message(repeat('a', 64), 'more detail', 'bucket-2') -> 'messages') = 1, 'portal report accepts a student message');
select pg_temp.check(public.track_message(repeat('b', 64), 'hello', 'bucket-2') ->> 'error' = 'messaging_disabled', 'anonymous report refuses messages');
select pg_temp.expect_denied($$select public.submit_report('short', '{"contact_mode":"portal"}', 'bucket-3')$$, 'malformed code hash');
select pg_temp.expect_denied($$select public.submit_report(repeat('d', 64), '{"contact_mode":"nonsense"}', 'bucket-3')$$, 'invalid contact_mode');
select pg_temp.expect_denied($$select public.submit_report(repeat('a', 64), '{"contact_mode":"portal"}', 'bucket-3')$$, 'duplicate code hash');

-- Rate limit: bucket-1 has used 2 of 5 submissions this hour.
select public.submit_report(repeat('e', 64), '{"contact_mode":"anonymous","category":{"value":"housing"}}', 'bucket-1');
select public.submit_report(repeat('f', 64), '{"contact_mode":"anonymous","category":{"value":"housing"}}', 'bucket-1');
select public.submit_report(repeat('0', 64), '{"contact_mode":"anonymous","category":{"value":"housing"}}', 'bucket-1');
select pg_temp.check(public.submit_report(repeat('1', 64), '{"contact_mode":"anonymous"}', 'bucket-1') ->> 'error' = 'rate_limited', 'sixth submission in an hour is rate limited');
select pg_temp.check(public.submit_report(repeat('1', 64), '{"contact_mode":"anonymous","category":{"value":"housing"}}', 'other-bucket') ? 'id', 'a different bucket is unaffected');
select public.submit_report(repeat('2', 64), '{"contact_mode":"anonymous","category":{"value":"housing"}}', 'other-bucket');

select pg_temp.expect_denied('select count(*) from private.reports', 'service_role reading tables directly (no schema usage)');
select pg_temp.expect_denied('select public.reviewer_list_reports()', 'service_role calling a reviewer function');
reset role;

-- ---- anon: the public internet ------------------------------------------------------------------
set role anon;
select pg_temp.expect_denied('select * from private.reports', 'anon reading reports');
select pg_temp.expect_denied('select * from private.audit_log', 'anon reading audit log');
select pg_temp.expect_denied($$select public.submit_report(repeat('9', 64), '{"contact_mode":"anonymous"}', 'x')$$, 'anon calling submit_report directly');
select pg_temp.expect_denied($$select public.track_view(repeat('a', 64), 'x')$$, 'anon calling track_view directly');
select pg_temp.expect_denied('select public.reviewer_list_reports()', 'anon calling reviewer_list_reports');
select pg_temp.expect_denied('select public.purge_expired_reports()', 'anon calling purge');
select pg_temp.expect_denied('select private.rate_limit_ok(''x'', ''y'', 1)', 'anon calling a private helper');
reset role;

-- ---- authenticated, but not allowed -------------------------------------------------------------
set role authenticated;
select pg_temp.expect_denied('select * from private.reports', 'authenticated reading tables directly');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}';
select pg_temp.expect_denied('select public.reviewer_list_reports()', 'signed-in non-reviewer');
select pg_temp.expect_denied($$select public.reviewer_open_report('PR-1043')$$, 'signed-in non-reviewer opening a report');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","aal":"aal2"}';
select pg_temp.expect_denied('select public.reviewer_list_reports()', 'deactivated reviewer');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","aal":"aal1"}';
select pg_temp.expect_denied('select public.reviewer_list_reports()', 'reviewer without second factor (aal1)');
select pg_temp.expect_denied($$select public.reviewer_open_report('PR-1043')$$, 'reviewer without second factor opening a report');
select pg_temp.expect_denied($$select public.submit_report(repeat('9', 64), '{"contact_mode":"anonymous"}', 'x')$$, 'authenticated calling submit_report directly');

-- ---- authenticated reviewer with MFA ------------------------------------------------------------
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}';

select pg_temp.check(jsonb_array_length(public.reviewer_list_reports()) = 7, 'reviewer lists 7 reports');
select pg_temp.check(not (public.reviewer_list_reports() -> 0) ? 'report', 'list is metadata only (no report content)');
select pg_temp.check((select bool_or((e ->> 'awaiting_reply')::boolean) from jsonb_array_elements(public.reviewer_list_reports()) e where e ->> 'id' = 'PR-1043'), 'PR-1043 is awaiting a reply');
select pg_temp.check(public.reviewer_open_report('PR-1043') ->> 'status' = 'under_review', 'opening moves received -> under_review');
select pg_temp.check(public.reviewer_open_report('PR-1043') -> 'report' ->> 'what' = 'fictional', 'opening returns the content');
select public.reviewer_reply('PR-1043', 'Here are some options.');
select public.reviewer_add_note('PR-1043', 'internal only');
select public.reviewer_set_referral('PR-1043', 'myatt', true);
select public.reviewer_set_referral('PR-1043', 'myatt', true);
select pg_temp.check(public.reviewer_open_report('PR-1043') -> 'referrals' = '["myatt"]', 'referral recorded once');
select pg_temp.check(public.reviewer_open_report('PR-1043') -> 'notes' -> 0 ->> 'by' = 'Test Reviewer', 'note carries reviewer display name');
select pg_temp.expect_denied($$select public.reviewer_reply('PR-1044', 'hi')$$, 'reply to an anonymous report');
select pg_temp.expect_denied($$select public.reviewer_set_status('PR-1043', 'guilty')$$, 'invalid status value');
select pg_temp.expect_denied($$select public.reviewer_open_report('PR-9999')$$, 'opening a report that does not exist');

select pg_temp.check((select e -> 'count' = '6' from jsonb_array_elements(public.reviewer_stats() -> 'by_category') e where e ->> 'key' = 'housing'), 'stats show a group of 6');
select pg_temp.check((select e -> 'count' = 'null' from jsonb_array_elements(public.reviewer_stats() -> 'by_category') e where e ->> 'key' = 'other'), 'stats suppress a group of 1');
reset role;
reset request.jwt.claims;

-- ---- student sees the reply; internal notes never leak ------------------------------------------
set role service_role;
select pg_temp.check(public.track_view(repeat('a', 64), 'bucket-4') ->> 'status' = 'response_available', 'student sees response_available');
select pg_temp.check(public.track_view(repeat('a', 64), 'bucket-4') -> 'messages' -> 1 ->> 'body' = 'Here are some options.', 'student sees the reviewer reply');
select pg_temp.check(not public.track_view(repeat('a', 64), 'bucket-4') ? 'notes', 'student view has no notes key');
select pg_temp.check(public.track_view(repeat('a', 64), 'bucket-4')::text not like '%internal only%', 'internal note text is absent from the student view');
reset role;

-- ---- audit, deletion and retention --------------------------------------------------------------
select pg_temp.check((select count(*) from private.audit_log where action = 'opened_report' and public_id = 'PR-1043') = 4, 'each open was audited');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}';
select public.reviewer_set_status('PR-1043', 'closed');
select pg_temp.expect_denied($$select public.reviewer_reply('PR-1043', 'late')$$, 'reply to a closed report');
select public.reviewer_delete_report('PR-1043');
select pg_temp.check(public.reviewer_audit_log(5) -> 0 ->> 'action' = 'deleted_report', 'audit log shows the deletion');
reset role;
reset request.jwt.claims;

select pg_temp.check((select count(*) from private.reports where public_id = 'PR-1043') = 0, 'report row deleted');
select pg_temp.check((select count(*) from private.report_messages) = 0, 'messages cascade-deleted');
select pg_temp.check((select count(*) from private.report_notes) = 0, 'notes cascade-deleted');
select pg_temp.check((select count(*) from private.audit_log where public_id = 'PR-1043') > 0, 'audit entries survive deletion');

update private.reports set delete_after = now() - interval '1 day' where public_id = 'PR-1044';
set role service_role;
select pg_temp.check(public.purge_expired_reports() = 1, 'purge removes exactly the expired report');
reset role;
select pg_temp.check((select count(*) from private.audit_log where action = 'retention_deleted' and public_id = 'PR-1044') = 1, 'purge is audited');

-- Track lookups are rate limited too (30 per hour per bucket).
set role service_role;
select public.track_view(repeat('c', 64), 'guesser') from generate_series(1, 30);
select pg_temp.check(public.track_view(repeat('e', 64), 'guesser') ->> 'error' = 'rate_limited', '31st lookup in an hour is rate limited even for a valid code');
reset role;

\echo ALL SCHEMA TESTS PASSED
