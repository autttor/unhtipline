// HTTP handlers for the two public endpoints. Everything they need from the outside world arrives
// through `Deps`, so tests can run them with a fake database (tests/backend.test.js).

import { generateCode, HELP_NEEDS, hmacHex, LIMITS, normalizeCode, reportToText, validateMessage, validateReport } from "./validate.ts";
import type { Report } from "./validate.ts";

export type Deps = {
  /** Calls a Postgres function with the service role and returns its JSON result. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  /** Secret used to hash access codes and IP addresses. Never sent to the browser. */
  pepper: string;
  /** Exact origin of the website, e.g. "https://example.github.io". */
  allowedOrigin: string;
  /** Optional: emails reviewers through Resend whenever a report or a student message arrives. */
  email?: {
    resendApiKey: string;
    /** Reviewer inbox(es). */
    to: string[];
    /** Sender, e.g. "Pride Report <reports@yourdomain.org>". */
    from: string;
    /** true: the email contains the full report. false: only the reference number. */
    includeDetails: boolean;
  };
  /** Optional: receives "new report" pings that contain the reference number and nothing else. */
  notifyWebhookUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

function headers(deps: Deps): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": deps.allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
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
    // Refuse to run half-configured rather than store weakly protected reports.
    return json(deps, 500, { error: "server_not_configured" });
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== deps.allowedOrigin) return json(deps, 403, { error: "forbidden_origin" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(deps) });
  if (req.method !== "POST") return json(deps, 405, { error: "method_not_allowed" });

  const text = await req.text();
  if (new TextEncoder().encode(text).length > LIMITS.bodyBytes) return json(deps, 413, { error: "too_large" });
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

async function sendEmail(deps: Deps, subject: string, text: string, replyTo?: string | null): Promise<void> {
  if (!deps.email || !deps.email.resendApiKey || !deps.email.to.length) return;
  // A failed email must never fail the submission: the report is already stored.
  try {
    const res = await (deps.fetch || fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${deps.email.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: deps.email.from, to: deps.email.to, subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!res.ok) console.error("email failed", res.status, await res.text());
  } catch (e) {
    console.error("email failed", e);
  }
}

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newReportEmail(deps: Deps, id: string, report: Report): { text: string; replyTo: string | null } {
  const asksForHelp = report.needs.some((n) => HELP_NEEDS.includes(n));
  const lines = [
    `A new Pride Report was submitted. Reference: ${id}`,
    asksForHelp ? "The student is asking for help, so a reply is needed." : "The student did not ask for direct help.",
    "",
  ];
  if (deps.email && deps.email.includeDetails) {
    lines.push(reportToText(report), "", "This email contains a confidential student report. Do not forward it or copy it elsewhere.");
  } else {
    lines.push("Sign in to the protected dashboard to read it. No details are included in this email.");
  }
  const contact = report.contact_method;
  const replyTo = deps.email && deps.email.includeDetails && contact && EMAIL_ADDRESS.test(contact) ? contact : null;
  return { text: lines.join("\n"), replyTo };
}

export async function handleSubmit(req: Request, deps: Deps): Promise<Response> {
  const body = await open(req, deps);
  if (body instanceof Response) return body;

  // Cheap bot filters: a hidden field humans never fill in, and a minimum time to complete the form.
  const meta = (body.meta && typeof body.meta === "object" ? body.meta : {}) as Record<string, unknown>;
  if (meta.hp) return json(deps, 400, { error: "rejected" });
  if (typeof meta.elapsed_ms !== "number" || meta.elapsed_ms < 3000) return json(deps, 400, { error: "rejected" });

  const report = validateReport(body.report);
  if (!report.ok) return json(deps, 400, { error: "invalid_report", detail: report.error });

  const code = generateCode();
  const { data, error } = await deps.rpc("submit_report", {
    p_code_hash: await hmacHex(deps.pepper, `code|${code}`),
    p_report: report.value,
    p_bucket: await bucket(req, deps),
  });
  const failure = rpcFailure(deps, data, error);
  if (failure) return failure;
  const id = (data as { id: string }).id;

  // The subject carries no details: it shows up in notifications and on lock screens.
  const mail = newReportEmail(deps, id, report.value);
  await sendEmail(deps, `New Pride Report ${id}`, mail.text, mail.replyTo);

  if (deps.notifyWebhookUrl) {
    // The notification names the report and nothing else; reviewers sign in to read it.
    try {
      await (deps.fetch || fetch)(deps.notifyWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `New Pride Report received and awaiting review. Report ID: ${id}. Sign in to the protected dashboard to read it.`,
        }),
      });
    } catch (e) {
      console.error("notification failed", e);
    }
  }

  // The code is returned exactly once and is not stored anywhere in readable form.
  return json(deps, 201, { id, code });
}

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
    const failure = rpcFailure(deps, data, error);
    if (failure) return failure;
    const id = (data as { id: string }).id;
    await sendEmail(deps, `New message on Pride Report ${id}`,
      deps.email && deps.email.includeDetails
        ? `The student added a message to ${id}:\n\n${message.value}\n\nThis email contains confidential student information. Do not forward it.`
        : `The student added a message to ${id}. No details are included in this email.`);
    return json(deps, 200, data);
  }
  return json(deps, 400, { error: "unknown_action" });
}
