// Checks that hold across files: the browser script and the server validator agree, the public site
// carries no secrets or third-party requests, and house rules (no em dashes, Public Safety before
// 911, no telephony) are kept.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { flow, resources, root } from "./helpers.js";
import { ALLOWED, BRANCH_FIELDS, MULTI_FIELDS, FREE_TEXT_CHOICES, LIMITS, CODE_ALPHABET, HELP_LABELS } from "../supabase/functions/_shared/validate.ts";

const nodesFor = (field) => Object.values(flow.nodes).filter((n) => n.field === field && n.options);

test("option values match the server's allow-list", () => {
  for (const field of Object.keys(ALLOWED)) {
    const nodes = nodesFor(field);
    assert.ok(nodes.length, `flow.js has no question for "${field}"`);
    for (const node of nodes) assert.deepEqual(node.options.map((o) => o.value).sort(), [...ALLOWED[field]].sort(), field);
  }
});

test("branches, multi-select questions, free-text rules and length limits match", () => {
  assert.deepEqual(Object.keys(BRANCH_FIELDS).sort(), [...ALLOWED.help].sort());
  assert.deepEqual(Object.keys(flow.branchStart).sort(), [...ALLOWED.help].sort());
  assert.deepEqual(Object.keys(HELP_LABELS).sort(), Object.keys(flow.helpShort).sort());

  const multi = [...new Set(Object.values(flow.nodes).filter((n) => n.type === "multi").map((n) => n.field))];
  assert.deepEqual(multi.sort(), [...MULTI_FIELDS].sort());
  const typed = [...new Set(Object.values(flow.nodes).filter((n) => n.type === "choice" && n.allowText).map((n) => n.field))];
  assert.deepEqual(typed.sort(), [...FREE_TEXT_CHOICES].sort());
  for (const node of Object.values(flow.nodes)) if (node.type === "choice" && node.allowText) assert.equal(node.maxLength, LIMITS.choiceText);

  assert.equal(flow.maxLength, LIMITS.longText);
  assert.equal(flow.nodes.d_outcome.maxLength, LIMITS.mediumText);
  assert.equal(flow.nodes.b_summary.maxLength, LIMITS.mediumText);
  assert.equal(flow.nodes.consent_scope.maxLength, LIMITS.scope);
  assert.equal(flow.nodes.contact_name.maxLength, LIMITS.name);
  assert.equal(flow.nodes.contact_email.maxLength, LIMITS.email);

  // Every branch-specific field the server accepts is asked by that branch, and by no other.
  for (const [branch, fields] of Object.entries(BRANCH_FIELDS)) {
    const prefix = flow.branchStart[branch].slice(0, 2);
    for (const field of fields) {
      const askedBy = Object.entries(flow.nodes).filter(([, n]) => n.field === field).map(([id]) => id.slice(0, 2));
      assert.ok(askedBy.includes(prefix), `${branch} never asks for ${field}`);
    }
  }
});

test("browser and server use the same access-code alphabet", () => {
  assert.ok(readFileSync(root + "assets/js/store.js", "utf8").includes(`var CODE_ALPHABET = "${CODE_ALPHABET}"`));
});

/* ---------- Resources ---------- */

test("resource records are well formed, and unverified or empty ones are never published unless core", () => {
  const categories = resources.categories.map((c) => c.id);
  for (const r of resources.records) {
    assert.ok(r.id && r.name && r.what && r.source, r.id);
    assert.ok(categories.includes(r.category), `${r.id}: unknown category`);
    assert.match(r.source, /^https:\/\//, `${r.id}: source must be an https link`);
    assert.equal(typeof r.verified, "boolean", r.id);
    for (const c of r.contacts) assert.match(c.href, /^(tel:\+?\d+|mailto:[^@]+@[^@]+|https:\/\/)/, `${r.id}: ${c.href}`);
    if (!r.contacts.length) assert.ok(!resources.published(r), `${r.id}: a record with no contact details must not be shown`);
    if (!r.verified && !r.core) assert.ok(!resources.published(r), `${r.id}: unverified non-core records must not be shown`);
  }
  const everyTopic = [...ALLOWED.topic];
  for (const topic of everyTopic) for (const r of resources.forTopic(topic)) assert.ok(resources.published(r));
  assert.ok(resources.forTopic("safety").length >= 2);
  assert.deepEqual(resources.forTopic("safety").slice(0, 2).map((r) => r.id), ["public_safety", "emergency_911"], "Public Safety is listed before 911");
  assert.equal(resources.search("title ix").some((r) => r.id === "title_ix"), true);
  assert.equal(resources.search("zzzz").length, 0);
});

test("intake cannot open while a core contact is unverified", () => {
  assert.equal(resources.coreVerified(), resources.records.every((r) => !r.core || r.verified));
  const store = readFileSync(root + "assets/js/store.js", "utf8");
  assert.match(store, /coreVerified\(\)/);
  assert.match(store, /INTAKE_ENABLED !== true/);
  for (const key of ["REVIEW_HOURS", "RESPONSE_TIME", "RETENTION", "CONFIDENTIALITY_LIMITS", "CONTACT_EMAIL"]) assert.ok(store.includes(`"${key}"`), key);
});

test("the committed configuration is complete before intake is enabled", () => {
  const config = readFileSync(root + "assets/js/config.js", "utf8");
  if (/INTAKE_ENABLED: true/.test(config)) {
    for (const key of ["REVIEW_HOURS", "RESPONSE_TIME", "RETENTION", "CONFIDENTIALITY_LIMITS", "CONTACT_EMAIL"]) {
      assert.match(config, new RegExp(key + ': "[^"]+"'), `${key} must be filled in while intake is enabled`);
    }
    assert.match(config, /SUPABASE_URL: "https:\/\/[a-z0-9]+\.supabase\.co"/);
    assert.ok(resources.coreVerified(), "intake is enabled but a core contact is unverified");
  }
});

/* ---------- The public site ---------- */

const PAGES = ["index.html", "report.html", "resources.html", "about.html", "privacy.html", "contact.html", "track.html", "admin/index.html"];
const SCRIPTS = readdirSync(root + "assets/js").map((f) => "assets/js/" + f);
const DOCS = ["README.md", "SETUP.md", "docs/REVIEWER_CHECKLIST.md", ".env.example"];
const SITE_FILES = [...PAGES, "404.html", ...SCRIPTS];

function repoFiles(dir = "") {
  const out = [];
  for (const name of readdirSync(root + dir)) {
    if ([".git", "node_modules", "vendor"].includes(name)) continue;
    const path = dir + name;
    if (statSync(root + path).isDirectory()) out.push(...repoFiles(path + "/"));
    else if (/\.(html|js|mjs|ts|css|sql|md|sh|json|example)$/.test(name) || name === ".env.example") out.push(path);
  }
  return out;
}

test("no em dashes anywhere in the repository", () => {
  for (const file of repoFiles()) {
    readFileSync(root + file, "utf8").split("\n").forEach((line, i) => assert.ok(!line.includes("\u2014"), `${file}:${i + 1} has an em dash`));
  }
});

test("wherever both appear, University Public Safety is listed before 911", () => {
  for (const file of SITE_FILES) {
    const text = readFileSync(root + file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const block of text.split(/<\/p>|<\/ul>|\n\s*\n|\];|\},\s*\n/)) {
      const safety = block.search(/Public Safety|932-7070|\+12039327070/);
      const nine = block.search(/\b911\b/);
      if (safety !== -1 && nine !== -1) assert.ok(safety < nine, `${file}: 911 comes before Public Safety in: ${block.trim().slice(0, 90)}`);
    }
  }
});

test("the site makes no third-party requests, has no inline scripts or styles, and works under a subpath", () => {
  for (const page of PAGES) {
    const html = readFileSync(root + page, "utf8");
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/);
    assert.ok(csp, `${page} has no Content-Security-Policy`);
    assert.match(csp[1], /script-src 'self';/);
    assert.match(csp[1], /connect-src 'self' https:\/\/\*\.supabase\.co;/, `${page}: only Supabase may be contacted`);
    assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), `${page} has an inline script`);
    assert.ok(!/\sstyle="/.test(html) && !/<style/.test(html), `${page} has inline styles`);
    for (const [, url] of html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"/g)) {
      assert.ok(!/^(https?:)?\/\//.test(url), `${page} loads ${url} from another origin`);
    }
    // GitHub Pages serves this site under /unhtipline/, so no link may start at the domain root.
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(!url.startsWith("/"), `${page}: root-relative link ${url}`);
  }
});

test("public files contain no secrets, no reviewer mailbox, and no direct browser-to-email path", () => {
  for (const file of [...SITE_FILES, "assets/css/styles.css"]) {
    const text = readFileSync(root + file, "utf8");
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text), `${file} contains something shaped like a signed token`);
    assert.ok(!/sb_secret_|re_[A-Za-z0-9]{16,}/.test(text), `${file} contains something shaped like a secret key`);
    assert.ok(!/web3forms|formspree/i.test(text), `${file} still refers to a browser-to-email service`);
    assert.ok(!/EMAIL_TO|RESEND_API_KEY|CODE_PEPPER|DISPATCH_SECRET/.test(text), `${file} names a server-side secret`);
  }
  const config = readFileSync(root + "assets/js/config.js", "utf8");
  assert.ok(!/sb_secret_|service_role/.test(config), "only the public (anon or publishable) key may appear here");
});

test("the dashboard page ships no report data, and the old mock dashboard is gone", () => {
  const admin = readFileSync(root + "assets/js/admin.js", "utf8");
  assert.ok(!/\[Fictional\]|fict\(|admin\.seed|localStorage/.test(admin), "no seeded or browser-stored cases");
  assert.match(admin, /signInWithPassword/);
  assert.match(admin, /mfa\.challengeAndVerify/);
  assert.match(admin, /staff_open_report/);
  const store = readFileSync(root + "assets/js/store.js", "utf8");
  assert.ok(!/localStorage/.test(store), "there is no demo store that could fake a successful submission");
});

test("no telephone, text-message or IVR feature exists in code or documentation", () => {
  for (const file of repoFiles().filter((f) => !f.startsWith("tests/"))) {
    const text = readFileSync(root + file, "utf8");
    assert.ok(!/twilio|textfree|\bivr\b|\bpbx\b|\bsms\b|sms:|text-message|auto-reply|phone tree/i.test(text), `${file} mentions a telephony feature`);
  }
});

test("documentation the handoff requires exists", () => {
  for (const file of DOCS) assert.ok(statSync(root + file).size > 500, file);
});
