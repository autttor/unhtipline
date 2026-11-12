# Setting up report delivery

Right now the site is in demo mode: reports stay in the visitor's browser and go nowhere. This page explains how to make reports reach you, and exactly what to hand over if you want it wired up for you.

There are two options. **Use Option A now.** Option B is built and tested, but reviewers have no page to reply from yet (see "Known gap" below), so it should wait until that page exists. Moving from A to B later changes nothing for students except that tracking codes appear.

| | Option A: email only | Option B: full backend |
| --- | --- | --- |
| What happens to a report | Emailed to your inbox | Stored in a private database, and emailed to your inbox |
| Setup time | About 5 minutes | About 45 minutes |
| Accounts needed | One form service | Supabase and Resend |
| Tracking codes and two-way messages | No | Yes |
| Anonymous students can get a reply | No | Yes |
| Cost to start | Free tier | Free tiers |

## First: a dedicated inbox

Do this for either option.

1. Create a new email account used only for Pride Report. Do not use anyone's personal or school account.
2. Turn on two-step verification.
3. Share access only with the trained reviewers.

Reports contain sensitive information about students. Whoever can open this inbox can read all of it.

## Option A: email only

Pick one of the two services. Both are built for static sites like this one.

### A1. Web3Forms

1. Go to web3forms.com and enter the dedicated inbox address.
2. They email an **access key** to that inbox.
3. Open `assets/js/config.js` and paste it in:
   ```js
   EMAIL_WEB3FORMS_KEY: "paste-the-access-key-here",
   ```

### A2. Formspree

1. Create an account at formspree.io using the dedicated inbox address.
2. Create a new form. Its endpoint looks like `https://formspree.io/f/abcdwxyz`.
3. Copy only the last part (`abcdwxyz`) into `assets/js/config.js`:
   ```js
   EMAIL_FORMSPREE_ID: "abcdwxyz",
   ```

### What to give me

Just the Web3Forms access key or the Formspree form ID. Both are designed to be public (they are visible in any website that uses them) and only allow sending to your inbox, so they are safe to paste in chat. I will put it in `config.js` and push.

### Then test it

1. Open the site, go through Pride Guide, and submit a made-up report.
2. Check the inbox, including the spam folder. The subject is `New Pride Report submission PR-XXXX-XXXX`.
3. If you gave an email address as your contact, pressing Reply in the inbox should address the student.

I could not reach either service from the build environment, so this first test is the real confirmation that delivery works. If nothing arrives, tell me what the site showed and I will fix it.

### What students see in email mode

- A reference number instead of a tracking code.
- Two ways to submit: anonymous (no reply possible) or identified.
- The "My report" page explains that tracking is not switched on, and the menu link is hidden.
- The About page says plainly that reports are delivered by email through a form service.

Check the free plan limits of whichever service you choose. If the monthly limit is reached, submissions fail and the student is told nothing was sent.

## Option B: full backend

This stores reports in Supabase, gives every student a private tracking code, allows two-way messages, and emails reviewers through Resend.

### B1. Supabase

1. Create a project at supabase.com. Note the project URL, which looks like `https://abcdefgh.supabase.co`.
2. Install the Supabase CLI and sign in:
   ```bash
   npx supabase login
   ```
3. From this repository, link the project (the ref is the `abcdefgh` part of the URL):
   ```bash
   npx supabase link --project-ref abcdefgh
   ```
4. Create the database tables and rules:
   ```bash
   npx supabase db push
   ```

### B2. Resend (the email part)

1. Create an account at resend.com using the dedicated inbox address.
2. Create an API key.
3. Until you verify a domain, Resend only delivers to the address you signed up with. That is fine if it is the dedicated inbox. To send to several reviewers, verify a domain in Resend first.

### B3. Secrets

Generate a long random value for hashing access codes. Keep it somewhere safe: if it is lost or changed, every existing tracking code stops working.

```bash
openssl rand -hex 32
```

Then set the secrets. Replace each value with your own.

```bash
npx supabase secrets set CODE_PEPPER=the-random-value ALLOWED_ORIGIN=https://autttor.github.io RESEND_API_KEY=re_your_key EMAIL_TO=your-inbox@example.com
```

Optional settings:

| Secret | What it does | Default |
| --- | --- | --- |
| `EMAIL_FROM` | Sender shown on the email, for example `Pride Report <reports@yourdomain.org>`. Needs a domain verified in Resend. | Resend's test sender |
| `EMAIL_INCLUDE_DETAILS` | `true` puts the full report in the email. `false` sends only the reference number, and reviewers read the report in the database. | `true` |
| `NOTIFY_WEBHOOK_URL` | Also post a "new report" ping (reference number only) to a chat webhook. | off |

`ALLOWED_ORIGIN` is the address of the site with no path and no trailing slash. For GitHub Pages on this repository that is `https://autttor.github.io`.

### B4. Deploy the two functions

```bash
npx supabase functions deploy submit-report --no-verify-jwt
```

```bash
npx supabase functions deploy track-report --no-verify-jwt
```

### B5. Point the site at it

In `assets/js/config.js`:

```js
API_BASE: "https://abcdefgh.supabase.co/functions/v1",
```

### What to give me

Only the project URL (`https://abcdefgh.supabase.co`). It is public by design. I will set `API_BASE` and push.

Do not paste the service role key, the Resend API key or `CODE_PEPPER` into chat or into any file in this repository. They go into `supabase secrets set` on your own computer and nowhere else.

### Then test it

1. Submit a made-up report. You should get a code like `PR-7K9M-2Q4X-H3TN`.
2. Check the inbox for `New Pride Report PR-1043`.
3. Open "My report", enter the code, and send a message. The inbox should get `New message on Pride Report PR-1043` with the message in it.

These steps were written without access to a live Supabase or Resend account. The code is tested against a local database and a stand-in mail service, so if a command above does not match what the CLI shows, tell me the error and I will adjust.

### Known gap in Option B

There is no reviewer sign-in page yet. Reviewers read reports and student messages from the email (with `EMAIL_INCLUDE_DETAILS=true`), but cannot change a report's status or reply to a student through the site. That means a student who chooses "Private follow-up" would wait for a reply that cannot be sent. Do not switch to Option B until the reviewer page is built. The database side of it exists and is tested; the page is the next thing to build.

## Publishing the site

1. In the repository on GitHub: **Settings, Pages**.
2. **Source:** Deploy from a branch. Choose the branch and the `/ (root)` folder.
3. The site appears at `https://autttor.github.io/unhtipline/`.

## Text-message front door

A text number (for example TextFree) can auto-reply with a link to the site. It is a way to find the site, not a reporting channel. Suggested auto-reply:

> UNewHaven Pride Report: get help at [URL]. Not monitored. Emergency: Public Safety (203) 932-7070 or 911.

Without the link that is 100 characters, which leaves 60 for the link inside a 160-character limit.
