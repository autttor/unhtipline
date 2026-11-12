/* Site configuration. This file is public: never put passwords or secret keys in it.
 *
 * HOW REPORTS ARE DELIVERED. Fill in ONE of the three options below.
 *
 *   1. Nothing filled in       -> DEMO MODE. Reports stay in the visitor's browser and go nowhere.
 *
 *   2. EMAIL_WEB3FORMS_KEY or  -> EMAIL MODE. Each report is emailed to your inbox by a form
 *      EMAIL_FORMSPREE_ID         delivery service. Quickest to set up. No tracking codes.
 *                                 (These two values are designed to be public. They only allow
 *                                 sending to your inbox, not reading it.)
 *
 *   3. API_BASE                -> BACKEND MODE. Reports are stored in your Supabase project, with
 *                                 tracking codes, two-way messages and an email alert to reviewers.
 *                                 Example: "https://YOUR_PROJECT.supabase.co/functions/v1"
 *
 * If more than one is filled in, API_BASE wins, then Web3Forms, then Formspree.
 * Setup steps for each option are in SETUP.md.
 */
window.PR_CONFIG = {
  EMAIL_WEB3FORMS_KEY: "",
  EMAIL_FORMSPREE_ID: "",
  API_BASE: "",

  SITE_NAME: "UNewHaven Pride Report",
  // Where the "Quick exit" button sends the browser.
  QUICK_EXIT_URL: "https://www.wikipedia.org/",
  // Shown to students so nobody expects a live response. Set this to what reviewers can really sustain.
  REVIEW_EXPECTATION: "Reports are read by trained student reviewers, not monitored live. A first look can take several days."
};
