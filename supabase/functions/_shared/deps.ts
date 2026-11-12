// Wires the handlers to the real Supabase project. Only runs inside the Edge Functions runtime.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./handlers.ts";

export function liveDeps(): Deps {
  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge Functions runtime.
  // The service-role key stays on the server; it must never appear in the website's code.
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      return { data, error };
    },
    pepper: Deno.env.get("CODE_PEPPER") ?? "",
    allowedOrigin: Deno.env.get("ALLOWED_ORIGIN") ?? "",
    notifyWebhookUrl: Deno.env.get("NOTIFY_WEBHOOK_URL") || undefined,
  };
}
