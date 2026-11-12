// POST /functions/v1/submit-report  { report, meta }  ->  201 { id, code }
// Deploy with: supabase functions deploy submit-report --no-verify-jwt
import { handleSubmit } from "../_shared/handlers.ts";
import { liveDeps } from "../_shared/deps.ts";

const deps = liveDeps();
Deno.serve((req) => handleSubmit(req, deps));
