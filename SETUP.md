# Setup and deployment

This is the owner's checklist: what to do, in order, to take Pride Line from "closed" to accepting real submissions. Nothing here needs a programmer, but some steps use a terminal.

## Read this first: what this update changes

- **Intake is closed until you finish this checklist.** The site now refuses to accept submissions unless the backend is deployed, the policies are written down, and the core campus contacts are verified. Until then, visitors see "not accepting submissions yet" and can only preview the questions. Nothing they type in the preview is sent or saved.
- **The site and the backend must be updated together.** The new site sends a new kind of report. If you publish the site without redeploying the functions (Part A), submissions fail safely with an error. They are never lost silently and never shown as successful.
- **Emails no longer contain what the student wrote.** Reviewers get "New Pride Line PR-1043" with the request type and a link to the dashboard. The report is read in the dashboard, behind each reviewer's own sign-in.
- **The Web3Forms and Formspree path is removed.** Reports no longer go from the browser to an email service. Those two keys were in this repository's history. They only allow sending to your inbox, but you can delete both forms in those services to retire them.
- **Tracking codes are retired for new submissions.** Students now get a reference number as a receipt. Anyone who was given an access code earlier can still use it on the "earlier access codes" page.

## Part A: deploy the backend

You need the Supabase CLI and to be signed in. All commands run from this repository's folder.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref apkyznnkokhwalbasbdt
```

### A1. Update the database

```bash
npx supabase db push
```

This applies `supabase/migrations/0002_dashboard_outbox.sql` on top of the first migration and keeps every existing report.

If the first migration was pasted into the SQL editor by hand instead of pushed with the CLI, `db push` will try to run it again and stop with an "already exists" error. In that case, open the Supabase dashboard, go to the SQL editor, paste the whole of `0002_dashboard_outbox.sql`, and run it once.

### A2. Set the secrets

If you already set `CODE_PEPPER`, `ALLOWED_ORIGIN`, `RESEND_API_KEY` and `EMAIL_TO` for the earlier version, keep them exactly as they are. Add the two new ones:

```bash
openssl rand -hex 32
```

```bash
npx supabase secrets set DISPATCH_SECRET=paste-the-random-value DASHBOARD_URL=https://autttor.github.io/unhtipline/admin/
```

The full list is in `.env.example`. Check what is set with:

```bash
npx supabase secrets list
```

| Secret | Needed | What it is |
| --- | --- | --- |
| `CODE_PEPPER` | Yes | At least 32 random characters. Keep the existing value. |
| `ALLOWED_ORIGIN` | Yes | `https://autttor.github.io` with no path and no trailing slash. |
| `EMAIL_TO` | Yes | Reviewer mailbox or mailboxes, comma separated. One notification per mailbox per submission. |
| `RESEND_API_KEY` | Yes | Your Resend key. |
| `DISPATCH_SECRET` | Yes | A second random value, used only by the retry job in A4. |
| `DASHBOARD_URL` | Yes | The link placed in notification emails and in invitations. |
| `EMAIL_FROM` | Optional | A sender on a domain verified in Resend. Without it, Resend's test sender is used, which only delivers to the address the Resend account was created with. |
| `EMAIL_PROVIDER` | Optional | `resend` (default when a key is set) or `sandbox`, which sends nothing. |
| `EMAIL_INCLUDE_DETAILS` | Leave off | See "The full-report email option" below. |

Never put any of these in `assets/js/config.js` or anywhere else in this repository.

### A3. Deploy the functions

```bash
npx supabase functions deploy submit-report --no-verify-jwt
```

```bash
npx supabase functions deploy send-notifications --no-verify-jwt
```

```bash
npx supabase functions deploy admin-users --no-verify-jwt
```

```bash
npx supabase functions deploy track-report --no-verify-jwt
```

`--no-verify-jwt` is correct for all four. Students are not signed in, and the two staff functions check the caller's sign-in themselves, including the second sign-in step.

### A4. Schedule email retries

A notification is attempted the moment a report is stored. If that attempt fails, this job retries it. In the Supabase dashboard, enable the `pg_cron` and `pg_net` extensions (Database, Extensions), then run this once in the SQL editor, replacing the secret:

```sql
select cron.schedule('pride-report-send-notifications', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://apkyznnkokhwalbasbdt.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', 'PASTE-DISPATCH_SECRET-HERE'),
    body := '{}'::jsonb
  );
$$);
```

Also schedule the retention purge:

```sql
select cron.schedule('pride-report-purge', '17 8 * * *', 'select public.purge_expired_reports()');
```

Admins can also press "Send due emails now" on the dashboard's Email delivery tab at any time.

### A5. Sign-in settings

In the Supabase dashboard, under Authentication:

1. **Turn off public sign-ups** (Sign In / Providers, "Allow new users to sign up"). Reviewer accounts are created only by invitation.
2. **URL configuration:** set the Site URL to `https://autttor.github.io/unhtipline/admin/` and add the same address to the redirect allow list. Invitation and password-reset links land there.
3. **Password rules:** set the minimum length to 12 and turn on leaked-password protection if your plan offers it.
4. **Multi-factor:** make sure TOTP (authenticator app) is enabled. The dashboard will not show any report to someone who has not completed it.

### A6. Create the first admin

1. Authentication, Users, "Add user". Enter the first admin's email and a temporary password.
2. In the SQL editor, run this with their details:

```sql
insert into private.staff (user_id, email, display_name, role)
select id, email, 'Their Name', 'admin' from auth.users where email = 'them@example.org';
```

Have two admins. An admin cannot remove their own access, and one admin cannot handle a case they have a conflict of interest in.

### A7. Connect the dashboard

In the Supabase dashboard, Project Settings, API: copy the **anon** key (it may be labelled "publishable"). Put it in `assets/js/config.js`:

```js
SUPABASE_ANON_KEY: "paste-the-anon-key-here",
```

This key is designed to be public. It is not the service-role key, which must never appear in this repository.

Then open `https://autttor.github.io/unhtipline/admin/`, sign in, change the temporary password with "Forgot password", and set up the authenticator app when prompted. Invite everyone else from the Team tab. Each person chooses their own password and sets up their own authenticator.

## Part B: decisions only you can make

Intake stays closed until every item here is done. The site checks them itself.

### B1. Write the policies into `assets/js/config.js`

| Setting | What to decide | Who should be involved |
| --- | --- | --- |
| `REVIEW_HOURS` | When reviewers actually read submissions | The reviewer team |
| `RESPONSE_TIME` | A first-response time you can keep during exams and breaks | The reviewer team |
| `RETENTION` | How long submissions are kept. The database default is 180 days (one semester, migration 0003). If you choose something else, add a migration that changes the `delete_after` default. | An adviser |
| `CONFIDENTIALITY_LIMITS` | When a reviewer must tell someone else, for example a threat to someone's safety, and how that interacts with Title IX and campus safety obligations. Student reviewers may have reporting duties of their own. | Appropriate University staff |
| `CONTACT_EMAIL` | A monitored address for questions about the project, not for reports | You |

Write each as a phrase that completes the sentence on the Privacy page. For example `REVIEW_HOURS: "on weekdays during the semester"` and `CONFIDENTIALITY_LIMITS: "If you tell us someone is in immediate danger, a reviewer may contact University Public Safety."`.

### B2. Verify the campus contacts

Open `assets/js/resources-data.js`. For each record, open its `source` link, confirm every phone number, email and link, then set `verified: true` and `checked: "YYYY-MM-DD"`. The University contacts came from the project proposal and were not re-checked, because newhaven.edu could not be reached while this was built.

- **Core records** (Public Safety, Report It!, Title IX, the Myatt Center, The Trevor Project) must be verified before intake can open.
- **Placeholder records** (Residential Life, Dean of Students, Counseling, New Haven Pride Center, the Connecticut Commission on Human Rights and Opportunities, 211 Connecticut) have no contact details yet and are hidden from students. Add details from each official page to publish them. Do not add hours or confidentiality claims the official page does not state.

The Public Safety number also appears in fixed text on every page and in Pride Guide's script. If it is wrong, search the repository for `932-7070`.

### B3. Say what is staffed

In `config.js`, `SERVICES` controls what Pride Guide promises. Leave a service `false` until someone trained has agreed to provide it. While `false`, Pride Guide tells the student plainly that it may not be available and shows established support instead.

### B4. Train reviewers

Every reviewer reads `docs/REVIEWER_CHECKLIST.md` before they are invited.

## Part C: open intake

1. Run the tests in Part D.
2. Set `INTAKE_ENABLED: true` in `assets/js/config.js` and publish.
3. Submit one made-up report yourself. Confirm the reference number, the email, and that it appears in the dashboard. Delete it from the dashboard afterwards.

**To stop accepting submissions at any time,** set `INTAKE_ENABLED: false` and publish. The site closes immediately and says so.

## Part D: check a deployment

Use made-up content only.

| Check | Expected |
| --- | --- |
| Open the site in a private window | First screen says student-run, not affiliated, not 24/7, not an emergency service, then asks "Are you safe right now?" |
| Choose Yes | Next question is "How can we help?" with "I need to report something" first and filled |
| Submit a made-up advocacy request | A reference number appears only after a short wait; the dashboard shows one new case marked "Advocacy requested" |
| Check the reviewer mailbox | One email per mailbox, with the reference number and request type, and none of what you typed |
| Press Submit twice quickly, or resubmit after going offline | Still one case and one email |
| Open `/admin/` signed out | Sign-in form only. No case data anywhere in the page source |
| Sign in as a reviewer without finishing the authenticator step | No cases are shown |
| As a reviewer, try to open an unassigned advocacy case | Refused |
| Remove a reviewer's access on the Team tab while they are signed in | Their next click signs them out |
| Set `RESEND_API_KEY` to a wrong value and submit | The student still gets a receipt; the case shows "Email failed"; Retry works once the key is fixed |

## Publishing the site

In the repository on GitHub: Settings, Pages, deploy from a branch, choose the branch and the `/ (root)` folder. The site is served at `https://autttor.github.io/unhtipline/`. All links are relative, so it works under that path.

## The full-report email option

`EMAIL_INCLUDE_DETAILS=true` makes notification emails contain the student's whole report, including any contact details. It is off by default and should stay off. Turning it on means reports live in ordinary mailboxes, outside the dashboard's sign-in, access restrictions, audit log and retention deletion, and can be forwarded or backed up without anyone knowing. If you decide you need it, record who approved it and why, and tell students on the Privacy page.

## What is not built or not switched on

- **Replies from inside the dashboard.** Reviewers contact a student from the team mailbox and log the attempt on the case. Nothing is sent from the dashboard.
- **A reply channel for students who give no email address.** They are told before submitting that reviewers cannot reply.
- **Evidence attachments, other languages, and a student-facing "withdraw my report" button.**
- **Published statistics.**

## What to give me

- The **anon key** and I will put it in `config.js`. It is public by design.
- The **policy wording** from B1 and I will add it and update the Privacy page if needed.
- **Verified contact details** from B2 and I will update the records.

Do not paste the service-role key, the Resend key, `CODE_PEPPER` or `DISPATCH_SECRET` into chat or into any file here.

These steps were written without access to your Supabase or Resend accounts. The code is tested against a local database, a stand-in sign-in service and a sandbox mail provider. If a command or a dashboard screen does not match what is written here, tell me what you see and I will adjust.
