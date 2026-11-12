// POST /functions/v1/send-notifications  ->  200 { claimed, sent, requeued, failed }
// Sends whatever is due in the email outbox. Callers must present either the DISPATCH_SECRET
// (the scheduled job) or an admin's sign-in token (the dashboard's "Send now" button).
// Deploy with: supabase functions deploy send-notifications --no-verify-jwt
import { handleDispatch } from "../_shared/handlers.ts";
import { liveDeps } from "../_shared/deps.ts";

const deps = liveDeps();
Deno.serve((req) => handleDispatch(req, deps));
