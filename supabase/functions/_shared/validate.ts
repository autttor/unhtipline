// Validation and hashing. Pure functions with no Deno or network dependencies, so the same file is
// exercised by `node --test` (see tests/backend.test.js).
//
// The allowed values below must match assets/js/flow.js; tests/consistency.test.js fails if they drift.

export const ALLOWED: Record<string, readonly string[]> = {
  safe: ["yes", "no", "unsure"],
  help: ["report", "office", "peer", "advocate", "info", "other"],
  // Branch A: I need to report something
  categories: ["harassment", "discrimination", "identity", "housing", "academics", "facilities", "safety", "online", "climate", "other", "unsure"],
  where: ["residence", "academic", "common", "office", "athletics", "online", "off_campus", "campus_wide", "prefer_not"],
  when: ["recent", "week", "month", "earlier", "prefer_not"],
  frequency: ["once", "repeated", "unsure", "prefer_not"],
  ongoing: ["yes", "no", "unsure", "prefer_not"],
  wants: ["document", "resources", "listen", "advocacy", "office", "other"],
  // Branch B: I need help with a University office
  office: ["housing", "records", "health", "financial", "student_affairs", "title_ix", "public_safety", "athletics", "academic", "dont_know"],
  contacted: ["no", "yes", "prefer_not"],
  assist: ["identify", "explain", "draft", "prepare", "accompany", "other"],
  // Branches B and D
  deadline: ["none", "days", "weeks", "unsure"],
  // Branch C: I need peer support
  peer_kind: ["listen", "community", "resources", "navigate", "other"],
  // Branch D: I need an advocate
  advocacy_kind: ["options", "draft", "attend", "general", "other"],
  // Branch E: I need information or resources
  topic: ["reporting", "housing", "title_ix", "community", "mental_health", "safety", "other"],
  // Branch F: Something else
  next_steps: ["listen", "resources", "office", "advocacy", "document", "unsure"],
  // Contact and permissions
  contact_want: ["yes", "no"],
  contact_discreet: ["ok", "discreet"],
  external_contact: ["no", "ask", "anonymous", "named"],
};

// Which questions belong to which kind of help. Answers to another branch's questions are discarded.
export const BRANCH_FIELDS: Record<string, readonly string[]> = {
  report: ["categories", "where", "when", "frequency", "ongoing", "wants"],
  office: ["office", "contacted", "contact_summary", "deadline", "assist"],
  peer: ["peer_kind"],
  advocate: ["outcome", "deadline", "advocacy_kind"],
  info: ["topic"],
  other: ["next_steps"],
};

export const MULTI_FIELDS: readonly string[] = ["categories", "wants", "assist", "peer_kind", "advocacy_kind", "next_steps"];
export const CHOICE_FIELDS: readonly string[] = ["where", "when", "frequency", "ongoing", "office", "contacted", "deadline", "topic"];
// Choice questions where the student may type their own words instead of picking an option.
export const FREE_TEXT_CHOICES: readonly string[] = ["where", "when", "office", "deadline"];

export const LIMITS = { longText: 4000, mediumText: 2000, scope: 500, choiceText: 300, name: 120, email: 254, bodyBytes: 32768 };

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Choice = { value: string; text?: string } | null;
export type Report = {
  version: 3;
  safe: string;
  help: string;
  narrative: string | null;
  categories: string[]; where: Choice; when: Choice; frequency: Choice; ongoing: Choice; wants: string[];
  office: Choice; contacted: Choice; contact_summary: string | null; assist: string[];
  deadline: Choice;
  peer_kind: string[];
  outcome: string | null; advocacy_kind: string[];
  topic: Choice;
  next_steps: string[];
  contact_want: string; contact_email: string | null; contact_name: string | null; contact_discreet: Choice;
  external_contact: string; external_contact_scope: string | null;
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function cleanText(input: unknown, max: number, field: string): Result<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return fail(`${field}: must be text`);
  // Drop control characters other than tab and newline; keep everything else the student wrote.
  const text = input.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > max) return fail(`${field}: too long`);
  return { ok: true, value: text };
}

function cleanChoice(input: unknown, field: string): Result<Choice> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) return fail(`${field}: invalid`);
  const raw = input as Record<string, unknown>;
  if (raw.value === "other" && FREE_TEXT_CHOICES.includes(field)) {
    const text = cleanText(raw.text, LIMITS.choiceText, field);
    if (!text.ok) return text;
    if (!text.value) return fail(`${field}: empty`);
    return { ok: true, value: { value: "other", text: text.value } };
  }
  if (typeof raw.value !== "string" || !ALLOWED[field].includes(raw.value)) return fail(`${field}: unknown option`);
  return { ok: true, value: { value: raw.value } };
}

function cleanMulti(input: unknown, field: string): Result<string[]> {
  if (input === null || input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input) || input.some((v) => typeof v !== "string" || !ALLOWED[field].includes(v))) {
    return fail(`${field}: unknown option`);
  }
  // Canonical order, no duplicates.
  return { ok: true, value: ALLOWED[field].filter((v) => (input as string[]).includes(v)) };
}

/** True when the student asked for something that could involve contacting someone else on their behalf. */
export function needsExternalConsent(report: { help: string; wants?: string[]; next_steps?: string[] }): boolean {
  const asks = (list?: string[]) => !!list && (list.includes("advocacy") || list.includes("office"));
  return report.help === "office" || report.help === "advocate" || asks(report.wants) || asks(report.next_steps);
}

/** Returns a clean copy containing only known fields, or the first problem found. */
export function validateReport(input: unknown): Result<Report> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("report: invalid");
  const raw = input as Record<string, unknown>;
  if (raw.version !== 3) return fail("version: unsupported");
  for (const field of ["safe", "help", "contact_want"]) {
    if (typeof raw[field] !== "string" || !ALLOWED[field].includes(raw[field] as string)) return fail(`${field}: unknown option`);
  }
  const help = raw.help as string;
  const mine = BRANCH_FIELDS[help];

  const narrative = cleanText(raw.narrative, LIMITS.longText, "narrative");
  if (!narrative.ok) return narrative;

  const choices: Record<string, Choice> = {};
  for (const field of CHOICE_FIELDS) {
    const result = mine.includes(field) ? cleanChoice(raw[field], field) : { ok: true as const, value: null };
    if (!result.ok) return result;
    choices[field] = result.value;
  }
  const multi: Record<string, string[]> = {};
  for (const field of MULTI_FIELDS) {
    const result = mine.includes(field) ? cleanMulti(raw[field], field) : { ok: true as const, value: [] };
    if (!result.ok) return result;
    multi[field] = result.value;
  }

  const outcome = mine.includes("outcome") ? cleanText(raw.outcome, LIMITS.mediumText, "outcome") : { ok: true as const, value: null };
  if (!outcome.ok) return outcome;
  const summaryAsked = mine.includes("contact_summary") && choices.contacted?.value === "yes";
  const contactSummary = summaryAsked ? cleanText(raw.contact_summary, LIMITS.mediumText, "contact_summary") : { ok: true as const, value: null };
  if (!contactSummary.ok) return contactSummary;

  // Contact: an address is required to be contacted, and is discarded when contact was declined.
  let contactEmail: string | null = null;
  let contactName: string | null = null;
  let contactDiscreet: Choice = null;
  if (raw.contact_want === "yes") {
    const email = cleanText(raw.contact_email, LIMITS.email, "contact_email");
    if (!email.ok) return email;
    if (!email.value || !EMAIL_PATTERN.test(email.value)) return fail("contact_email: a valid email address is required to be contacted");
    const name = cleanText(raw.contact_name, LIMITS.name, "contact_name");
    if (!name.ok) return name;
    const discreet = cleanChoice(raw.contact_discreet, "contact_discreet");
    if (!discreet.ok) return discreet;
    contactEmail = email.value;
    contactName = name.value;
    contactDiscreet = discreet.value;
  }

  // Permission to contact anyone else defaults to "no", and can only be given where it was asked.
  const shape = { help, wants: multi.wants, next_steps: multi.next_steps };
  let external = "no";
  let scope: string | null = null;
  if (needsExternalConsent(shape) && raw.external_contact !== undefined && raw.external_contact !== null) {
    if (typeof raw.external_contact !== "string" || !ALLOWED.external_contact.includes(raw.external_contact)) {
      return fail("external_contact: unknown option");
    }
    external = raw.external_contact;
    if (external === "anonymous" || external === "named") {
      const cleaned = cleanText(raw.external_contact_scope, LIMITS.scope, "external_contact_scope");
      if (!cleaned.ok) return cleaned;
      scope = cleaned.value;
    }
  }

  return {
    ok: true,
    value: {
      version: 3,
      safe: raw.safe as string,
      help,
      narrative: narrative.value,
      categories: multi.categories, where: choices.where, when: choices.when, frequency: choices.frequency,
      ongoing: choices.ongoing, wants: multi.wants,
      office: choices.office, contacted: choices.contacted, contact_summary: contactSummary.value, assist: multi.assist,
      deadline: choices.deadline,
      peer_kind: multi.peer_kind,
      outcome: outcome.value, advocacy_kind: multi.advocacy_kind,
      topic: choices.topic,
      next_steps: multi.next_steps,
      contact_want: raw.contact_want as string, contact_email: contactEmail, contact_name: contactName, contact_discreet: contactDiscreet,
      external_contact: external, external_contact_scope: scope,
    },
  };
}

export function validateMessage(input: unknown): Result<string> {
  const text = cleanText(input, LIMITS.longText, "body");
  if (!text.ok) return text;
  if (!text.value) return fail("body: empty");
  return { ok: true, value: text.value };
}

// ---- Plain-text rendering (only used by the optional full-detail email) --------------------------

export const HELP_LABELS: Record<string, string> = {
  report: "Incident report",
  office: "Help with a University office",
  peer: "Peer support",
  advocate: "Advocacy requested",
  info: "Information or resources",
  other: "Something else",
};

const FIELD_LABELS: [keyof Report, string][] = [
  ["safe", "Safe right now"], ["help", "Request type"], ["narrative", "In their words"],
  ["categories", "Categories"], ["where", "Where"], ["when", "When"], ["frequency", "How often"], ["ongoing", "Still happening"],
  ["wants", "What they want to happen"], ["office", "Office or process"], ["contacted", "Already contacted the office"],
  ["contact_summary", "What happened when they did"], ["assist", "Assistance wanted"], ["deadline", "Deadline"],
  ["peer_kind", "Support wanted"], ["outcome", "Outcome hoped for"], ["advocacy_kind", "What advocacy means to them"],
  ["topic", "Topic"], ["next_steps", "Suggested next steps"],
  ["contact_want", "Wants to be contacted"], ["contact_email", "Email"], ["contact_name", "Name"],
  ["contact_discreet", "OK to mention Pride Report"],
  ["external_contact", "Permission to contact others"], ["external_contact_scope", "Who and what"],
];

function plain(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length ? value.map((v) => String(v).replace(/_/g, " ")).join(", ") : null;
  if (typeof value === "object") {
    const choice = value as { value: string; text?: string };
    return choice.value === "other" ? (choice.text ?? "other") : choice.value.replace(/_/g, " ");
  }
  return String(value).replace(/_/g, " ");
}

/** The report as "Label: value" lines, skipping unanswered questions. Free text is kept verbatim. */
export function reportToText(report: Report): string {
  const lines: string[] = [];
  const verbatim = ["narrative", "outcome", "contact_summary", "external_contact_scope", "contact_email", "contact_name"];
  for (const [key, label] of FIELD_LABELS) {
    const raw = report[key];
    const text = verbatim.includes(key) ? (raw as string | null) : key === "help" ? HELP_LABELS[raw as string] : plain(raw);
    if (text === null || text === undefined || text === "") continue;
    lines.push(key === "narrative" || key === "outcome" || key === "contact_summary" ? `${label}:\n${text}\n` : `${label}: ${text}`);
  }
  return lines.join("\n");
}

// ---- Earlier tracking codes (kept so students who already hold one can still use it) -------------

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 12;

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  let s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("PR")) s = s.slice(2);
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return `PR-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** HMAC-SHA-256 as lower-case hex. Used for idempotency keys, rate-limit buckets and earlier access codes. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two secrets without leaking where they differ. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([hmacHex("compare", a), hmacHex("compare", b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
