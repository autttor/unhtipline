// POST /functions/v1/admin-users  { email, display_name, role }  ->  201 { ok: true }
// Admins only. Emails the person an invitation to set their own password, then adds them to staff.
// Deploy with: supabase functions deploy admin-users --no-verify-jwt
// (The function checks the caller's token itself, including that they signed in with a second factor.)
import { handleAdminUsers } from "../_shared/handlers.ts";
import { liveDeps } from "../_shared/deps.ts";

const deps = liveDeps();
Deno.serve((req) => handleAdminUsers(req, deps));
