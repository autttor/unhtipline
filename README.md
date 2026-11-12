# UNewHaven Pride Report

A student-led place to document LGBTQ+ discrimination, harassment and campus concerns at the University of New Haven, and to understand the options available — even when a student isn't ready to file a formal complaint.

**Status: prototype. It runs in demo mode and must not collect real reports yet.** See [Before accepting real reports](#before-accepting-real-reports).

Pride Report is an independent student initiative. It is not affiliated with or endorsed by the University of New Haven, and it does not replace the University's Report It! system, Title IX reporting, or the Myatt Center.

## What is here

| Part | Where | State |
| --- | --- | --- |
| Website: Home, Report, Resources, My report, About & privacy | `*.html`, `assets/` | Working |
| Pride Guide, the scripted reporting assistant | `assets/js/engine.js`, `assets/js/flow.js` | Working, tested |
| Report tracking with private access codes and two-way messages | `track.html` | Working in demo mode and against the backend |
| Reviewer dashboard | `admin/` | **Demo only** — invented data, no sign-in |
| Database schema, access rules, retention | `supabase/migrations/0001_init.sql` | Written and tested on local PostgreSQL; never deployed to Supabase |
| Submission and tracking API | `supabase/functions/` | Written, tested with a fake and a local database; never deployed to Supabase |

The site is plain HTML, CSS and JavaScript. There is no build step, no framework, no cookies, and no third-party script, font or analytics request.

## Try it

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. In demo mode, reports are kept in that browser's `localStorage` only; "Clear demo data" in the yellow banner removes them. Submit a report, open **My report** with the code, then open the **Reviewer dashboard (demo)** link in the footer and reply to it.

## Publish on GitHub Pages

1. Repository **Settings → Pages**.
2. **Source:** Deploy from a branch. Pick the branch and the `/ (root)` folder.
3. The site appears at `https://<owner>.github.io/<repo>/`.

All links are relative, so it works under a project path. `.nojekyll` tells Pages to serve the files as they are.

## How Pride Guide works

Pride Guide is a fixed script, not an AI model. `engine.js` is a small state machine; `flow.js` holds every question, option and branch. It cannot invent advice or assess a report.

- Every incident-detail question can be skipped, and three accept the student's own words instead of a category.
- It asks about immediate danger first and shows 911 and Public Safety before anything else.
- If a typed answer mentions self-harm, it shows crisis lines immediately rather than leaving that for a reviewer to find days later.
- Nothing is sent until the student confirms two statements on the review screen.
- The in-progress conversation is kept in `sessionStorage`, so a refresh doesn't lose it and closing the tab does.

To change wording or add a question, edit `flow.js`. If you add or rename an option, make the same change in `supabase/functions/_shared/validate.ts`; `npm test` fails if the two disagree. The tone rules are at the top of `flow.js`.

Campus contact details live in one file, `assets/js/resources-data.js`.

## Tests

```bash
npm test
```

Runs 35 tests with Node 22.18 or newer and no dependencies: the conversation script, the server-side validation and handlers, and checks that the browser and server agree.

```bash
npm run test:db
```

Applies the migration to a throwaway local PostgreSQL cluster and runs 54 access-control and behaviour checks. Needs PostgreSQL 15+ binaries on the machine, and must be run as a non-root user.

## Backend design

```
Browser (GitHub Pages)
   │  POST /functions/v1/submit-report   { report, meta }      → { id, code }
   │  POST /functions/v1/track-report    { action, code, … }   → the student's view
   ▼
Edge Functions  — validate, generate the access code, hash it, rate-limit
   ▼
Postgres functions (service role only)
   ▼
Tables in the `private` schema — not exposed by the Supabase API at all
```

- **Access codes** look like `PR-7K9M-2Q4X-H3TN` (about 59 bits). The code is generated on the server, returned once, and stored only as an HMAC with a server-side secret. It is longer than the 8-character example in the original proposal so that it is impractical to guess.
- **Reference numbers** like `PR-1043` are separate, are safe to put in a notification, and grant no access.
- **Rate limits:** 5 submissions and 30 tracking lookups per hour per network address. The address is stored only as a keyed hash that changes daily, and is purged after two days.
- **Reviewers** never read tables. They call `reviewer_*` database functions, which require an account listed in `private.reviewers` *and* a two-factor sign-in, and write an audit entry on every open or change.
- **Statistics** hide any group smaller than five.
- **Retention:** reports carry a `delete_after` date (365 days by default); `purge_expired_reports()` removes them. The audit log keeps reference numbers only.
- **Notifications** to reviewers contain the reference number and nothing else.

### Deploying the backend (when the time comes)

Check these steps against the current Supabase documentation; they were written without access to a live project.

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` (SQL editor, or `supabase db push`).
2. Set the function secrets:
   - `CODE_PEPPER` — at least 32 random characters. Losing or changing it invalidates every access code.
   - `ALLOWED_ORIGIN` — the site's exact origin, for example `https://<owner>.github.io` (no path, no trailing slash).
   - `NOTIFY_WEBHOOK_URL` — optional.
3. Deploy both functions without JWT verification, since students are not signed in:
   ```bash
   supabase functions deploy submit-report --no-verify-jwt
   ```
   ```bash
   supabase functions deploy track-report --no-verify-jwt
   ```
4. Enable `pg_cron` and schedule the purge (the statement is at the bottom of the migration).
5. Set `API_BASE` in `assets/js/config.js` to `https://<project>.supabase.co/functions/v1`.

The service-role key and `CODE_PEPPER` must never be committed or placed in `config.js`.

## Before accepting real reports

The code is the smaller part of this. None of the following is done:

- **Reviewer dashboard for live data.** The database functions exist and are tested, but there is no sign-in page. Today, live reports could only be read through the Supabase SQL editor, which bypasses the audit log.
- **Verify every campus contact.** The phone numbers, email and links in `assets/js/resources-data.js` (and repeated in the footer, About page and Pride Guide's script) came from the project proposal and have not been checked against newhaven.edu.
- **Escalation protocol.** Decide, with appropriate University staff, when a reviewer must tell someone else, and how that interacts with Title IX and campus safety obligations. Student reviewers may have reporting duties of their own. Publish the result on the About page.
- **Reviewer selection, training and response time.** Then set `REVIEW_EXPECTATION` in `config.js` to something reviewers can sustain.
- **Retention period and privacy policy.** The About page marks these "to be decided".
- **Hosting review.** Check Supabase's and GitHub's terms and plan limits against the sensitivity of this data. A free tier is not automatically appropriate.
- **Independent security review and accessibility testing** with real assistive technology.
- **Abuse protection.** The current filters (hidden field, minimum time, rate limits) stop casual bots only. Decide whether a privacy-respecting CAPTCHA is needed.
- **Name and affiliation.** Confirm the University is comfortable with "UNewHaven" in the name of an independent project.

## SMS front door

A text number (for example TextFree) can auto-reply with a link to the site. It is a way to find the site, not a reporting channel — the About page says so. Suggested auto-reply, which leaves 45 characters for the link within a 160-character limit:

> UNewHaven Pride Report: share an LGBTQ+ campus concern at [URL]. This number is not monitored. In an emergency call 911.

## Not built yet

Evidence attachments, save-and-continue across devices, other languages, and a student-facing "withdraw my report" button.
