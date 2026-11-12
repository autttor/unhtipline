// Wires the handlers to the real Supabase project. Only runs inside the Edge Functions runtime.
// Every value here comes from a server-side secret. None of it is ever sent to the browser.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./handlers.ts";
import { resendProvider, sandboxProvider } from "./mail.ts";
import type { MailProvider } from "./mail.ts";

declare const EdgeRuntime: { waitUntil?: (work: Promise<unknown>) => void } | undefined;

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function mailProvider(): MailProvider | null {
  // EMAIL_PROVIDER: "resend" (real email) or "sandbox" (logs only, sends nothing).
  // Unset means "resend" when a key is present and no email at all otherwise.
  const choice = env("EMAIL_PROVIDER") || (env("RESEND_API_KEY") ? "resend" : "");
  if (choice === "sandbox") return sandboxProvider();
  if (choice === "resend" && env("RESEND_API_KEY")) return resendProvider(env("RESEND_API_KEY"));
  return null;
}

export function liveDeps(): Deps {
  const url = env("SUPABASE_URL");
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  // The service-role client can call the submission and outbox functions. It stays on the server.
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), noSession);

  return {
    rpc: async (fn, args) => {
      const { data, error } = await service.rpc(fn, args);
      return { data, error };
    },
    pepper: env("CODE_PEPPER"),
    allowedOrigin: env("ALLOWED_ORIGIN"),
    recipients: env("EMAIL_TO").split(",").map((a) => a.trim()).filter(Boolean),
    mail: mailProvider(),
    // Resend's shared test sender works before you verify a domain, but only delivers to your own address.
    mailFrom: env("EMAIL_FROM") || "Pride Line <onboarding@resend.dev>",
    // Off unless explicitly switched on. See SETUP.md for what turning it on exposes.
    includeDetails: env("EMAIL_INCLUDE_DETAILS").toLowerCase() === "true",
    dashboardUrl: env("DASHBOARD_URL"),
    dispatchSecret: env("DISPATCH_SECRET"),

    // Who is calling? Ask the database, as that person, using the token they sent.
    verifyStaff: async (authorization) => {
      const asCaller = createClient(url, env("SUPABASE_ANON_KEY"), { ...noSession, global: { headers: { Authorization: authorization } } });
      const { data, error } = await asCaller.rpc("staff_me");
      if (error || !data) return null;
      return data as { user_id: string; role: string; is_staff: boolean; mfa_ok: boolean };
    },

    inviteUser: async (email) => {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: env("DASHBOARD_URL") || undefined });
      if (error || !data?.user) return { error: error?.message ?? "invite failed" };
      return { user_id: data.user.id };
    },

    background: typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil
      ? (work) => EdgeRuntime!.waitUntil!(work)
      : undefined,
  };
}
