# UNewHaven Pride Report

A student-led tipline for LGBTQ+ students at the University of New Haven. Students tell us what happened and what they need, and student reviewers can advocate for them, help them with a University office, support them, or help resolve a conflict.

**Status: prototype in demo mode.** To make reports reach you, follow [SETUP.md](SETUP.md).

Pride Report is an independent student initiative. It is not affiliated with or endorsed by the University of New Haven, and it does not replace the University's Report It! system, Title IX reporting, or the Myatt Center.

## What is here

| Part | Where | State |
| --- | --- | --- |
| Website: Home, Get help, Resources, My report, About & privacy | `*.html`, `assets/` | Working on phone and desktop |
| Pride Guide, the scripted assistant | `assets/js/engine.js`, `assets/js/flow.js` | Working, tested |
| Email delivery (Web3Forms or Formspree) | `assets/js/store.js` | Built and tested against a stand-in; needs your key and one real test |
| Full backend: database, tracking codes, messages, email alerts | `supabase/` | Built and tested locally; never deployed |
| Reviewer dashboard | `admin/` | Demo only, on invented data, no sign-in |

The site is plain HTML, CSS and JavaScript. There is no build step, no framework, no cookies, and no third-party script, font or analytics.

## Try it

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. In demo mode, reports are kept in that browser only. "Clear demo data" in the yellow banner removes them. Submit a report, open **My report** with the code, then open **Reviewer dashboard (demo)** in the footer and reply to it.

## How Pride Guide works

Pride Guide is a fixed script, not an AI model. `engine.js` is a small state machine and `flow.js` holds every question, option and branch. It cannot invent advice or assess a report.

The conversation has five parts:

1. **What you need.** After a safety check, the first question is "What can we do for you?": advocate for me, help me with a University office, support me, help me resolve a conflict, explain my official reporting options, or just document it. Each kind of help has one short follow-up, for example which office, or whether a reviewer may raise it with or without the student's name.
2. **What happened.** Category, the student's own words, when, where, who (by role, never by name), how often.
3. **What you'd like to see.** A good outcome in the student's words, and any deadline coming up.
4. **How to reach you.** Anonymous, private follow-up on the site, or identified. Identified students can ask reviewers to be discreet.
5. **Review and submit.** Every answer can be changed. Nothing is sent before this point.

Other behaviour worth knowing:

- Every detail question can be skipped, and five accept the student's own words instead of a listed option.
- Emergency contacts always list University Public Safety first, then 911.
- If a typed answer mentions self-harm, crisis lines are shown immediately.
- The in-progress conversation is kept in `sessionStorage`, so a refresh does not lose it and closing the tab does.

To change wording or add a question, edit `flow.js`. If you add or rename an option, make the same change in `supabase/functions/_shared/validate.ts`. `npm test` fails if the two disagree. The tone rules are at the top of `flow.js`.

Campus contact details live in `assets/js/resources-data.js`. The Public Safety number also appears in the page footer, the callouts on each page, and Pride Guide's script.

## Phone and desktop

- **Phone:** full-width answer buttons, a sticky answer bar that respects the home-indicator area, a collapsible "Need help right now?" panel, and a compact menu.
- **Desktop:** the conversation sits beside a column showing progress through the five parts, urgent contacts, and reminders.
- Light and dark themes follow the device setting. Print styles give a clean copy of a report.

## Tests

```bash
npm test
```

Runs the Node tests (Node 22.18 or newer, no dependencies): the conversation script, server-side validation, email delivery, and checks that browser and server agree. They also check that there are no em dashes and that Public Safety is always listed before 911.

```bash
npm run test:db
```

Applies the migration to a throwaway local PostgreSQL cluster and runs the access-control checks. Needs PostgreSQL 15+ binaries and a non-root user.

## Backend design (Option B in SETUP.md)

```
Browser (GitHub Pages)
   |  POST /functions/v1/submit-report   { report, meta }      ->  { id, code }
   |  POST /functions/v1/track-report    { action, code, ... } ->  the student's view
   v
Edge Functions: validate, generate the access code, hash it, rate-limit, email reviewers
   v
Postgres functions (service role only)
   v
Tables in the `private` schema, which the Supabase API does not expose
```

- **Access codes** look like `PR-7K9M-2Q4X-H3TN` (about 59 bits). The code is generated on the server, returned once, never emailed, and stored only as an HMAC with a server-side secret.
- **Reference numbers** like `PR-1043` are separate, safe to put in an email subject, and grant no access.
- **Email** goes to reviewers through Resend. By default it contains the full report. The subject never contains details.
- **Rate limits:** 5 submissions and 30 tracking lookups per hour per network address. The address is stored only as a keyed hash that changes daily, and is purged after two days.
- **Reviewers** never read tables. The `reviewer_*` database functions require an account listed in `private.reviewers` and a two-factor sign-in, and write an audit entry on every open or change.
- **Statistics** hide any group smaller than five.
- **Retention:** reports carry a `delete_after` date (365 days by default) and `purge_expired_reports()` removes them.

## Before accepting real reports

The code is the smaller part of this. None of the following is done:

- **Verify every campus contact.** The phone numbers, email and links came from the project proposal and have not been checked against newhaven.edu.
- **Escalation protocol.** Decide, with appropriate University staff, when a reviewer must tell someone else, and how that interacts with Title IX and campus safety obligations. Student reviewers may have reporting duties of their own. Publish the result on the About page.
- **What "advocate" and "conflict resolution" mean in practice.** The site now offers both. Agree who does them, what training they have, and what they will not do.
- **Reviewer selection, training and response time.** Then set `REVIEW_EXPECTATION` in `config.js` to something reviewers can sustain.
- **Retention period and privacy policy.** The About page marks these "to be decided". In email mode, also decide how long reports stay in the inbox.
- **Reviewer dashboard for live data** (Option B only). See the known gap in SETUP.md.
- **Hosting review.** Check the terms and plan limits of GitHub, the form service or Supabase, and Resend against the sensitivity of this data.
- **Independent security review and accessibility testing** with real assistive technology.
- **Name and affiliation.** Confirm the University is comfortable with "UNewHaven" in the name of an independent project.

## Not built yet

Reviewer sign-in and live dashboard, evidence attachments, save-and-continue across devices, other languages, and a student-facing "withdraw my report" button.
