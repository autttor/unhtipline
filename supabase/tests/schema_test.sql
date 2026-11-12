-- Behavioural tests for the schema after 0001 + 0002. Run with supabase/tests/run_local.sh.
-- Every check raises on failure, so a clean run that prints "ALL SCHEMA TESTS PASSED" means success.
-- All data here is fictional. Checks that read tables directly run as the owner (reset role), because no
-- API role can read them; that is itself one of the things being tested.
\set ON_ERROR_STOP on

create function pg_temp.expect_denied(p_sql text, p_label text, p_expect text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_expect is not null and sqlerrm not like '%' || p_expect || '%' then
      raise exception 'FAIL: % was denied for the wrong reason: %', p_label, sqlerrm;
    end if;
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

-- Sign in as a staff member (or anyone) for the statements that follow.
create function pg_temp.login(p_user text, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000' || p_user, 'aal', p_aal)::text, false);
end $$;

create function pg_temp.item(p_list jsonb, p_id text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_list) e where e ->> 'id' = p_id;
$$;

-- ---- the upgrade kept earlier data ---------------------------------------------------------------
select pg_temp.check((select count(*) from private.reports) = 2, 'both earlier reports survived the upgrade');
select pg_temp.check((select status::text from private.reports where public_id = 'PR-1043') = 'in_review', 'under_review became in_review');
select pg_temp.check((select status::text from private.reports where public_id = 'PR-1044') = 'new', 'received became new');
select pg_temp.check((select help = 'advocate' and advocacy_requested and contact_requested and deadline = 'before March 3' and categories = '{housing}'
  from private.reports where public_id = 'PR-1043'), 'earlier report was mapped to request type, advocacy flag and deadline');
select pg_temp.check((select help = 'report' and not advocacy_requested and not contact_requested from private.reports where public_id = 'PR-1044'), 'earlier document-only report mapped to an incident report');
select pg_temp.check((select role = 'reviewer' and active and email = 'old.reviewer@example.org' from private.staff where display_name = 'Old Reviewer'), 'earlier reviewer became staff');
select pg_temp.check((select not active from private.staff where display_name = 'Former Reviewer'), 'a deactivated reviewer stayed deactivated');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.org'),
  ('00000000-0000-0000-0000-000000000002', 'reviewer@example.org'),
  ('00000000-0000-0000-0000-000000000003', 'advocate@example.org'),
  ('00000000-0000-0000-0000-000000000004', 'second.reviewer@example.org'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.org'),
  ('00000000-0000-0000-0000-000000000006', 'second.admin@example.org');
insert into private.staff (user_id, email, display_name, role) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.org', 'Ada Admin', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'reviewer@example.org', 'Riley Reviewer', 'reviewer'),
  ('00000000-0000-0000-0000-000000000003', 'advocate@example.org', 'Avery Advocate', 'advocate'),
  ('00000000-0000-0000-0000-000000000004', 'second.reviewer@example.org', 'Sam Second', 'reviewer'),
  ('00000000-0000-0000-0000-000000000006', 'second.admin@example.org', 'Blake Admin', 'admin');

-- ---- submission, idempotency and the outbox ------------------------------------------------------
set role service_role;

select pg_temp.check(public.submit_report(repeat('1', 64),
  '{"version":3,"safe":"yes","help":"report","narrative":"fictional incident text","categories":["housing","online"],"where":{"value":"residence"},"wants":["document"],"contact_want":"no","external_contact":"no"}',
  'bucket-1', array['reviewers@example.org', 'Second@Example.org ']) @> '{"id":"PR-1045","duplicate":false}', 'a new report gets PR-1045');
reset role;
select pg_temp.check((select count(*) from private.outbox o join private.reports r on r.id = o.report_id where r.public_id = 'PR-1045') = 2, 'one outbox row per recipient');
set role service_role;
reset role;
select pg_temp.check((select bool_and(status = 'queued' and recipient = lower(recipient) and recipient = trim(recipient)) from private.outbox), 'outbox rows start queued with tidy addresses');
set role service_role;

select pg_temp.check(public.submit_report(repeat('1', 64), '{"version":3,"help":"report","narrative":"changed"}', 'bucket-1', array['reviewers@example.org'])
  @> '{"id":"PR-1045","duplicate":true}', 'the same request again returns the same report');
reset role;
select pg_temp.check((select count(*) from private.reports) = 3, 'no second report was created');
set role service_role;
reset role;
select pg_temp.check((select count(*) from private.outbox) = 2, 'no extra notification was queued');
set role service_role;
reset role;
select pg_temp.check((select report ->> 'narrative' from private.reports where public_id = 'PR-1045') = 'fictional incident text', 'the stored report was not overwritten');
set role service_role;

select pg_temp.check(public.submit_report(repeat('2', 64),
  '{"version":3,"safe":"unsure","help":"advocate","narrative":"fictional advocacy request","deadline":{"value":"other","text":"hearing on the 14th"},"contact_want":"yes","contact_email":"student@example.com","external_contact":"no"}',
  'bucket-1', array['reviewers@example.org']) ->> 'id' = 'PR-1046', 'advocacy request stored');
reset role;
select pg_temp.check((select help = 'advocate' and advocacy_requested and safety_flag and contact_requested and deadline = 'hearing on the 14th'
  from private.reports where public_id = 'PR-1046'), 'advocacy, safety and contact flags and the deadline are derived on the server');
set role service_role;
reset role;
select pg_temp.check((select not advocacy_requested and not safety_flag and categories = '{housing,online}' from private.reports where public_id = 'PR-1045'), 'an incident report is not flagged for advocacy or safety');
set role service_role;
select pg_temp.check((public.submit_report(repeat('3', 64), '{"version":3,"safe":"yes","help":"report","wants":["advocacy"],"categories":["safety"],"contact_want":"no"}', 'bucket-1', '{}')) ? 'id', 'a report with no recipients configured is still stored');
reset role;
select pg_temp.check((select advocacy_requested and safety_flag from private.reports where public_id = 'PR-1047'), 'asking for advocacy inside a report, or choosing the safety category, sets the flags');
set role service_role;
reset role;
select pg_temp.check((select count(*) from private.outbox o join private.reports r on r.id = o.report_id where r.public_id = 'PR-1047') = 0, 'no recipients means no outbox rows');
set role service_role;

select public.submit_report(repeat('4', 64), '{"version":3,"safe":"yes","help":"peer","contact_want":"no"}', 'bucket-1', '{}');
select public.submit_report(repeat('5', 64), '{"version":3,"safe":"yes","help":"info","contact_want":"no"}', 'bucket-1', '{}');
select pg_temp.check(public.submit_report(repeat('6', 64), '{"version":3,"safe":"yes","help":"other","contact_want":"no"}', 'bucket-1', '{}') ->> 'error' = 'rate_limited', 'sixth submission in an hour from one bucket is rate limited');
select pg_temp.check(public.submit_report(repeat('1', 64), '{"version":3}', 'bucket-1', '{}') ->> 'duplicate' = 'true', 'a retry of an accepted report is not blocked by the rate limit');
select pg_temp.expect_denied($$select public.submit_report('short', '{"version":3,"help":"report"}', 'bucket-9', '{}')$$, 'malformed idempotency hash', 'idem_hash');

-- Dispatch: claim, send, fail, retry with backoff, give up.
select pg_temp.check(jsonb_array_length(public.outbox_claim(10)) = 3, 'three notifications are due');
select pg_temp.check(jsonb_array_length(public.outbox_claim(10)) = 0, 'claimed notifications are not handed out twice');
reset role;
select pg_temp.check((select bool_and(status = 'sending' and attempts = 1) from private.outbox), 'claimed rows are marked sending');
set role service_role;
select pg_temp.check((select bool_and(not (c ? 'report') or c -> 'report' = 'null') from jsonb_array_elements(
  (select public.outbox_claim(10, false))) c) is not false, 'claims carry no report content by default');
select pg_temp.check(public.outbox_mark(1, true, 'provider-id-1') = 'sent', 'mark sent');
reset role;
select pg_temp.check((select status = 'sent' and provider_message_id = 'provider-id-1' and sent_at is not null from private.outbox where id = 1), 'sent row records the provider id and time');
set role service_role;
select pg_temp.check(public.outbox_mark(1, false, null, 'late') = 'ignored', 'a late result for a finished row is ignored');
select pg_temp.check(public.outbox_mark(2, false, null, 'provider_error') = 'queued', 'a failed attempt goes back to the queue');
reset role;
select pg_temp.check((select status = 'queued' and error_category = 'provider_error' and next_attempt_at > now() + interval '1 minute' from private.outbox where id = 2), 'the retry waits (backoff)');
set role service_role;
select pg_temp.check(jsonb_array_length(public.outbox_claim(10)) = 0, 'a backed-off row is not due yet');
reset role;
update private.outbox set next_attempt_at = now() - interval '1 second', attempts = 5 where id = 2;
update private.outbox set last_attempt_at = now() - interval '11 minutes' where id = 3;
set role service_role;
select pg_temp.check(jsonb_array_length(public.outbox_claim(10)) = 2, 'a due retry and a stuck "sending" row are both handed out again');
select pg_temp.check(public.outbox_mark(2, false, null, 'auth') = 'failed', 'after the last attempt the row is marked failed');
reset role;
select pg_temp.check((select status = 'failed' and attempts = 6 and error_category = 'auth' from private.outbox where id = 2), 'failed row keeps its error category');
set role service_role;
select pg_temp.check(public.outbox_mark(3, true, 'provider-id-3') = 'sent', 'the recovered row is sent');
select pg_temp.check((select jsonb_array_length(public.outbox_claim(10, true)) = 0), 'nothing left to send');
reset role;
select pg_temp.check((select count(*) from private.reports) = 7, 'every accepted report is stored whatever happened to its email');
set role service_role;

select pg_temp.expect_denied('select count(*) from private.reports', 'service_role reading tables directly', 'permission denied');
select pg_temp.expect_denied('select public.staff_list_reports()', 'service_role calling a staff function', 'not_authorized');
reset role;

-- ---- the public internet --------------------------------------------------------------------------
set role anon;
select pg_temp.expect_denied('select * from private.reports', 'anon reading reports', 'permission denied');
select pg_temp.expect_denied('select * from private.outbox', 'anon reading the outbox', 'permission denied');
select pg_temp.expect_denied('select * from private.staff', 'anon reading staff', 'permission denied');
select pg_temp.expect_denied($$select public.submit_report(repeat('9', 64), '{}', 'x', '{}')$$, 'anon calling submit_report directly', 'permission denied');
select pg_temp.expect_denied('select public.outbox_claim(5)', 'anon claiming outbox rows', 'permission denied');
select pg_temp.expect_denied('select public.staff_me()', 'anon calling staff_me', 'permission denied');
select pg_temp.expect_denied('select public.staff_list_reports()', 'anon listing reports', 'permission denied');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1045')$$, 'anon opening a report', 'permission denied');
select pg_temp.expect_denied($$select public.admin_upsert_staff('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'x@example.org', 'X', 'admin')$$, 'anon adding staff', 'permission denied');
reset role;

-- ---- signed in, but not allowed ---------------------------------------------------------------------
set role authenticated;
select pg_temp.expect_denied('select * from private.reports', 'authenticated reading tables directly', 'permission denied');
select pg_temp.expect_denied('select public.outbox_claim(5)', 'authenticated claiming outbox rows', 'permission denied');

select pg_temp.login('05');
select pg_temp.check(public.staff_me() @> '{"is_staff":false}', 'a signed-in outsider is not staff');
select pg_temp.expect_denied('select public.staff_list_reports()', 'outsider listing reports', 'not_authorized');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1045')$$, 'outsider opening a report', 'not_authorized');
select pg_temp.expect_denied('select public.staff_team()', 'outsider listing staff', 'not_authorized');

select pg_temp.login('0b');
select pg_temp.expect_denied('select public.staff_list_reports()', 'deactivated staff listing reports', 'not_authorized');

select pg_temp.login('02', 'aal1');
select pg_temp.check(public.staff_me() @> '{"is_staff":true,"role":"reviewer","mfa_ok":false}', 'staff_me works before the second factor and says it is missing');
select pg_temp.expect_denied('select public.staff_list_reports()', 'reviewer without second factor listing reports', 'not_authorized');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1045')$$, 'reviewer without second factor opening a report', 'not_authorized');

-- ---- reviewer ----------------------------------------------------------------------------------------
select pg_temp.login('02');
select pg_temp.check(public.staff_me() @> '{"is_staff":true,"role":"reviewer","mfa_ok":true}', 'reviewer with second factor');
select pg_temp.check(jsonb_array_length(public.staff_list_reports()) = 7, 'reviewer sees seven cases in the queue');
select pg_temp.check(not (public.staff_list_reports() -> 0) ?| array['report', 'narrative'], 'the queue is metadata only');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1046') @> '{"advocacy_requested":true,"safety_flag":true,"can_open":false,"help":"advocate"}', 'reviewer sees the advocacy case flagged but cannot open it');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') @> '{"can_open":true,"mail":"failed","status":"new"}', 'queue shows a failed notification');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1046')$$, 'reviewer opening an unassigned advocacy case', 'not_permitted');
select pg_temp.expect_denied($$select public.staff_claim('PR-1046')$$, 'reviewer claiming an advocacy case', 'not_permitted');
select pg_temp.check(public.staff_open_report('PR-1045') -> 'report' ->> 'narrative' = 'fictional incident text', 'reviewer reads an unassigned incident report');
select pg_temp.check((public.staff_open_report('PR-1045') -> 'mail' -> 0 -> 'recipient') = 'null', 'reviewers do not see notification addresses');
select pg_temp.expect_denied($$select public.staff_set_status('PR-1045', 'closed')$$, 'changing status before claiming', 'claim_first');
select public.staff_add_note('PR-1045', 'triage note');
select public.staff_claim('PR-1045');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') @> '{"status":"in_review","assigned_name":"Riley Reviewer"}', 'claiming assigns the case and moves it to In review');
select pg_temp.expect_denied($$select public.staff_claim('PR-1045')$$, 'claiming a case twice', 'already_assigned');
select public.staff_set_status('PR-1045', 'awaiting_follow_up');
select public.staff_set_due('PR-1045', '2027-01-15');
select pg_temp.expect_denied($$select public.staff_set_status('PR-1045', 'guilty')$$, 'invalid status value', 'case_status');
select pg_temp.expect_denied($$select public.staff_log_contact('PR-1045', 'email', 'tried')$$, 'logging contact when the student said no', 'contact_not_requested');
select public.staff_log_disclosure('PR-1045', 'exported', 'printed for case meeting');
select pg_temp.expect_denied($$select public.staff_log_disclosure('PR-1045', 'leaked', 'x')$$, 'unknown disclosure kind', 'unknown_kind');
select pg_temp.expect_denied($$select public.staff_reply('PR-1045', 'hello')$$, 'replying when there is no reply channel', 'no_reply_channel');
select pg_temp.expect_denied($$select public.staff_open_report('PR-9999')$$, 'opening a report that does not exist', 'report_not_found');

-- admin-only actions
select pg_temp.expect_denied($$select public.staff_assign('PR-1045', '00000000-0000-0000-0000-000000000004')$$, 'reviewer assigning a case', 'admin_only');
select pg_temp.expect_denied($$select public.staff_set_restriction('PR-1045', '00000000-0000-0000-0000-000000000004', true)$$, 'reviewer restricting a case', 'admin_only');
select pg_temp.expect_denied($$select public.staff_delete_report('PR-1045')$$, 'reviewer deleting a case', 'admin_only');
select pg_temp.expect_denied($$select public.staff_admin_update('00000000-0000-0000-0000-000000000002', 'admin', true)$$, 'reviewer promoting themself', 'admin_only');
select pg_temp.expect_denied('select public.staff_audit_log(10)', 'reviewer reading the global audit log', 'admin_only');
select pg_temp.expect_denied('select public.staff_mail_queue()', 'reviewer reading the mail queue', 'admin_only');
select pg_temp.expect_denied('select public.staff_retry_notification(2)', 'reviewer retrying email', 'admin_only');
select pg_temp.check(not (public.staff_team() -> 0) ? 'email', 'reviewers see teammates without email addresses');

-- ---- a second reviewer cannot work on a claimed case --------------------------------------------------
select pg_temp.login('04');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') @> '{"can_open":false}', 'a claimed case is closed to other reviewers');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1045')$$, 'another reviewer opening a claimed case', 'not_permitted');
select pg_temp.expect_denied($$select public.staff_add_note('PR-1045', 'x')$$, 'another reviewer adding a note to a claimed case', 'not_permitted');

-- ---- advocate -----------------------------------------------------------------------------------------
select pg_temp.login('03');
select pg_temp.check(public.staff_open_report('PR-1046') -> 'report' ->> 'contact_email' = 'student@example.com', 'advocate opens the advocacy case');
select public.staff_claim('PR-1046');
select public.staff_log_contact('PR-1046', 'email', 'Sent a first message, no details in the subject.');
reset role;
select pg_temp.check((select follow_up_channel = 'email' and follow_up_attempted_at is not null from private.reports where public_id = 'PR-1046') is true, 'the contact attempt updated the follow-up fields');
set role authenticated;
select pg_temp.check(public.staff_open_report('PR-1046') @> '{"follow_up_channel":"email"}', 'the contact attempt is recorded on the case');
select pg_temp.check(public.staff_open_report('PR-1046') -> 'notes' -> 0 @> '{"kind":"contact_attempt","channel":"email","by":"Avery Advocate"}', 'the contact attempt appears in the notes with its author');

-- ---- admin ---------------------------------------------------------------------------------------------
select pg_temp.login('01');
select pg_temp.check((public.staff_team() -> 0) ? 'email', 'admins see staff email addresses');
select pg_temp.expect_denied($$select public.staff_assign('PR-1046', '00000000-0000-0000-0000-000000000002')$$, 'assigning an advocacy case to a plain reviewer', 'needs_advocate');
select public.staff_assign('PR-1045', '00000000-0000-0000-0000-000000000004');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') @> '{"assigned_name":"Sam Second"}', 'admin reassigns a case');
select pg_temp.expect_denied($$select public.staff_assign('PR-1045', '00000000-0000-0000-0000-00000000000b')$$, 'assigning to deactivated staff', 'unknown_staff');

-- Conflict of interest: restrict Sam from the case they hold.
select public.staff_set_restriction('PR-1045', '00000000-0000-0000-0000-000000000004', true);
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') @> '{"assigned_to":null}', 'restricting the assignee unassigns the case');
select pg_temp.expect_denied($$select public.staff_assign('PR-1045', '00000000-0000-0000-0000-000000000004')$$, 'assigning to a restricted reviewer', 'staff_restricted');
select pg_temp.login('04');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') is null, 'a restricted reviewer does not see the case in the queue');
select pg_temp.check(jsonb_array_length(public.staff_list_reports()) = 6, 'the restricted reviewer sees the other six');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1045')$$, 'restricted reviewer opening the case', 'report_not_found');
select pg_temp.expect_denied($$select public.staff_claim('PR-1045')$$, 'restricted reviewer claiming the case', 'report_not_found');

-- A restricted admin is shut out too, and cannot lift their own restriction.
select pg_temp.login('01');
select public.staff_set_restriction('PR-1047', '00000000-0000-0000-0000-000000000006', true);
select pg_temp.login('06');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1047')$$, 'restricted admin opening the case', 'report_not_found');
select pg_temp.expect_denied($$select public.staff_set_restriction('PR-1047', '00000000-0000-0000-0000-000000000006', false)$$, 'restricted admin lifting their own restriction', 'report_not_found');
select pg_temp.expect_denied($$select public.staff_delete_report('PR-1047')$$, 'restricted admin deleting the case', 'report_not_found');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.staff_mail_queue()) e where e ->> 'id' = 'PR-1047'), 'restricted admin does not see the case in the mail queue');

-- Email retry.
select pg_temp.login('01');
select pg_temp.check((select count(*) from jsonb_array_elements(public.staff_mail_queue()) e where e ->> 'status' = 'failed') = 1, 'admin sees one failed notification');
select public.staff_retry_notification(2);
select pg_temp.expect_denied('select public.staff_retry_notification(1)', 'retrying a notification that was already sent', 'not_retryable');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') @> '{"mail":"queued"}', 'retry puts the notification back in the queue');

-- Staff management and revocation.
select pg_temp.expect_denied($$select public.staff_admin_update('00000000-0000-0000-0000-000000000001', 'reviewer', true)$$, 'admin demoting themself', 'cannot_demote_self');
select pg_temp.expect_denied($$select public.staff_admin_update('00000000-0000-0000-0000-000000000001', 'admin', false)$$, 'admin removing their own access', 'cannot_demote_self');
select pg_temp.expect_denied($$select public.staff_admin_update('00000000-0000-0000-0000-000000000002', 'owner', true)$$, 'unknown role', 'staff_role_check');
select public.staff_admin_update('00000000-0000-0000-0000-000000000003', 'advocate', false);
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1046') @> '{"assigned_to":null}', 'removing access releases the open cases that person held');
select pg_temp.login('03');
select pg_temp.expect_denied('select public.staff_list_reports()', 'removed staff member listing reports with a still-valid session', 'not_authorized');
select pg_temp.expect_denied($$select public.staff_open_report('PR-1046')$$, 'removed staff member opening their former case', 'not_authorized');
select pg_temp.check(public.staff_me() @> '{"is_staff":false}', 'removed staff member is told they are not staff');

-- Earlier-version report: readable, with its tracking messages, and reply works on its own channel.
select pg_temp.login('01');
select pg_temp.check(public.staff_open_report('PR-1043') @> '{"legacy_contact_mode":"portal"}', 'admin opens an earlier-version report');
select pg_temp.check(public.staff_open_report('PR-1043') -> 'messages' -> 0 ->> 'body' = 'legacy student message', 'its student message is shown');
select public.staff_reply('PR-1043', 'A reply on the tracking page.');
reset role;
set role service_role;
select pg_temp.check(public.track_view(repeat('a', 64), 'b9') -> 'messages' -> 1 ->> 'body' = 'A reply on the tracking page.', 'a student with an earlier access code sees the reply');
select pg_temp.check(not public.track_view(repeat('a', 64), 'b9') ?| array['notes', 'log', 'assigned_to'], 'the student view has no internal fields');
reset role;

-- Audit trail.
set role authenticated;
select pg_temp.login('01');
select pg_temp.check((select count(*) from jsonb_array_elements(public.staff_audit_log(500)) e
  where e ->> 'action' in ('read', 'claimed', 'assigned', 'status', 'due_date', 'note', 'contact_attempt', 'exported', 'restricted', 'email_retry', 'staff_updated', 'replied')) >= 12, 'every kind of action is in the audit log');
select pg_temp.check((select count(distinct e ->> 'action') from jsonb_array_elements(public.staff_audit_log(500)) e) >= 12, 'at least twelve distinct actions were logged');
select pg_temp.check((public.staff_open_report('PR-1045') -> 'log' -> 0) ? 'by', 'case log entries name the actor');
select pg_temp.check(public.staff_audit_log(500)::text not like '%fictional incident text%', 'the audit log holds no report content');

-- Deletion and retention.
select public.staff_delete_report('PR-1045');
select pg_temp.check(pg_temp.item(public.staff_list_reports(), 'PR-1045') is null, 'deleted case is gone from the queue');
reset role;
reset request.jwt.claims;
select pg_temp.check((select count(*) from private.outbox o where not exists (select 1 from private.reports r where r.id = o.report_id)) = 0, 'outbox rows are deleted with their report');
select pg_temp.check((select count(*) from private.audit_log where public_id = 'PR-1045' and action = 'deleted') = 1, 'the deletion itself stays in the audit log');
update private.reports set delete_after = now() - interval '1 day' where public_id = 'PR-1044';
set role service_role;
select pg_temp.check(public.purge_expired_reports() = 1, 'retention purge removes exactly the expired report');

-- Adding staff through the service path.
select pg_temp.expect_denied($$select public.admin_upsert_staff('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'new@example.org', 'New Person', 'reviewer')$$, 'a non-admin actor adding staff', 'admin_only');
select public.admin_upsert_staff('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'New@Example.org', 'New Person', 'reviewer');
reset role;
select pg_temp.check((select email = 'new@example.org' and role = 'reviewer' and active from private.staff where display_name = 'New Person'), 'an invited person becomes active staff');

\echo ALL SCHEMA TESTS PASSED
