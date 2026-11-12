// Validation, access codes and hashing. Pure functions with no Deno or network dependencies, so the
// same file is exercised by `node --test` (see tests/backend.test.js).
//
// The allowed values below must match assets/js/flow.js; tests/consistency.test.js fails if they drift.

export const ALLOWED: Record<string, readonly string[]> = {
  needs: ["advocate", "office", "support", "conflict", "official", "document", "unsure"],
  advocate_consent: ["ask_first", "without_name", "with_name", "unsure"],
  office_which: ["housing", "records", "health", "financial", "student_affairs", "title_ix", "public_safety", "athletics", "academic", "unsure"],
  support_kind: ["talk", "accompany", "resources", "checkin", "unsure"],
  conflict_with: ["roommate", "student", "group", "faculty", "staff", "unsure"],
  conflict_contact: ["ok", "ask_first", "no", "unsure"],
  path: ["incident", "concern"],
  category: ["harassment", "discrimination", "deadnaming", "housing", "academics", "facilities", "climate", "unsure"],
  when: ["recent", "week", "month", "earlier", "unsure"],
  where: ["residence", "academic", "common", "office", "athletics", "online", "off_campus", "campus_wide", "unsure"],
  who: ["student", "faculty", "staff", "non_affiliated", "unknown"],
  frequency: ["once", "repeated", "ongoing", "unsure"],
  role: ["experienced", "witnessed", "heard"],
  reported: ["yes", "no", "unsure"],
  timing: ["none", "days", "weeks", "unsure"],
  contact_mode: ["anonymous", "portal", "identified"],
  contact_discreet: ["ok", "discreet"],
};

// The kinds of direct help. A report that asks for any of these needs a reply.
export const HELP_NEEDS: readonly string[] = ["advocate", "office", "support", "conflict"];

// Choice questions where the student may type their own words instead of picking an option.
export const FREE_TEXT_CHOICES: readonly string[] = ["office_which", "category", "when", "where", "timing"];

export const LIMITS = { longText: 4000, outcome: 2000, choiceText: 300, name: 120, contact: 200, bodyBytes: 32768 };

export type Choice = { value: string; text?: string } | null;
export type Report = {
  version: 2;
  needs: string[];
  advocate_consent: Choice; office_which: Choice; support_kind: Choice; conflict_with: Choice; conflict_contact: Choice;
  path: string;
  category: Choice; what: string | null; when: Choice; where: Choice; who: Choice;
  frequency: Choice; role: Choice; reported: Choice;
  outcome: string | null; timing: Choice; anything_else: string | null;
  contact_mode: string; contact_name: string | null; contact_method: string | null; contact_discreet: Choice;
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
  if (raw.value === "other") {
    if (!FREE_TEXT_CHOICES.includes(field)) return fail(`${field}: free text not allowed`);
    const text = cleanText(raw.text, LIMITS.choiceText, field);
    if (!text.ok) return text;
    if (!text.value) return fail(`${field}: empty`);
    return { ok: true, value: { value: "other", text: text.value } };
  }
  if (typeof raw.value !== "string" || !ALLOWED[field].includes(raw.value)) return fail(`${field}: unknown option`);
  return { ok: true, value: { value: raw.value } };
}

/** Returns a clean copy containing only known fields, or the first problem found. */
export function validateReport(input: unknown): Result<Report> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("report: invalid");
  const raw = input as Record<string, unknown>;
  if (raw.version !== 2) return fail("version: unsupported");
  if (typeof raw.path !== "string" || !ALLOWED.path.includes(raw.path)) return fail("path: unknown option");
  if (typeof raw.contact_mode !== "string" || !ALLOWED.contact_mode.includes(raw.contact_mode)) {
    return fail("contact_mode: unknown option");
  }

  if (!Array.isArray(raw.needs) || raw.needs.some((n) => typeof n !== "string" || !ALLOWED.needs.includes(n))) {
    return fail("needs: unknown option");
  }
  const needsRaw = raw.needs as string[];
  const needs = ALLOWED.needs.filter((n) => needsRaw.includes(n));
  if (!needs.length) return fail("needs: choose at least one");

  const choices: Record<string, Choice> = {};
  for (const field of ["advocate_consent", "office_which", "support_kind", "conflict_with", "conflict_contact",
    "category", "when", "where", "who", "frequency", "role", "reported", "timing", "contact_discreet"]) {
    const result = cleanChoice(raw[field], field);
    if (!result.ok) return result;
    choices[field] = result.value;
  }

  const what = cleanText(raw.what, LIMITS.longText, "what");
  if (!what.ok) return what;
  const outcome = cleanText(raw.outcome, LIMITS.outcome, "outcome");
  if (!outcome.ok) return outcome;
  const anythingElse = cleanText(raw.anything_else, LIMITS.longText, "anything_else");
  if (!anythingElse.ok) return anythingElse;

  let contactName: string | null = null;
  let contactMethod: string | null = null;
  const identified = raw.contact_mode === "identified";
  if (identified) {
    const name = cleanText(raw.contact_name, LIMITS.name, "contact_name");
    if (!name.ok) return name;
    const method = cleanText(raw.contact_method, LIMITS.contact, "contact_method");
    if (!method.ok) return method;
    if (!method.value) return fail("contact_method: required when identified");
    contactName = name.value;
    contactMethod = method.value;
  }

  const incident = raw.path === "incident";
  const asked = (need: string) => needs.includes(need);
  return {
    ok: true,
    value: {
      version: 2,
      needs,
      // Follow-up answers are kept only for the kinds of help that were actually requested.
      advocate_consent: asked("advocate") ? choices.advocate_consent : null,
      office_which: asked("office") ? choices.office_which : null,
      support_kind: asked("support") ? choices.support_kind : null,
      conflict_with: asked("conflict") ? choices.conflict_with : null,
      conflict_contact: asked("conflict") ? choices.conflict_contact : null,
      path: raw.path,
      category: choices.category,
      what: what.value,
      // Questions the "concern" path never asks are dropped rather than trusted.
      when: incident ? choices.when : null,
      where: choices.where,
      who: incident ? choices.who : null,
      frequency: choices.frequency,
      role: incident ? choices.role : null,
      reported: incident ? choices.reported : null,
      outcome: outcome.value,
      timing: choices.timing,
      anything_else: anythingElse.value,
      contact_mode: raw.contact_mode,
      contact_name: contactName,
      contact_method: contactMethod,
      contact_discreet: identified ? choices.contact_discreet : null,
    },
  };
}

export function validateMessage(input: unknown): Result<string> {
  const text = cleanText(input, LIMITS.longText, "body");
  if (!text.ok) return text;
  if (!text.value) return fail("body: empty");
  return { ok: true, value: text.value };
}

// ---- Plain-text rendering for the emailed copy --------------------------------------------------

const FIELD_LABELS: [keyof Report, string][] = [
  ["needs", "What we can do for you"], ["advocate_consent", "How to advocate"], ["office_which", "Office or service"],
  ["support_kind", "Kind of support"], ["conflict_with", "Conflict with"], ["conflict_contact", "Involving the other person"],
  ["path", "About"], ["category", "Category"], ["what", "In their words"], ["when", "When"], ["where", "Where"],
  ["who", "Who was involved"], ["frequency", "How often"], ["role", "Connection to it"], ["reported", "Reported to the University"],
  ["outcome", "A good outcome"], ["timing", "Deadline or date"], ["anything_else", "Anything else"],
  ["contact_mode", "Submitted as"], ["contact_name", "Name"], ["contact_method", "Contact"],
  ["contact_discreet", "OK to mention Pride Report"],
];

function plain(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => String(v).replace(/_/g, " ")).join(", ");
  if (typeof value === "object") {
    const choice = value as { value: string; text?: string };
    return choice.value === "other" ? (choice.text ?? "other") : choice.value.replace(/_/g, " ");
  }
  return String(value);
}

/** The report as "Label: value" lines, skipping unanswered questions. Free text is kept verbatim. */
export function reportToText(report: Report): string {
  const lines: string[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const text = plain(report[key]);
    if (text === null || key === "version") continue;
    const freeText = key === "what" || key === "outcome" || key === "anything_else";
    lines.push(freeText ? `${label}:\n${text}\n` : `${label}: ${text}`);
  }
  return lines.join("\n");
}

// ---- Access codes -------------------------------------------------------------------------------
// 12 symbols from a 30-symbol alphabet (no 0/O, 1/I/L, U): about 59 bits. Same scheme as store.js.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 12;

function formatCode(symbols: string): string {
  return `PR-${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8, 12)}`;
}

export function generateCode(): string {
  let out = "";
  const bytes = new Uint8Array(32);
  let i = bytes.length;
  while (out.length < CODE_LENGTH) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i++];
    // Rejection sampling (240 = 8 x 30) keeps every symbol equally likely.
    if (b < 240) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return formatCode(out);
}

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  let s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("PR")) s = s.slice(2);
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return formatCode(s);
}

/** HMAC-SHA-256 as lower-case hex. Used for access-code hashes and rate-limit buckets. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
