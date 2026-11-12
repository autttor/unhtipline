// POST /functions/v1/track-report  { action: "view", code }            ->  200 student view
//                                  { action: "message", code, body }   ->  200 student view
// Deploy with: supabase functions deploy track-report --no-verify-jwt
import { handleTrack } from "../_shared/handlers.ts";
import { liveDeps } from "../_shared/deps.ts";

const deps = liveDeps();
Deno.serve((req) => handleTrack(req, deps));
