// HTTP handlers. Everything they need from the outside world arrives through `Deps`, so tests run
// them against a fake database and the sandbox mail provider (tests/backend.test.js).

import { EMAIL_PATTERN, HELP_LABELS, hmacHex, LIMITS, normalizeCode, reportToText, sameSecret, validateMessage, validateReport } from "./validate.ts";
import type { Report } from "./validate.ts";
import { MailError } from "./mail.ts";
import type { MailProvider } from "./mail.ts";

export type StaffIdentity = { user_id: string; role: string; is_staff: boolean; mfa_ok: boolean };

export type Deps = {
  /** Calls a Postgres function with the service role and returns its JSON result. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  /** Secret used for idempotency keys and rate-limit buckets. Never sent to the browser. */
  pepper: string;
  /** Exact origin of the website, e.g. "https://example.github.io". */
  allowedOrigin: string;
  /** Reviewer mailbox(es) that are told when a report arrives. Server-side only. */
  recipients: string[];
  /** null when no mail provider is configured: reports are still stored and the outbox shows the failure. */
  mail: MailProvider | null;
  mailFrom: string;
  /** false (default): emails carry the reference number and flags only. true: the full report. */
  includeDetails: boolean;
  /** Link to the reviewer dashboard, placed in notification emails. */
  dashboardUrl: string;
  /** Shared secret for the scheduled job that drains the outbox. */
  dispatchSecret: string;
  /** Resolves the caller's staff identity from their Authorization header, or null. */
  verifyStaff?: (authorization: string) => Promise<StaffIdentity | null>;
  /** Creates (invites) a sign-in account and returns its id. */
  inviteUser?: (email: string) => Promise<{ user_id: string } | { error: string }>;
  /** Runs work after the response has been sent, where the runtime supports it. */
  background?: (work: Promise<unknown>) => void;
  now?: () => Date;
};

function headers(deps: Deps): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": deps.allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(deps: Deps, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(deps) });
}

/** Shared request checks. Returns a Response to send immediately, or the parsed JSON body. */
async function open(req: Request, deps: Deps): Promise<Response | Record<string, unknown>> {
  if (!deps.pepper || deps.pepper.length < 32 || !deps.allowedOrigin) {
    // Refuse to run half-configured rather than accept reports that can't be handled properly.
    return json(deps, 500, { error: "server_not_configured" });
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== deps.allowedOrigin) return json(deps, 403, { error: "forbidden_origin" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(deps) });
  if (req.method !== "POST") return json(deps, 405, { error: "method_not_allowed" });

  const text = await req.text();
  if (new TextEncoder().encode(text).length > LIMITS.bodyBytes) return json(deps, 413, { error: "too_large" });
  if (!text) return {};
  try {
    const body = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    return json(deps, 400, { error: "invalid_json" });
  }
}

/**
 * Rate-limit key: a keyed hash of the caller's IP and today's date. The raw IP is never stored, and
 * because the date is mixed in, yesterday's key can't be linked to today's.
 */
async function bucket(req: Request, deps: Deps): Promise<string> {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  const day = (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10);
  return await hmacHex(deps.pepper, `ip|${day}|${ip}`);
}

function rpcFailure(deps: Deps, data: unknown, error: unknown): Response | null {
  if (error) {
    console.error("database error", error);
    return json(deps, 500, { error: "server_error" });
  }
  const code = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  if (code === "rate_limited") return json(deps, 429, { error: "rate_limited" });
  if (code === "not_found") return json(deps, 404, { error: "not_found" });
  if (code === "messaging_disabled" || code === "closed") return json(deps, 409, { error: code });
  if (code) return json(deps, 400, { error: String(code) });
  return null;
}

// ---- Submission -----------------------------------------------------------------------------------

export async function handleSubmit(req: Request, deps: Deps): Promise<Response> {
  const body = await open(req, deps);
  if (body instanceof Response) return body;

  // Cheap bot filters: a hidden field humans never fill in, and a minimum time to complete the form.
  const meta = (body.meta && typeof body.meta === "object" ? body.meta : {}) as Record<string, unknown>;
  if (meta.hp) return json(deps, 400, { error: "rejected" });
  if (typeof meta.elapsed_ms !== "number" || meta.elapsed_ms < 3000) return json(deps, 400, { error: "rejected" });

  // The browser makes one random key per report. Sending the same key again can never create a
  // second report or a second notification.
  if (typeof body.idem !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(body.idem)) return json(deps, 400, { error: "invalid_request" });
  if (body.privacy_ack !== true) return json(deps, 400, { error: "privacy_not_acknowledged" });

  const report = validateReport(body.report);
  if (!report.ok) return json(deps, 400, { error: "invalid_report", detail: report.error });

  const { data, error } = await deps.rpc("submit_report", {
    p_idem_hash: await hmacHex(deps.pepper, `idem|${body.idem}`),
    p_report: report.value,
    p_bucket: await bucket(req, deps),
    p_recipients: deps.recipients,
  });
  const failure = rpcFailure(deps, data, error);
  if (failure) return failure;
  const stored = data as { id: string; received_at: string; duplicate: boolean };
  if (!stored || typeof stored.id !== "string") return json(deps, 500, { error: "server_error" });

  // The report is committed. Email is a separate step: it is attempted now, and whatever happens
  // is recorded in the outbox for retry. The student's receipt never depends on it.
  const work = dispatchOutbox(deps, 10).catch((e) => console.error("dispatch failed", e));
  if (deps.background) deps.background(work);
  else await work;

  return json(deps, stored.duplicate ? 200 : 201, { id: stored.id, received_at: stored.received_at });
}

// ---- Email outbox ---------------------------------------------------------------------------------

type Claimed = {
  outbox_id: number; recipient: string; kind: string; attempt: number; id: string; received_at: string; help: string | null;
  advocacy_requested: boolean; safety_flag: boolean; has_deadline: boolean; contact_requested: boolean; report: Report | null;
};

/** The notification email. By default it carries the reference number and triage flags, and nothing the student wrote. */
export function notificationFor(row: Claimed, deps: Pick<Deps, "includeDetails" | "dashboardUrl">): { subject: string; text: string } {
  const lines = [
    `A new submission is waiting in the Pride Line reviewer dashboard.`,
    ``,
    `Reference: ${row.id}`,
    `Request type: ${HELP_LABELS[row.help ?? ""] ?? "Not recorded"}`,
  ];
  if (row.advocacy_requested) lines.push("Advocacy requested: yes. Route to someone authorized to handle advocacy.");
  if (row.safety_flag) lines.push("Safety: the student did not say they were safe, or chose the safety category. Review promptly.");
  if (row.has_deadline) lines.push("The student mentioned a deadline.");
  lines.push(row.contact_requested ? "The student asked to be contacted." : "The student did not ask to be contacted.");
  lines.push("", deps.dashboardUrl ? `Open the dashboard: ${deps.dashboardUrl}` : "Sign in to the reviewer dashboard to read it.");
  if (deps.includeDetails && row.report) {
    lines.push("", "----", reportToText(row.report), "----",
      "This email contains a confidential student report. Do not forward it or copy it elsewhere.");
  } else {
    lines.push("", "For privacy, nothing the student wrote is included in this email.");
  }
  // The subject shows up in notifications and on lock screens, so it never carries details.
  return { subject: `New Pride Line ${row.id}`, text: lines.join("\n") };
}

export type DispatchSummary = { claimed: number; sent: number; requeued: number; failed: number };

/** Sends whatever is due in the outbox. Safe to run concurrently: rows are claimed before sending. */
export async function dispatchOutbox(deps: Deps, limit: number): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, requeued: 0, failed: 0 };
  const { data, error } = await deps.rpc("outbox_claim", { p_limit: limit, p_include_details: deps.includeDetails });
  if (error || !Array.isArray(data)) {
    if (error) console.error("outbox_claim failed", error);
    return summary;
  }
  for (const row of data as Claimed[]) {
    summary.claimed++;
    let ok = false;
    let providerId: string | null = null;
    let category: string | null = null;
    try {
      if (!deps.mail) throw new MailError("not_configured", "no mail provider configured");
      const mail = notificationFor(row, deps);
      const result = await deps.mail.send({
        to: row.recipient, from: deps.mailFrom, subject: mail.subject, text: mail.text,
        idempotencyKey: `pride-report-${row.outbox_id}`,
      });
      ok = true;
      providerId = result.id;
    } catch (e) {
      category = e instanceof MailError ? e.category : "provider_error";
      console.error("email not sent", row.id, category);
    }
    const marked = await deps.rpc("outbox_mark", {
      p_outbox_id: row.outbox_id, p_ok: ok, p_provider_message_id: providerId, p_error_category: category,
    });
    if (marked.data === "sent") summary.sent++;
    else if (marked.data === "failed") summary.failed++;
    else if (marked.data === "queued") summary.requeued++;
  }
  return summary;
}

async function staffFrom(req: Request, deps: Deps): Promise<StaffIdentity | null> {
  const authorization = req.headers.get("authorization") || "";
  if (!deps.verifyStaff || !/^Bearer .+/.test(authorization)) return null;
  const who = await deps.verifyStaff(authorization);
  return who && who.is_staff && who.mfa_ok ? who : null;
}

/** POST /send-notifications. Run by a scheduled job (shared secret) or by an admin from the dashboard. */
export async function handleDispatch(req: Request, deps: Deps): Promise<Response> {
  const body = await open(req, deps);
  if (body instanceof Response) return body;
  const viaSecret = await sameSecret(req.headers.get("x-dispatch-secret") || "", deps.dispatchSecret);
  if (!viaSecret) {
    const who = await staffFrom(req, deps);
    if (!who || who.role !== "admin") return json(deps, 403, { error: "forbidden" });
  }
  return json(deps, 200, await dispatchOutbox(deps, 25));
}

// ---- Staff accounts -------------------------------------------------------------------------------

/** POST /admin-users { email, display_name, role }. Admins only. Sends the person an invitation to set a password. */
export async function handleAdminUsers(req: Request, deps: Deps): Promise<Response> {
  const body = await open(req, deps);
  if (body instanceof Response) return body;
  const who = await staffFrom(req, deps);
  if (!who || who.role !== "admin") return json(deps, 403, { error: "forbidden" });
  if (!deps.inviteUser) return json(deps, 500, { error: "server_not_configured" });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!EMAIL_PATTERN.test(email) || email.length > LIMITS.email) return json(deps, 400, { error: "invalid_email" });
  if (!name || name.length > 80) return json(deps, 400, { error: "invalid_name" });
  if (!["admin", "reviewer", "advocate"].includes(role)) return json(deps, 400, { error: "invalid_role" });

  const invited = await deps.inviteUser(email);
  if ("error" in invited) return json(deps, 409, { error: "invite_failed", detail: invited.error });

  const { error } = await deps.rpc("admin_upsert_staff", {
    p_actor: who.user_id, p_user_id: invited.user_id, p_email: email, p_display_name: name, p_role: role,
  });
  if (error) {
    console.error("admin_upsert_staff failed", error);
    return json(deps, 500, { error: "server_error" });
  }
  return json(deps, 201, { ok: true });
}

// ---- Earlier tracking codes -----------------------------------------------------------------------
// New reports no longer get an access code. This endpoint stays so that a student who was given one
// before can still read replies and add a message.

export async function handleTrack(req: Request, deps: Deps): Promise<Response> {
  const body = await open(req, deps);
  if (body instanceof Response) return body;

  const code = normalizeCode(body.code);
  // A malformed code gets the same answer as an unknown one, after the same rate-limit accounting.
  const hash = await hmacHex(deps.pepper, `code|${code || "invalid"}`);
  const key = await bucket(req, deps);

  if (body.action === "view") {
    const { data, error } = await deps.rpc("track_view", { p_code_hash: hash, p_bucket: key });
    return rpcFailure(deps, data, error) || json(deps, 200, data);
  }
  if (body.action === "message") {
    const message = validateMessage(body.body);
    if (!message.ok) return json(deps, 400, { error: "invalid_message", detail: message.error });
    const { data, error } = await deps.rpc("track_message", { p_code_hash: hash, p_body: message.value, p_bucket: key });
    return rpcFailure(deps, data, error) || json(deps, 200, data);
  }
  return json(deps, 400, { error: "unknown_action" });
}
