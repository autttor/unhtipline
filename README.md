# UNewHaven Pride Report

An independent, student-run intake for LGBTQ+ students at the University of New Haven: report something, get help with a University office, find peer support, ask for an advocate, or find resources.

Pride Report is not affiliated with, operated by, or endorsed by the University of New Haven. It is not an emergency service and not an official University reporting channel.

**Status: intake is closed.** The code is in place, but the site will not accept submissions until the owner finishes [SETUP.md](SETUP.md). Until then visitors can preview the questions, and nothing they type is sent or saved.

## How it fits together

```
Pride Guide (GitHub Pages)
   |  POST submit-report { report, meta, idem, privacy_ack }
   v
Supabase Edge Function: validate, rate-limit, store
   v
Private Postgres record  +  outbox row per reviewer mailbox      <- the student's receipt depends only on this commit
   v
Email worker (same function, then a retry job): Resend
   v
Reviewer mailbox: "New Pride Report PR-1043", request type, link. No narrative.
   v
Reviewer dashboard (/admin/): own account, password, authenticator code
```

| Part | Where |
| --- | --- |
| Public site: Home, Get help, Resources, About, Privacy, Contact | `*.html`, `assets/` |
| Pride Guide, the scripted assistant | `assets/js/engine.js`, `assets/js/flow.js` |
| Reviewer dashboard | `admin/`, `assets/js/admin.js` |
| Database: schema, access rules, outbox, retention | `supabase/migrations/` |
| Server functions | `supabase/functions/` |
| Owner setup and deployment | `SETUP.md`, `.env.example` |
| Reviewer rules and launch checklist | `docs/REVIEWER_CHECKLIST.md` |

The site is plain HTML, CSS and JavaScript with no build step, no cookies, and no third-party scripts, fonts or analytics. The only outside service the browser talks to is the project's own Supabase.

## Pride Guide: the fixed order

Pride Guide is a fixed script, not an AI model. `flow.js` holds every question and branch. The order below is enforced by tests for every branch and must not be changed.

1. **Intro and safety.** Student-run, not affiliated, not monitored 24/7, not an emergency service, not an official University report, and no guarantee of anonymity. Then "Are you safe right now?" No or Not sure shows Public Safety, 911 and 988, says plainly that the assistant cannot send help, offers an exit, and lets the student continue only after acknowledging that.
2. **"How can we help?"** The first substantive question. Six choices, with "I need to report something" first and filled.
3. **Questions for that choice only.**
   - Report something: what happened, optional categories (several allowed), where, when, once or ongoing, what they want to happen.
   - Help with a University office: which office, what they are trying to get done, whether they have contacted it, any deadline, what assistance would help.
   - Peer support: what they would like, optional context. Never a required disclosure.
   - An advocate: the concern, the outcome hoped for, any deadline, what advocacy would look like, and what the team can and cannot do.
   - Information or resources: topic, resource cards shown at once, and an optional question for reviewers. No submission needed.
   - Something else: free text and optional suggested next steps.
4. **Contact, privacy, permission.** "Would you like someone from our student team to contact you about this?" (email only), then the privacy notice, then, where relevant, a separate permission question about contacting anyone else. That permission defaults to no. Choosing "an advocate" or "help with an office" is never treated as consent.
5. **Review, Submit, receipt.** Every answer can be changed. One Submit. A receipt is shown only after the server confirms the report was stored.

Other behaviour:

- Every detail question can be skipped. Back and Start over are always available.
- Mentions of self-harm or a threat, or choosing the safety category, show urgent contacts immediately.
- Services nobody has agreed to staff are described as possibly unavailable (`SERVICES` in `config.js`).
- The draft is kept in `sessionStorage`: a refresh keeps it, closing the tab discards it.

To change wording or options, edit `flow.js` and make the same change in `supabase/functions/_shared/validate.ts`. `npm test` fails if they disagree.

## Submission and email

- **One path.** The browser posts to the `submit-report` function. There is no demo store and no browser-to-email service.
- **Fails closed.** `store.js` refuses to submit unless `INTAKE_ENABLED` is true, the Supabase URL is set, every policy is filled in, and the core campus contacts are verified.
- **Idempotent.** The browser makes one random key per report. Sending it again returns the same report and queues no second email.
- **Outbox.** Each notification is a row with status `queued`, `sending`, `sent` or `failed`, an attempt count, timestamps, the provider's message id and an error category. Failures are retried with backoff up to six times, then shown to admins with a Retry button. A stored report stays reviewable whatever happens to its email.
- **Metadata-only email.** Reference number, request type, advocacy and safety flags, and a dashboard link. A full-report option exists, is off by default, and is documented in SETUP.md.
- **One mail provider.** Resend, with a sandbox provider for local runs and tests. No fallback chain.
- **Rate limits and bot filters.** Five submissions per hour per network address (stored only as a keyed hash that changes daily), a hidden field, and a minimum completion time.

## Reviewer dashboard

- **Individual accounts.** Supabase Auth with email and password, plus a required authenticator-app code. Accounts are created by invitation only. There is no shared password and nothing is gated in the browser.
- **Roles.** `admin`, `reviewer`, `advocate`, stored in a private table that only the database owner and admins (through checked functions) can change.
- **Enforced in the database.** Tables live in a schema the API does not expose, with row-level security on and no policies. Every read or change goes through a `staff_*` function that checks the caller is active staff with a second factor, applies the access policy, and writes the audit log. Removing someone's access takes effect on their next request.
- **Access policy.** Everyone sees the queue's metadata. Content can be read by admins, the assignee, or anyone while a case is unassigned, except that unassigned advocacy cases are open only to advocates and admins. Only the assignee or an admin can change a case. A person restricted from a case (conflict of interest) cannot see it at all and cannot lift their own restriction.
- **What it shows.** Real cases only: New, In review, Awaiting follow-up, Closed; filters for incident reports, office help, peer support and advocacy; safety and advocacy flags; the student's unedited answers; contact preference and permission flags; assignment; internal notes; contact attempts; team due date; email delivery state with admin retry; and a per-case and global activity log.
- **What it does not do.** It sends nothing to students or anyone else, and it makes no judgment about credibility.

## Tests

```bash
npm test
```

Node 22.18 or newer, no dependencies. Covers the conversation order for every branch, skip, back, edit, the danger branch, multiple categories and opt-out; server validation; idempotent submission; the email outbox, retries and failures; the protected endpoints; and repository-wide checks (no secrets or third-party requests in public files, no em dashes, Public Safety listed before 911, no telephony).

```bash
npm run test:db
```

Applies both migrations to a throwaway local PostgreSQL cluster, including data in the first version's shape to test the upgrade, then runs the access-control checks as each role: public, signed-in outsider, reviewer without a second factor, reviewer, advocate, admin, restricted and removed staff. Needs PostgreSQL 15+ binaries and a non-root user.

```bash
npm run test:e2e
```

Starts a local database, the real server functions, a stand-in for Supabase sign-in, and a sandbox mail provider, then drives the site and the dashboard in a real browser. Needs PostgreSQL and Playwright. No real submissions or emails are involved in any test, and every fixture is fictional.

## Known limits

- Sign-in, invitations and the authenticator step are tested against a stand-in for Supabase Auth, not the real service. The first real sign-in is the confirmation.
- University contact details are unverified (see SETUP.md, B2).
- Not built: replies from inside the dashboard, a reply channel for students who give no email, attachments, other languages, and student-side withdrawal of a report.
