// POST /functions/v1/submit-report  { report, meta, idem, privacy_ack }  ->  201 { id, received_at }
// Public. Deploy with: supabase functions deploy submit-report --no-verify-jwt
import { handleSubmit } from "../_shared/handlers.ts";
import { liveDeps } from "../_shared/deps.ts";

const deps = liveDeps();
Deno.serve((req) => handleSubmit(req, deps));
