/* Site configuration. This file is public: never put passwords or secret keys in it.
 *
 * INTAKE IS CLOSED unless every one of these is true:
 *   1. INTAKE_ENABLED is true
 *   2. SUPABASE_URL is filled in
 *   3. every POLICY value below is filled in
 *   4. the core campus contacts in resources-data.js are marked verified
 * If any is missing, the site shows a clear "not accepting submissions yet" state and offers a
 * preview of the questions that sends and saves nothing. See SETUP.md for the full checklist.
 */
window.PR_CONFIG = {
  // The kill switch. Set to false at any time to stop accepting submissions immediately.
  INTAKE_ENABLED: true,

  // Your Supabase project. Both values are designed to be public.
  SUPABASE_URL: "https://apkyznnkokhwalbasbdt.supabase.co",
  // The project's "anon" (publishable) key, from Supabase: Project Settings, API. Needed only for
  // reviewer sign-in on the dashboard. This is NOT the service-role key, which must never appear here.
  SUPABASE_ANON_KEY: "sb_publishable_NHGmxjPNuprI3Z5cmlbuhw_Vw1Uikmh",

  // Shown to students before they submit. Leave a value empty until it has really been decided:
  // an empty value keeps intake closed rather than showing a made-up policy.
  POLICY: {
    // When reviewers read submissions, e.g. "Monday to Friday during the semester".
    REVIEW_HOURS: "Monday to Friday, 9AM to 7PM ET",
    // How long a first response usually takes, e.g. "within three days when classes are in session".
    RESPONSE_TIME: "within a day",
    // How long submissions are kept before deletion, e.g. "12 months".
    RETENTION: "1 semester",
    // When reviewers must tell someone else, e.g. a threat to someone's safety. Agree this with
    // appropriate University staff first.
    CONFIDENTIALITY_LIMITS: "threat to your safety, someone else's safety, or other abuse cases",
    // A monitored address for questions about the project (not for reports).
    CONTACT_EMAIL: "pride@newhaven.edu"
  },

  // Only promise what someone has agreed to staff. false makes Pride Guide say plainly that the
  // service may not be available yet.
  SERVICES: {
    PEER_SUPPORT: true,
    ADVOCACY: true,
    ACCOMPANIMENT: true
  },

  SITE_NAME: "UNH Pride Line",
  // Where the "Quick exit" button sends the browser.
  QUICK_EXIT_URL: "https://en.wikipedia.org/"
};
