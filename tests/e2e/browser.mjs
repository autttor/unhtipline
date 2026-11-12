// Drives the real site and dashboard in a browser against tests/e2e/server.mjs.
// Each check prints "ok" or throws. Everything typed here is fictional.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2];
let passed = 0;
function ok(condition, label) {
  if (!condition) throw new Error("FAIL: " + label);
  passed++;
  console.log("ok   " + label);
}
const peek = async (query) => (await (await fetch(base + "/__test/sql", { method: "POST", body: JSON.stringify({ query }) })).json()).data;
const mailbox = async () => (await fetch(base + "/__test/mail")).json();
const count = (table) => peek(`select count(*) from private.${table}`);

const browser = await chromium.launch();
const errors = [];
async function newPage(viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (4\d\d|5\d\d)/.test(m.text())) errors.push(m.text()); });
  return page;
}
// Set E2E_SHOTS to a folder to save screenshots of the main screens for a visual check.
const shot = async (page, name, fullPage = true) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage }); };
const click = async (page, name) => { await page.getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(60); };
const type = async (page, text) => { await page.fill("#composer-input", text); await page.keyboard.press("Enter"); await page.waitForTimeout(60); };

/* ---------- 1. Closed: the site as committed sends and saves nothing ---------- */
{
  const page = await newPage({ width: 390, height: 800 });
  const calls = [];
  page.on("request", (r) => { if (/\/(functions|rest|auth)\/v1\//.test(r.url()) || /supabase\.co/.test(r.url())) calls.push(r.url()); });
  await page.goto(base + "/closed/report.html");
  ok(await page.locator("#closed").isVisible(), "closed: the page says submissions are not being accepted");
  ok(!(await page.locator("#chat").isVisible()), "closed: the conversation does not start by itself");
  ok((await page.locator(".banner-demo").innerText()).includes("Not accepting submissions yet"), "closed: every page carries the banner");
  await shot(page, "closed");
  await click(page, "Preview the questions");
  ok((await page.locator("#log").innerText()).includes("Preview only"), "closed: the preview says nothing is sent or saved");
  await click(page, "Yes"); await click(page, "I need peer support I need peer support".slice(0, 19)).catch(() => {});
  if (!(await page.locator("#log").innerText()).includes("I need peer support")) await page.locator("button.choice", { hasText: "I need peer support" }).click();
  await click(page, "Someone to listen"); await click(page, "Done"); await click(page, "Skip"); await click(page, "No");
  await click(page, "I understand. Continue");
  ok((await page.locator("#log").innerText()).includes("[to be confirmed before this service opens]"), "closed: undecided policies are shown as undecided");
  await page.check("#consent-unofficial"); await page.check("#consent-share");
  await click(page, "Finish preview (nothing is sent)");
  ok((await page.locator("#options").innerText()).includes("Nothing was sent or saved"), "closed: finishing the preview shows no receipt");
  ok(await page.locator("#reference").count() === 0, "closed: there is no reference number");
  ok(calls.length === 0, "closed: the browser contacted no backend at all");
  ok(Number(await count("reports")) === 0, "closed: nothing reached the database");
  await page.context().close();
}

/* ---------- 2. Open: fixed order, advocacy request, verified receipt ---------- */
let advocacyId;
{
  const page = await newPage({ width: 390, height: 800 });
  await page.goto(base + "/open/report.html");
  ok(!(await page.locator("#closed").isVisible()) && await page.locator("#chat").isVisible(), "open: the conversation starts");
  const first = await page.locator("#log").innerText();
  for (const phrase of ["run by students", "not affiliated with, operated by, or endorsed by", "not monitored 24/7", "not an emergency service", "Are you safe right now?"]) {
    ok(first.includes(phrase), `first screen says "${phrase}"`);
  }
  ok(!first.includes("How can we help?"), "the safety question comes before anything else");
  ok(JSON.stringify(await page.locator("#options button").allInnerTexts()) === JSON.stringify(["Yes", "No", "I’m not sure"]), "safety answers are Yes / No / I'm not sure");

  // Danger branch first, by keyboard only.
  await page.locator("#options button", { hasText: "No" }).first().focus();
  await page.keyboard.press("Enter"); await page.waitForTimeout(80);
  const danger = await page.locator("#log").innerText();
  ok(danger.includes("cannot call anyone or send help") && danger.indexOf("932-7070") < danger.lastIndexOf("911"), "not safe: resources shown, Public Safety before 911, no dispatch claim");
  ok(await page.getByRole("button", { name: "Leave this site now" }).isVisible(), "not safe: a prominent exit is offered");
  ok(await page.locator("#composer").isHidden(), "not safe: the student is not asked to describe anything");
  await click(page, "I understand this can’t send help. Continue");

  const last = page.locator("#log .bubble:not(.user)").last();
  ok((await last.innerText()) === "How can we help?", "the next question is exactly \"How can we help?\"");
  await shot(page, "help-phone", false);
  const choices = page.locator("#options button.choice");
  ok((await choices.first().innerText()).startsWith("I need to report something"), "\"I need to report something\" is first");
  ok(await choices.first().evaluate((b) => b.classList.contains("choice-primary")) && await choices.locator(".choice-primary").count() === 0
    && (await page.locator("#options button.choice-primary").count()) === 1, "it is the only filled (primary) choice");
  ok((await choices.count()) === 6, "six ways to get help are offered");

  await page.locator("button.choice", { hasText: "I need an advocate" }).click(); await page.waitForTimeout(60);
  await type(page, "Fictional: my name is wrong on a class roster and I was told nothing can be done.");
  await type(page, "Fictional: the roster corrected.");
  await type(page, "advising meeting on the 14th");
  ok((await page.locator("#log").innerText()).includes("does not give us permission to contact anyone"), "advocacy branch explains that asking is not consent");
  await click(page, "Help me understand my options"); await click(page, "Done");
  await click(page, "Yes");
  await type(page, "not-an-email");
  ok((await page.locator("#log").innerText()).includes("doesn’t look like an email address"), "a malformed email address is refused");
  await type(page, "student@example.com"); await click(page, "Skip"); await click(page, "No, please be discreet");
  ok((await page.locator("#log").innerText()).includes("on weekdays during the semester"), "the privacy notice shows the configured review hours");
  await click(page, "I understand. Continue");
  ok((await page.locator("#options button").first().innerText()) === "No. Don’t contact anyone", "permission to contact others is a separate question, with No first");
  await click(page, "No. Don’t contact anyone");

  const review = await page.locator(".review").innerText();
  ok(/HOW WE CAN HELP/i.test(review) && review.includes("student@example.com") && review.includes("No. Don’t contact anyone"), "review shows the request, contact details and permission");
  ok(Number(await count("reports")) === 0, "nothing is stored before Submit");
  await click(page, "Submit");
  ok((await page.locator(".review .error").innerText()).includes("confirm both"), "Submit needs both confirmations");
  await page.check("#consent-unofficial"); await page.check("#consent-share");
  await page.waitForTimeout(2600); // the server rejects forms completed implausibly fast
  await click(page, "Submit");
  await page.waitForSelector("#reference");
  advocacyId = await page.locator("#reference").innerText();
  ok(/^PR-\d+$/.test(advocacyId), "a reference number is shown after the server confirms: " + advocacyId);
  await shot(page, "receipt-phone");
  const receipt = await page.locator("#options").innerText();
  ok(receipt.includes("Received does not mean read") && receipt.includes("receipt, not a password"), "receipt says received is not reviewed, and is not a password");
  ok(receipt.includes("has not told the University"), "receipt says the University was not notified");

  ok(Number(await count("reports")) === 1, "exactly one report was stored");
  ok(await peek("select help || ',' || advocacy_requested || ',' || safety_flag || ',' || contact_requested || ',' || status from private.reports") === "advocate,true,true,true,new",
    "it is marked advocacy requested and safety-flagged, and is not auto-escalated or auto-assigned");
  ok(await peek("select report->>'external_contact' from private.reports") === "no", "no permission to contact others was recorded");
  await page.waitForTimeout(400);
  ok(await peek("select status || ',' || attempts from private.outbox") === "sent,1", "one outbox row, sent on the first attempt");
  const mail = await mailbox();
  ok(mail.length === 1 && mail[0].to === "reviewers@example.org" && mail[0].subject === "New Pride Report " + advocacyId, "one notification email to the reviewer mailbox");
  ok(mail[0].text.includes("Advocacy requested") && !/roster|student@example\.com|advising/.test(mail[0].text), "the email flags advocacy and contains nothing the student wrote");
  await page.context().close();
}

/* ---------- 3. Idempotency and email failure ---------- */
let incidentId;
{
  const page = await newPage();
  await page.goto(base + "/open/report.html");
  const report = { version: 3, safe: "yes", help: "report", narrative: "Fictional: a hostile sticker on a noticeboard.", categories: ["climate"], wants: ["document"],
    contact_want: "no", external_contact: "no" };
  const send = (idem) => page.evaluate(async ({ report, idem }) => {
    const res = await fetch("/functions/v1/submit-report", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ report, meta: { hp: "", elapsed_ms: 9000 }, idem, privacy_ack: true }) });
    return { status: res.status, body: await res.json() };
  }, { report, idem });

  await fetch(base + "/__test/mail-fails?on=1");
  const [a, b] = await Promise.all([send("e2e-idempotency-key-0001"), send("e2e-idempotency-key-0001")]);
  const c = await send("e2e-idempotency-key-0001");
  incidentId = a.body.id;
  ok(a.body.id === b.body.id && b.body.id === c.body.id && [a.status, b.status].sort().join() === "200,201" && c.status === 200, "the same request three times, two at once, is one report");
  ok(Number(await count("reports")) === 2 && Number(await count("outbox")) === 2, "one record and one outbox event per submission");
  ok(await peek(`select o.status || ',' || o.error_category from private.outbox o join private.reports r on r.id = o.report_id where r.public_id = '${incidentId}'`) === "queued,provider_error",
    "a failed email leaves the report stored and the notification queued for retry");
  ok((await mailbox()).length === 1, "no email was claimed as sent");
  // Exhaust the retries so the dashboard has a failure to show.
  await peek(`update private.outbox set status = 'failed', attempts = 6 where status = 'queued'`);

  const missing = await page.evaluate(async () => (await fetch("/functions/v1/submit-report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: {}, idem: "x".repeat(20) }) })).status);
  ok(missing === 400, "a malformed submission is rejected");
  await page.context().close();
}

/* ---------- 4. The public cannot read anything ---------- */
{
  const page = await newPage();
  await page.goto(base + "/open/admin/index.html");
  await page.waitForSelector("#email");
  const html = await page.content();
  ok(!html.includes(advocacyId) && !/roster|sticker/.test(html), "signed out: the dashboard page contains no case data");
  const probe = (fn, headers = {}) => page.evaluate(async ({ fn, headers }) => {
    const res = await fetch("/rest/v1/rpc/" + fn, { method: "POST", headers: { "content-type": "application/json", apikey: "test-anon-key", ...headers }, body: "{}" });
    return { status: res.status, text: await res.text() };
  }, { fn, headers });
  for (const fn of ["staff_list_reports", "staff_team", "staff_audit_log", "staff_mail_queue", "outbox_claim", "staff_me"]) {
    const r = await probe(fn);
    ok(r.status >= 400 && !r.text.includes(advocacyId), `public call to ${fn} is refused`);
  }
  const dispatch = await page.evaluate(async () => (await fetch("/functions/v1/send-notifications", { method: "POST", body: "{}" })).status);
  const invite = await page.evaluate(async () => (await fetch("/functions/v1/admin-users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.org", display_name: "X", role: "admin" }) })).status);
  ok(dispatch === 403 && invite === 403, "public calls to the staff-only functions are refused");

  await page.fill("#email", "reviewer@example.org"); await page.fill("#password", "wrong password");
  await click(page, "Sign in");
  await page.waitForFunction(() => document.querySelector(".error").textContent.length > 0);
  ok((await page.locator(".error").innerText()).includes("don’t match"), "a wrong password is refused");

  await page.fill("#email", "outsider@example.org"); await page.fill("#password", "correct horse battery 5");
  await click(page, "Sign in");
  await page.waitForSelector(".callout-warn");
  ok((await page.locator("#app").innerText()).includes("not on the reviewer team"), "an account that is not on the team is turned away");
  await page.context().close();
}

/* ---------- 5. Reviewer: own account, authenticator step, queue, access rules ---------- */
const reviewer = await newPage();
{
  const page = reviewer;
  await page.goto(base + "/open/admin/index.html");
  await page.fill("#email", "reviewer@example.org"); await page.fill("#password", "correct horse battery 2");
  await click(page, "Sign in");
  await page.waitForSelector("img.qr");
  await shot(page, "dashboard-enroll");
  ok((await page.locator("#app").innerText()).includes("Set up your second sign-in step"), "first sign-in requires setting up an authenticator");
  ok(!(await page.locator("#app").innerText()).includes(incidentId), "no cases are shown before the second step");
  const early = await page.evaluate(async () => {
    const token = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.includes("auth-token")))).access_token;
    const res = await fetch("/rest/v1/rpc/staff_list_reports", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: "{}" });
    return res.status;
  });
  ok(early === 403, "with a password but no second factor, the API itself refuses to list cases");
  await page.fill("#mfa-code", "000000"); await click(page, "Finish setup");
  await page.waitForFunction(() => document.querySelector(".error").textContent.length > 0);
  await page.fill("#mfa-code", "123456"); await click(page, "Finish setup");
  await page.waitForSelector(".inbox");
  ok((await page.locator(".dash-bar").innerText()).includes("Riley Reviewer") && (await page.locator(".dash-bar").innerText()).includes("reviewer"), "reviewer reaches the dashboard under their own name and role");
  ok((await page.locator("#app").innerText()).includes("on weekdays during the semester"), "review-hours banner shows the owner's configured hours");
  ok((await page.getByRole("tab").allInnerTexts()).join() === "Queue,Team", "reviewers get no admin tabs");

  const rows = page.locator(".inbox button");
  ok((await rows.count()) === 2, "the queue shows the two real cases, and nothing else");
  ok((await rows.first().innerText()).includes("Advocacy requested") && (await rows.first().innerText()).includes("Safety flag"), "the safety-flagged advocacy case is first and visibly marked");
  ok(await rows.first().isDisabled(), "a reviewer cannot open an advocacy case");
  ok((await rows.nth(1).innerText()).includes("Email failed"), "the failed notification is visible on its case");

  await page.selectOption("#type-filter", "advocacy");
  ok((await page.locator(".inbox button").count()) === 1, "filter: Advocacy requested");
  await page.selectOption("#type-filter", "report");
  ok((await page.locator(".inbox button").count()) === 1, "filter: Incident report");
  await page.selectOption("#type-filter", "peer");
  ok((await page.locator(".inbox").innerText()).includes("No cases match"), "filter: Peer support (none)");
  await page.selectOption("#type-filter", "all");

  await page.locator(".inbox button", { hasText: "Incident report" }).click();
  await page.waitForSelector("#case-h");
  const detail = await page.locator(".admin-grid .panel").nth(1).innerText();
  ok(detail.includes("Fictional: a hostile sticker on a noticeboard."), "case detail shows the student's words unedited");
  ok(detail.includes("NOT PERMITTED") && detail.includes("asked not to be contacted"), "permission flags are shown prominently");
  ok(await page.locator("#status-select").isDisabled(), "status cannot be changed before claiming");
  await click(page, "Claim this case");
  await page.waitForFunction(() => !document.querySelector("#status-select").disabled);
  ok(await page.locator("#status-select").inputValue() === "in_review", "claiming assigns the case and moves it to In review");
  await page.fill("#note-box", "Fictional note: logged for the facilities pattern."); await click(page, "Save note");
  await page.waitForFunction(() => document.querySelector(".thread").textContent.includes("Fictional note"));
  ok((await page.locator(".thread").first().innerText()).includes("Riley Reviewer"), "internal notes are attributed to the reviewer");
  ok(await page.locator("#contact-note").count() === 0, "no contact form is offered when the student declined contact");
  await page.selectOption("#status-select", "awaiting_follow_up");
  await page.waitForTimeout(400);
  ok(await peek(`select status from private.reports where public_id = '${incidentId}'`) === "awaiting_follow_up", "the status change is stored");
  const log = await peek(`select string_agg(action, ',' order by id) from private.audit_log where public_id = '${incidentId}'`);
  ok(["read", "claimed", "note", "status"].every((a) => log.includes(a)), "read, claim, note and status change are all in the audit log: " + log);
  ok(await page.getByRole("button", { name: "Delete this case" }).count() === 0, "reviewers get no delete or restrict controls");
  const forbidden = await page.evaluate(async (id) => {
    const token = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.includes("auth-token")))).access_token;
    const call = async (fn, body) => (await fetch("/rest/v1/rpc/" + fn, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) })).status;
    return [await call("staff_delete_report", { p_public_id: id }), await call("staff_audit_log", {}), await call("staff_admin_update", { p_user_id: "00000000-0000-0000-0000-000000000002", p_role: "admin", p_active: true })];
  }, incidentId);
  ok(forbidden.every((s) => s === 403), "calling admin functions directly as a reviewer is refused by the API");
}

/* ---------- 6. Admin: second login at the same time, mail retry, assignment, team ---------- */
{
  const page = await newPage();
  await page.goto(base + "/open/admin/index.html");
  await page.fill("#email", "admin@example.org"); await page.fill("#password", "correct horse battery 1");
  await click(page, "Sign in");
  await page.waitForSelector("#mfa-code");
  ok((await page.locator("#app").innerText()).includes("Enter your code"), "an enrolled account is asked for its authenticator code");
  await page.fill("#mfa-code", "123456"); await click(page, "Continue");
  await page.waitForSelector(".inbox");
  ok((await page.getByRole("tab").allInnerTexts()).join() === "Queue,Team,Email delivery,Activity log", "admins get the admin tabs");
  ok(await reviewer.locator(".dash-bar").isVisible(), "two people are signed in at once with separate accounts");

  await page.locator(".tabs button", { hasText: "All (" }).click();
  ok(!(await page.locator(".inbox button").first().isDisabled()), "an admin can open the advocacy case");
  await page.locator(".inbox button").first().click();
  await page.waitForSelector("#case-h");
  const detail = await page.locator(".admin-grid .panel").nth(1).innerText();
  await shot(page, "dashboard-case");
  ok(detail.includes("Advocacy requested. This is not consent") && detail.includes("BE DISCREET") && detail.includes("student@example.com"), "advocacy case: consent warning, discretion flag and contact email");
  ok(detail.includes("advising meeting on the 14th"), "the deadline the student mentioned is shown");
  await page.selectOption("#assign-select", { label: "Riley Reviewer (reviewer)" });
  await page.waitForSelector(".callout-warn[role=alert]");
  ok((await page.locator(".callout-warn[role=alert]").innerText()).includes("advocate or an admin"), "an advocacy case cannot be assigned to a plain reviewer");
  await page.selectOption("#assign-select", { label: "Avery Advocate (advocate)" });
  await page.waitForTimeout(500);
  ok(await peek(`select private.staff_name(assigned_to) from private.reports where public_id = '${advocacyId}'`) === "Avery Advocate", "it can be assigned to an advocate");
  await page.fill("#contact-note", "Fictional: wrote from the team mailbox with a neutral subject."); await click(page, "Log attempt");
  await page.waitForTimeout(500);
  ok(await peek(`select follow_up_channel from private.reports where public_id = '${advocacyId}'`) === "email", "a contact attempt is logged on the case");

  // Email delivery: retry the failed notification and send it.
  await fetch(base + "/__test/mail-fails?on=0");
  await page.getByRole("tab", { name: "Email delivery" }).click();
  await page.waitForSelector("table");
  ok((await page.locator("table").innerText()).includes("failed") && (await page.locator("table").innerText()).includes("provider_error"), "the mail queue shows the failed notification and why");
  await click(page, "Retry");
  await page.waitForTimeout(500);
  await page.getByRole("tab", { name: "Email delivery" }).click();
  await click(page, "Send due emails now");
  await page.waitForFunction(() => /Sent 1/.test(document.querySelector("#app").textContent));
  const mail = await mailbox();
  ok(mail.length === 2 && mail[1].subject === "New Pride Report " + incidentId && !mail[1].text.includes("sticker"), "the retried notification is delivered, still without the narrative");
  ok(await peek(`select count(*) from private.outbox where status = 'sent'`) === 2, "both notifications are now recorded as sent");

  // Team: invite, then remove the reviewer's access while they are signed in.
  await page.getByRole("tab", { name: "Team" }).click();
  await page.fill("#invite-email", "new.person@example.org"); await page.fill("#invite-name", "Nico New"); await page.selectOption("#invite-role", "reviewer");
  await click(page, "Send invitation");
  await page.waitForFunction(() => document.querySelector("table").textContent.includes("Nico New"));
  ok(await peek("select role || ',' || active from private.staff where email = 'new.person@example.org'") === "reviewer,true", "an invited person is added to the team with the chosen role");

  page.on("dialog", (d) => d.accept());
  await page.locator("tr", { hasText: "Riley Reviewer" }).getByRole("button", { name: "Remove access" }).click();
  await page.waitForFunction(() => /Access removed/.test(document.querySelector("table").textContent));
  await reviewer.getByRole("button", { name: "Refresh" }).click();
  await reviewer.waitForSelector("#email");
  ok((await reviewer.locator("#app").innerText()).includes("access has ended"), "the removed reviewer is signed out on their next action");
  ok(await peek(`select assigned_to is null from private.reports where public_id = '${incidentId}'`) === "t", "their open case is released for reassignment");

  await page.getByRole("tab", { name: "Activity log" }).click();
  await page.waitForSelector("table");
  const activity = await page.locator("table").innerText();
  ok(["read", "claimed", "assigned", "contact attempt", "email retry", "staff invited", "staff updated"].every((a) => activity.includes(a)), "the activity log shows who did what");
  ok(!/sticker|roster/.test(activity), "the activity log contains nothing a student wrote");
  await page.context().close();

  // The invited person follows their link, must choose a password, then set up an authenticator.
  const invited = await newPage();
  await invited.goto(await (await fetch(base + "/__test/invite-link?email=new.person@example.org")).text());
  await invited.waitForSelector("#new-password");
  await invited.fill("#new-password", "short"); await invited.fill("#new-password-2", "short"); await click(invited, "Save password");
  ok((await invited.locator(".error").innerText()).includes("at least 12"), "a short password is refused");
  await invited.fill("#new-password", "a much longer passphrase 7"); await invited.fill("#new-password-2", "a much longer passphrase 7"); await click(invited, "Save password");
  await invited.waitForSelector("img.qr");
  ok(true, "an invited person chooses a password and is then required to set up an authenticator");
  await invited.context().close();
}

/* ---------- 7. Layout: no sideways scrolling on a phone, served under a subpath ---------- */
{
  const page = await newPage({ width: 360, height: 740 });
  for (const path of ["index.html", "report.html", "resources.html", "about.html", "privacy.html", "contact.html", "track.html", "admin/index.html"]) {
    await page.goto(base + "/open/" + path); await page.waitForTimeout(120);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `no sideways scroll at 360px on ${path}`);
  }
  await page.goto(base + "/open/resources.html");
  await page.fill("#q", "title ix");
  ok((await page.locator("#resource-groups").innerText()).includes("Title IX") && !(await page.locator("#resource-groups").innerText()).includes("Myatt"), "resource search narrows the list");
  ok(!(await page.locator("#resource-groups").innerText()).includes("Residential Life"), "records without verified contact details are not shown");
  await page.goto(base + "/closed/privacy.html");
  ok((await page.locator("main").innerText()).includes("TO BE CONFIRMED"), "closed site shows undecided policies as TO BE CONFIRMED");
  await page.context().close();
}

await browser.close();
if (errors.length) throw new Error("Browser errors: " + JSON.stringify(errors));
console.log(`ALL END-TO-END CHECKS PASSED (${passed})`);
