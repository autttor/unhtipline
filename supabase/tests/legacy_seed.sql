-- Rows as the first version of the schema stored them (fictional). Applied between 0001 and 0002.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'old.reviewer@example.org'),
  ('00000000-0000-0000-0000-00000000000b', 'former.reviewer@example.org');
insert into private.reviewers (user_id, display_name, active) values
  ('00000000-0000-0000-0000-00000000000a', 'Old Reviewer', true),
  ('00000000-0000-0000-0000-00000000000b', 'Former Reviewer', false);

set role service_role;
select public.submit_report(repeat('a', 64),
  '{"version":2,"needs":["advocate","support"],"path":"incident","category":{"value":"housing"},"what":"legacy fictional text","timing":{"value":"other","text":"before March 3"},"contact_mode":"portal"}',
  'legacy-bucket');
select public.submit_report(repeat('b', 64),
  '{"version":2,"needs":["document"],"path":"concern","category":null,"contact_mode":"anonymous"}',
  'legacy-bucket');
select public.track_message(repeat('a', 64), 'legacy student message', 'legacy-bucket');
reset role;
update private.reports set status = 'under_review' where public_id = 'PR-1043';
