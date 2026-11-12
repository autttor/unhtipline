-- Retention policy: submissions are kept for one semester (180 days), as published on the Privacy page.
-- New submissions get the shorter date, and existing ones are brought in line. Nothing is extended.
alter table private.reports alter column delete_after set default (now() + interval '180 days');
update private.reports set delete_after = least(delete_after, created_at + interval '180 days');
