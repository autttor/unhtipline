/* Site configuration. This file is public: never put secrets in it.
 *
 * API_BASE empty  -> DEMO MODE. Reports stay in this browser's localStorage and are never sent anywhere.
 * API_BASE set    -> LIVE MODE. Reports are POSTed to the Supabase Edge Functions in /supabase/functions.
 *                    Example: "https://YOUR_PROJECT.supabase.co/functions/v1"
 *
 * Do not switch to live mode until the governance and security review in the README is complete.
 */
window.PR_CONFIG = {
  API_BASE: "",
  SITE_NAME: "UNewHaven Pride Report",
  // Where the "Quick exit" button sends the browser.
  QUICK_EXIT_URL: "https://www.wikipedia.org/",
  // Shown to students so nobody expects a live response. Set this to what reviewers can really sustain.
  REVIEW_EXPECTATION: "Reports are read by trained student reviewers, not monitored live. A first look can take several days."
};
