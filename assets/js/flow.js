/* Pride Guide script: every question, option and branch.
 *
 * THE ORDER IS FIXED. Do not reorder these steps (tests/engine.test.js enforces it for every branch):
 *   1. Intro and general information, ending with "Are you safe right now?"
 *   2. "How can we help?"  (the first substantive question; "I need to report something" comes first)
 *   3. Questions specific to the help that was chosen (branches A to F below)
 *   4. Contact, privacy notice, and separate permission to contact anyone else
 *   5. Review, then one explicit Submit
 *
 * Rules for anyone editing this file:
 *  - Deterministic script only. Never claim to be a person, a counselor, or a University official.
 *  - Never promise a service nobody has agreed to staff (see SERVICES in config.js).
 *  - Ask only what is needed to act on the help requested. Every detail question can be skipped.
 *  - Do not ask for the student's sexual orientation or gender identity.
 *  - Choosing "help with an office" or "an advocate" is NOT permission to contact anyone.
 *  - Emergency contacts: University Public Safety first, then 911.
 *  - No em dashes in anything a student reads.
 *
 * Option values must stay in sync with supabase/functions/_shared/validate.ts
 * (tests/consistency.test.js checks this).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.PR = root.PR || {}).flow = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Set by the page before the conversation starts.
  var context = {
    preview: true,                                   // true: nothing is sent or saved
    policy: {},                                      // POLICY from config.js
    services: { PEER_SUPPORT: false, ADVOCACY: false, ACCOMPANIMENT: false }
  };

  var TBC = "[to be confirmed before this service opens]";
  function policy(key) { return String(context.policy[key] || "").trim() || TBC; }

  var PREFER_NOT = { value: "prefer_not", label: "Prefer not to say", aliases: ["prefer not to say", "rather not say", "prefer not"] };
  var UNSURE = { value: "unsure", label: "I’m not sure", aliases: ["not sure", "unsure", "idk", "i don't know", "dont know"] };
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function value(ans) { return ans && !ans.skipped ? ans.value : null; }
  function picked(ans, v) { return !!(ans && ans.values && ans.values.indexOf(v) !== -1); }
  function help(a) { return value(a.help); }

  /** True when the student asked for something that could involve contacting someone else. */
  function needsConsent(a) {
    var h = help(a);
    return h === "office" || h === "advocate" ||
      picked(a.wants, "advocacy") || picked(a.wants, "office") ||
      picked(a.next_steps, "advocacy") || picked(a.next_steps, "office");
  }
  /** Help that can't happen unless a reviewer is able to reach the student. */
  function needsReply(a) {
    var h = help(a);
    return h === "office" || h === "peer" || h === "advocate";
  }

  // Answers that belong to one branch. Cleared when the student changes what kind of help they want.
  var BRANCH_ANSWERS = ["narrative", "categories", "where", "when", "frequency", "ongoing", "wants", "office", "contacted",
    "contact_summary", "assist", "deadline", "peer_kind", "outcome", "advocacy_kind", "topic", "follow_up", "next_steps",
    "external_contact", "external_contact_scope"];

  var BRANCH_START = { report: "a_what", office: "b_office", peer: "c_kind", advocate: "d_concern", info: "e_topic", other: "f_what" };

  var deadlineOptions = [
    { value: "none", label: "No deadline", aliases: ["no", "none", "no deadline"] },
    { value: "days", label: "Within a few days", aliases: ["days", "this week", "soon"] },
    { value: "weeks", label: "Within a few weeks", aliases: ["weeks", "this month"] },
    UNSURE
  ];

  var nodes = {

    /* ---------- 1. Intro, general information and the safety question ---------- */

    intro: {
      type: "choice", step: 0, field: "safe",
      say: function () {
        return [
          "Hi. This is Pride Guide, the automated assistant for UNewHaven Pride Report. I am a scripted program, not a person.",
          "Pride Report is run by students. It is not affiliated with, operated by, or endorsed by the University of New Haven.",
          "This service is not monitored 24/7 and is not an emergency service. Anything you send here is not an official University report.",
          "You can choose not to identify yourself, but we can’t guarantee full anonymity or confidentiality. Before you submit anything, we will show you who can read it and how it is handled.",
          context.preview ? "Preview only: this site is not accepting submissions yet. Nothing you enter is sent or saved." : null,
          "Are you safe right now?"
        ].filter(Boolean);
      },
      links: [{ label: "How your information is handled", href: "privacy.html", newTab: true }],
      options: [
        { value: "yes", label: "Yes", aliases: ["yes", "y", "i'm safe", "im safe", "safe"], next: "help" },
        { value: "no", label: "No", aliases: ["no", "n"], next: "emergency" },
        { value: "unsure", label: "I’m not sure", aliases: ["not sure", "unsure", "maybe"], next: "emergency" }
      ]
    },

    emergency: {
      type: "choice", step: 0, tone: "urgent",
      say: [
        "This assistant cannot call anyone or send help, and nobody is watching this conversation live.",
        "If you or someone else is in immediate danger, call University Public Safety at (203) 932-7070, or call 911.",
        "If you are thinking about harming yourself, you can call or text 988 at any time.",
        "You don’t need to tell us anything about what is happening. If there is something you want to document that is not an emergency, you can continue."
      ],
      links: [
        { label: "Call Public Safety", href: "tel:+12039327070" },
        { label: "Call 911", href: "tel:911" },
        { label: "Call or text 988", href: "tel:988" },
        { label: "Leave this site now", action: "exit" }
      ],
      options: [
        { value: "continue", label: "I understand this can’t send help. Continue", aliases: ["continue", "i understand"], next: "help" },
        { value: "stop", label: "Stop here", aliases: ["stop"], next: "bye" }
      ]
    },

    /* ---------- 2. How can we help? ---------- */

    help: {
      type: "choice", step: 1, field: "help",
      say: ["How can we help?"],
      options: [
        { value: "report", label: "I need to report something", primary: true, desc: "Tell us what happened so that it is on record.", aliases: ["report", "report something"] },
        { value: "office", label: "I need help with a University office", desc: "Housing, records, financial aid, or any office or process.", aliases: ["office", "help with an office"] },
        { value: "peer", label: "I need peer support", desc: "Someone to listen, or help finding community.", aliases: ["peer support", "support"] },
        { value: "advocate", label: "I need an advocate / someone to help me speak up", desc: "Help understanding options, wording a message, or raising a concern.", aliases: ["advocate", "advocacy", "speak up"] },
        { value: "info", label: "I need information or resources", desc: "Reporting routes, support services, community.", aliases: ["information", "resources", "info"] },
        { value: "other", label: "Something else / I’m not sure", desc: "You don’t have to put it in a category.", aliases: ["something else", "not sure", "other"] }
      ],
      onAnswer: function (answers) {
        BRANCH_ANSWERS.forEach(function (key) { delete answers[key]; });
      },
      next: function (a) { return BRANCH_START[help(a)]; }
    },

    /* ---------- 3A. I need to report something ---------- */

    a_what: {
      type: "text", step: 2, field: "narrative", optional: true, multiline: true, partOf: "help",
      placeholder: "Type here",
      say: [
        "Tell us what happened, in your own words.",
        "Share as much or as little as you want. You don’t need to name anyone."
      ],
      skipNext: "a_skip",
      next: "a_categories"
    },

    a_skip: {
      type: "choice", step: 2, partOf: "help",
      say: ["A report needs at least a few words to be useful to the people reading it. What would you like to do?"],
      options: [
        { value: "write", label: "Write a few words", aliases: ["write", "go back"], next: "a_what" },
        { value: "resources", label: "Show me resources instead", aliases: ["resources"], next: "end_resources" }
      ]
    },

    a_categories: {
      type: "multi", step: 2, field: "categories", optional: true, partOf: "help",
      say: [
        "If you’d like, choose anything that describes it. You can pick more than one, or skip this.",
        "This only helps route your report. It isn’t a judgment about what it “counts” as."
      ],
      options: [
        { value: "harassment", label: "Harassment or bullying" },
        { value: "discrimination", label: "Discrimination" },
        { value: "identity", label: "Gender identity, name or pronouns" },
        { value: "housing", label: "Residence life or housing" },
        { value: "academics", label: "Academics or faculty" },
        { value: "facilities", label: "Facilities or restrooms" },
        { value: "safety", label: "Threats or safety" },
        { value: "online", label: "Online" },
        { value: "climate", label: "Policy or campus climate" },
        { value: "other", label: "Other" },
        { value: "unsure", label: "I’m not sure" }
      ],
      next: "a_where"
    },

    a_where: {
      type: "choice", step: 2, field: "where", allowText: true, optional: true, maxLength: 300, partOf: "help",
      say: ["Where did it happen? A general answer is fine, or type your own."],
      options: [
        { value: "residence", label: "Residence hall", aliases: ["dorm", "residence"] },
        { value: "academic", label: "Classroom or academic building", aliases: ["classroom", "class"] },
        { value: "common", label: "Dining or common space", aliases: ["dining", "common space"] },
        { value: "office", label: "Campus office or service", aliases: ["office"] },
        { value: "athletics", label: "Athletics or recreation", aliases: ["athletics", "gym"] },
        { value: "online", label: "Online", aliases: ["online", "social media"] },
        { value: "off_campus", label: "Off campus", aliases: ["off campus"] },
        { value: "campus_wide", label: "Campus-wide", aliases: ["everywhere", "campus wide"] },
        PREFER_NOT
      ],
      next: "a_when"
    },

    a_when: {
      type: "choice", step: 2, field: "when", allowText: true, optional: true, maxLength: 300, partOf: "help",
      say: ["Roughly when? You can also type a date."],
      options: [
        { value: "recent", label: "Today or yesterday", aliases: ["today", "yesterday"] },
        { value: "week", label: "In the past week", aliases: ["this week", "past week"] },
        { value: "month", label: "In the past month", aliases: ["this month", "past month"] },
        { value: "earlier", label: "Longer ago", aliases: ["earlier", "a while ago"] },
        PREFER_NOT
      ],
      next: "a_frequency"
    },

    a_frequency: {
      type: "choice", step: 2, field: "frequency", optional: true, partOf: "help",
      say: ["Did it happen once, or more than once?"],
      options: [
        { value: "once", label: "Once", aliases: ["once", "one time"] },
        { value: "repeated", label: "More than once", aliases: ["repeated", "more than once"] },
        UNSURE, PREFER_NOT
      ],
      next: "a_ongoing"
    },

    a_ongoing: {
      type: "choice", step: 2, field: "ongoing", optional: true, partOf: "help",
      say: ["Is it still happening?"],
      options: [
        { value: "yes", label: "Yes", aliases: ["yes", "y"] },
        { value: "no", label: "No", aliases: ["no", "n"] },
        UNSURE, PREFER_NOT
      ],
      next: "a_wants"
    },

    a_wants: {
      type: "multi", step: 2, field: "wants", optional: true, partOf: "help",
      say: ["What do you most want to happen? Choose any that apply."],
      options: [
        { value: "document", label: "Have it on record" },
        { value: "resources", label: "Get resources" },
        { value: "listen", label: "Have someone listen" },
        { value: "advocacy", label: "Have someone advocate for me" },
        { value: "office", label: "Get help with a University office" },
        { value: "other", label: "Something else" }
      ],
      next: "contact_want"
    },

    /* ---------- 3B. I need help with a University office ---------- */

    b_office: {
      type: "choice", step: 2, field: "office", allowText: true, optional: true, maxLength: 300, partOf: "help",
      say: ["Which office or process is this about? If it isn’t listed, type it."],
      options: [
        { value: "housing", label: "Housing or residential life", aliases: ["housing", "residential life", "reslife"] },
        { value: "records", label: "Records or registration (name, ID, email)", aliases: ["registrar", "records", "name change"] },
        { value: "health", label: "Health or counseling services", aliases: ["health", "counseling"] },
        { value: "financial", label: "Financial aid or billing", aliases: ["financial aid", "billing", "bursar"] },
        { value: "student_affairs", label: "Student affairs or conduct", aliases: ["dean of students", "student affairs", "conduct"] },
        { value: "title_ix", label: "Title IX", aliases: ["title ix", "title 9"] },
        { value: "public_safety", label: "Public Safety", aliases: ["public safety", "campus police"] },
        { value: "athletics", label: "Athletics or recreation", aliases: ["athletics", "recreation"] },
        { value: "academic", label: "An academic department or advisor", aliases: ["department", "advisor"] },
        { value: "dont_know", label: "I don’t know who handles this", aliases: ["don't know", "dont know", "not sure", "unsure"] }
      ],
      next: "b_goal"
    },

    b_goal: {
      type: "text", step: 2, field: "narrative", optional: true, multiline: true, partOf: "help",
      placeholder: "Type here, or skip",
      say: ["What are you trying to get done?"],
      next: "b_contacted"
    },

    b_contacted: {
      type: "choice", step: 2, field: "contacted", optional: true, partOf: "help",
      say: ["Have you contacted them already?"],
      options: [
        { value: "no", label: "No", aliases: ["no", "n", "not yet"], next: "b_deadline" },
        { value: "yes", label: "Yes", aliases: ["yes", "y"], next: "b_summary" },
        Object.assign({}, PREFER_NOT, { next: "b_deadline" })
      ],
      onAnswer: function (answers, ans) { if (ans.value !== "yes") delete answers.contact_summary; },
      next: "b_deadline"
    },

    b_summary: {
      type: "text", step: 2, field: "contact_summary", optional: true, multiline: true, maxLength: 2000, partOf: ["help", "b_contacted"],
      placeholder: "Type here, or skip",
      say: ["If you’d like, tell us briefly what happened when you contacted them."],
      next: "b_deadline"
    },

    b_deadline: {
      type: "choice", step: 2, field: "deadline", allowText: true, optional: true, maxLength: 300, partOf: "help",
      say: ["Is there a deadline or date coming up? You can also type one."],
      options: deadlineOptions,
      next: "b_assist"
    },

    b_assist: {
      type: "multi", step: 2, field: "assist", optional: true, partOf: "help",
      say: function () {
        return [
          "What kind of assistance would help? Choose any that apply.",
          "Reviewers are students. They can’t represent you legally, guarantee a decision, or override University policy."
        ];
      },
      get options() {
        return [
          { value: "identify", label: "Work out which office handles this" },
          { value: "explain", label: "Explain the process" },
          { value: "draft", label: "Help wording a message" },
          { value: "prepare", label: "Help preparing for a meeting" },
          { value: "accompany", label: context.services.ACCOMPANIMENT ? "Someone to come with me" : "Someone to come with me, if a reviewer is available" },
          { value: "other", label: "Something else" }
        ];
      },
      next: "contact_want"
    },

    /* ---------- 3C. I need peer support ---------- */

    c_kind: {
      type: "multi", step: 2, field: "peer_kind", optional: true, partOf: "help",
      say: function () {
        return [
          "What would you like? Choose any that apply.",
          context.services.PEER_SUPPORT
            ? "Peer support here means trained students, not counselors, and it is not immediate."
            : "We can’t promise that a trained peer supporter is available right now, and this is not counseling. You can still send a request, and the links below reach established support today."
        ];
      },
      links: [{ label: "Support you can reach today", href: "resources.html#support", newTab: true }],
      options: [
        { value: "listen", label: "Someone to listen" },
        { value: "community", label: "Connect with campus LGBTQ+ community" },
        { value: "resources", label: "Help finding resources" },
        { value: "navigate", label: "Help with a difficult interaction" },
        { value: "other", label: "Something else" }
      ],
      next: "c_context"
    },

    c_context: {
      type: "text", step: 2, field: "narrative", optional: true, multiline: true, partOf: "help",
      placeholder: "Type here, or skip",
      say: ["If you’d like, share a little about what is going on. You don’t need to go into detail, and you can skip this."],
      next: "contact_want"
    },

    /* ---------- 3D. I need an advocate ---------- */

    d_concern: {
      type: "text", step: 2, field: "narrative", optional: true, multiline: true, partOf: "help",
      placeholder: "Type here, or skip",
      say: ["What is the concern you’d like help speaking up about?"],
      next: "d_outcome"
    },

    d_outcome: {
      type: "text", step: 2, field: "outcome", optional: true, multiline: true, maxLength: 2000, partOf: "help",
      placeholder: "Type here, or skip",
      say: ["What outcome are you hoping for?"],
      next: "d_deadline"
    },

    d_deadline: {
      type: "choice", step: 2, field: "deadline", allowText: true, optional: true, maxLength: 300, partOf: "help",
      say: ["Is a meeting or deadline coming up? You can also type a date."],
      options: deadlineOptions,
      next: "d_kind"
    },

    d_kind: {
      type: "multi", step: 2, field: "advocacy_kind", optional: true, partOf: "help",
      say: function () {
        return [
          "What would advocacy look like for you? Choose any that apply.",
          "What the student team can do: listen, explain your options, help you prepare, and, only with your separate permission, raise a concern.",
          "What it can’t do: act as your lawyer, guarantee an outcome, or override a University decision." +
            (context.services.ADVOCACY ? "" : " We also can’t promise an advocate is available yet."),
          "Asking for an advocate does not give us permission to contact anyone. We will ask about that separately."
        ];
      },
      get options() {
        return [
          { value: "options", label: "Help me understand my options" },
          { value: "draft", label: "Help wording a message" },
          { value: "attend", label: context.services.ACCOMPANIMENT ? "Come to a meeting with me" : "Come to a meeting with me, if a reviewer is available" },
          { value: "general", label: "Raise a general concern without identifying me" },
          { value: "other", label: "Something else" }
        ];
      },
      next: "contact_want"
    },

    /* ---------- 3E. I need information or resources ---------- */

    e_topic: {
      type: "choice", step: 2, field: "topic", optional: true, partOf: "help",
      say: ["What would you like information about?"],
      options: [
        { value: "reporting", label: "Reporting routes", aliases: ["reporting", "report"] },
        { value: "housing", label: "Residence life", aliases: ["housing", "residence life"] },
        { value: "title_ix", label: "Discrimination or Title IX", aliases: ["title ix", "discrimination"] },
        { value: "community", label: "Community", aliases: ["community"] },
        { value: "mental_health", label: "Mental health support", aliases: ["mental health", "counseling"] },
        { value: "safety", label: "Safety", aliases: ["safety"] },
        { value: "other", label: "Something else", aliases: ["other"] }
      ],
      next: "e_resources"
    },

    e_resources: {
      type: "choice", step: 2, field: "follow_up", partOf: "help",
      // The page shows resource cards for the chosen topic alongside this question.
      resources: function (a) { return value(a.topic) || "other"; },
      say: [
        "Here are some places to start. You can use any of them without sending us anything.",
        "Would you also like to send a question to the student reviewers?"
      ],
      links: [{ label: "See all resources", href: "resources.html", newTab: true }],
      options: [
        { value: "no", label: "No, this is what I needed", aliases: ["no", "n", "done"], next: "end_info" },
        { value: "yes", label: "Yes, send a question", aliases: ["yes", "y"], next: "e_request" }
      ]
    },

    e_request: {
      type: "text", step: 2, field: "narrative", optional: true, multiline: true, partOf: "help",
      placeholder: "Type here, or skip",
      say: ["What would you like to ask?"],
      next: "contact_want"
    },

    /* ---------- 3F. Something else / I'm not sure ---------- */

    f_what: {
      type: "text", step: 2, field: "narrative", optional: true, multiline: true, partOf: "help",
      placeholder: "Type here, or skip",
      say: ["You don’t have to put it in a category. What would you like us to know or help with?"],
      next: "f_next"
    },

    f_next: {
      type: "multi", step: 2, field: "next_steps", optional: true, partOf: "help",
      say: ["Would any of these help? Choose any that apply, or skip this."],
      options: [
        { value: "listen", label: "Someone to listen" },
        { value: "resources", label: "Information or resources" },
        { value: "office", label: "Help with a University office" },
        { value: "advocacy", label: "Someone to help me speak up" },
        { value: "document", label: "Just have it on record" },
        { value: "unsure", label: "I’m not sure yet" }
      ],
      next: "contact_want"
    },

    /* ---------- 4. Contact, privacy, permissions ---------- */

    contact_want: {
      type: "choice", step: 3, field: "contact_want",
      say: function (a) {
        return [
          "Would you like someone from our student team to contact you about this?",
          needsReply(a) ? "The help you asked for needs a way to reach you. If you choose No, reviewers can read this but can’t follow up with you." : null
        ].filter(Boolean);
      },
      options: [
        { value: "yes", label: "Yes", aliases: ["yes", "y"], next: "contact_email" },
        { value: "no", label: "No", aliases: ["no", "n"], next: "privacy" }
      ],
      onAnswer: function (answers, ans) {
        if (ans.value !== "yes") { delete answers.contact_email; delete answers.contact_name; delete answers.contact_discreet; }
      }
    },

    contact_email: {
      type: "text", step: 3, field: "contact_email", partOf: "contact_want", maxLength: 254, pattern: EMAIL,
      placeholder: "name@example.com", inputType: "email",
      say: [
        "What email address should we use? It doesn’t have to be your University address.",
        "Email is the only way we contact people. If you’d rather not give one, go back and choose No."
      ],
      next: "contact_name"
    },

    contact_name: {
      type: "text", step: 3, field: "contact_name", optional: true, partOf: "contact_want", maxLength: 120,
      placeholder: "Name to use for you",
      say: ["What name should we use for you? It doesn’t have to be your legal name, and you can skip this."],
      next: "contact_discreet"
    },

    contact_discreet: {
      type: "choice", step: 3, field: "contact_discreet", optional: true, partOf: "contact_want",
      say: ["When we email you, is it OK for the message to mention Pride Report?"],
      options: [
        { value: "ok", label: "Yes, that’s fine", aliases: ["yes", "fine", "ok", "okay"] },
        { value: "discreet", label: "No, please be discreet", aliases: ["no", "discreet", "be discreet"] }
      ],
      next: "privacy"
    },

    privacy: {
      type: "choice", step: 3, field: "privacy_ack",
      say: function () {
        return [
          "Before you send anything, here is how it is handled.",
          "Who can read it: a small team of student reviewers. Each one signs in with their own account and a second sign-in step, and every time a submission is opened it is logged. It is not sent to the University.",
          "How it is delivered and stored: it goes from this page to a private database hosted by Supabase. Reviewers get an email saying that something arrived. That email does not contain what you wrote.",
          "When to expect a response: reviewers read submissions " + policy("REVIEW_HOURS") + ". A first response usually comes " + policy("RESPONSE_TIME") + ". A submission that has been received has not necessarily been read yet.",
          "How long it is kept: " + policy("RETENTION") + ".",
          "Limits of confidentiality: " + policy("CONFIDENTIALITY_LIMITS") + " What you write may identify you even without your name, and the companies that host this site process technical information such as IP addresses.",
          "This is not a University report. If you want the University to act, the Resources page lists the official routes."
        ];
      },
      links: [{ label: "Open the full privacy page", href: "privacy.html", newTab: true }],
      options: [
        { value: "ok", label: "I understand. Continue", aliases: ["ok", "okay", "continue", "i understand", "yes"] },
        { value: "stop", label: "Stop here without submitting", aliases: ["stop", "no"], next: "bye" }
      ],
      next: function (a) { return needsConsent(a) ? "consent" : "review"; }
    },

    consent: {
      type: "choice", step: 3, field: "external_contact",
      say: [
        "One more permission, and it is separate from everything above.",
        "May a student reviewer contact a University office or another person about this on your behalf?",
        "Asking for help with an office or for an advocate does not give us this permission. Unless you say yes here, we will not contact anyone."
      ],
      options: [
        { value: "no", label: "No. Don’t contact anyone", aliases: ["no", "n"], next: "review" },
        { value: "ask", label: "Ask me first, each time", aliases: ["ask", "ask me first"], next: "review" },
        { value: "anonymous", label: "Yes, without identifying me", aliases: ["anonymous", "without identifying me"], next: "consent_scope" },
        { value: "named", label: "Yes, and you may identify me", aliases: ["named", "yes"], next: "consent_scope" }
      ],
      onAnswer: function (answers, ans) {
        if (ans.value !== "anonymous" && ans.value !== "named") delete answers.external_contact_scope;
      }
    },

    consent_scope: {
      type: "text", step: 3, field: "external_contact_scope", optional: true, multiline: true, maxLength: 500, partOf: "consent",
      placeholder: "Type here, or skip",
      say: ["Who may we contact, and what may we share? For example: “Residential life, about the room change.” A reviewer will still confirm with you if anything is unclear."],
      next: "review"
    },

    /* ---------- 5. Review, explicit submit, verified receipt ---------- */

    review: {
      type: "review", step: 4,
      say: [
        "Here is everything you’ve told me. Nothing has been sent yet.",
        "You can change any answer. When you are ready, confirm the two statements and press Submit."
      ],
      next: "submitted"
    },

    submitted: { type: "end", step: 4, receipt: true, say: [] },

    /* ---------- Endings that submit nothing ---------- */

    end_resources: {
      type: "end", step: 2, partOf: "help", showResources: "reporting",
      say: ["No problem. Nothing has been sent. Here are places you can turn to, including the official University reporting routes."],
      links: [{ label: "See all resources", href: "resources.html" }]
    },

    end_info: {
      type: "end", step: 2, partOf: "help",
      say: ["Glad that helped. Nothing has been sent. You can come back any time."],
      links: [{ label: "See all resources", href: "resources.html" }]
    },

    bye: {
      type: "end", step: 0,
      say: [
        "Okay. Nothing has been sent.",
        "You can come back any time. If you need support now, the Resources page lists people you can contact."
      ],
      links: [{ label: "Open Resources", href: "resources.html" }]
    }
  };

  var NARRATIVE_NODE = { report: "a_what", office: "b_goal", peer: "c_context", advocate: "d_concern", info: "e_request", other: "f_what" };
  var NARRATIVE_LABEL = {
    report: "What happened", office: "What you’re trying to get done", peer: "What is going on",
    advocate: "The concern", info: "Your question", other: "What you’d like us to know"
  };
  var DEADLINE_NODE = { office: "b_deadline", advocate: "d_deadline" };

  // Rows of the review screen for each kind of help: [node id, label].
  var BRANCH_ROWS = {
    report: [["a_categories", "Categories"], ["a_where", "Where"], ["a_when", "When"], ["a_frequency", "How often"],
      ["a_ongoing", "Still happening"], ["a_wants", "What you want to happen"]],
    office: [["b_office", "Office or process"], ["b_contacted", "Already contacted them"], ["b_summary", "What happened when you did"],
      ["b_deadline", "Deadline"], ["b_assist", "Assistance that would help"]],
    peer: [["c_kind", "Support you’d like"]],
    advocate: [["d_outcome", "Outcome you’re hoping for"], ["d_deadline", "Meeting or deadline"], ["d_kind", "What advocacy looks like"]],
    info: [["e_topic", "Topic"]],
    other: [["f_next", "Next steps that might help"]]
  };

  function summary(answers) {
    var h = help(answers);
    var rows = [["help", "How we can help"]];
    if (h) {
      var narrative = [NARRATIVE_NODE[h], NARRATIVE_LABEL[h]];
      // Narrative first, except for an office request, where the office comes first as it was asked.
      rows = rows.concat(h === "office" ? [BRANCH_ROWS.office[0], narrative].concat(BRANCH_ROWS.office.slice(1)) : [narrative].concat(BRANCH_ROWS[h]));
    }
    rows.push(["contact_want", "Contact you about this"]);
    if (value(answers.contact_want) === "yes") {
      rows.push(["contact_email", "Email"], ["contact_name", "Name"], ["contact_discreet", "OK to mention Pride Report"]);
    }
    if (needsConsent(answers)) {
      rows.push(["consent", "May we contact others for you"]);
      var ext = value(answers.external_contact);
      if (ext === "anonymous" || ext === "named") rows.push(["consent_scope", "Who, and what we may share"]);
    }
    return rows.filter(function (r) {
      // The "what happened when you contacted them" row only exists if they said yes.
      return r[0] !== "b_summary" || value(answers.contacted) === "yes";
    }).map(function (r) {
      var answer = answers[nodes[r[0]].field];
      // Permission to contact others is "no" until the student says otherwise.
      if (r[0] === "consent" && !answer) answer = { value: "no", label: "No. Don’t contact anyone (default)" };
      return { node: r[0], label: r[1], editable: true, answer: answer };
    });
  }

  function choice(ans) {
    if (!ans || ans.skipped) return null;
    return ans.value === "other" && ans.text ? { value: "other", text: ans.text } : { value: ans.value };
  }
  function text(ans) { return ans && !ans.skipped && ans.text ? ans.text : null; }
  function many(ans) { return ans && ans.values ? ans.values.slice() : []; }

  /** The JSON document that is submitted. Only the chosen branch's answers are included. */
  function toReport(a) {
    var h = help(a);
    var yes = value(a.contact_want) === "yes";
    var consent = needsConsent(a) ? (value(a.external_contact) || "no") : "no";
    var is = function (branch) { return h === branch; };
    return {
      version: 3,
      safe: value(a.safe),
      help: h,
      narrative: text(a.narrative),
      categories: is("report") ? many(a.categories) : [],
      where: is("report") ? choice(a.where) : null,
      when: is("report") ? choice(a.when) : null,
      frequency: is("report") ? choice(a.frequency) : null,
      ongoing: is("report") ? choice(a.ongoing) : null,
      wants: is("report") ? many(a.wants) : [],
      office: is("office") ? choice(a.office) : null,
      contacted: is("office") ? choice(a.contacted) : null,
      contact_summary: is("office") && value(a.contacted) === "yes" ? text(a.contact_summary) : null,
      assist: is("office") ? many(a.assist) : [],
      deadline: is("office") || is("advocate") ? choice(a.deadline) : null,
      peer_kind: is("peer") ? many(a.peer_kind) : [],
      outcome: is("advocate") ? text(a.outcome) : null,
      advocacy_kind: is("advocate") ? many(a.advocacy_kind) : [],
      topic: is("info") ? choice(a.topic) : null,
      next_steps: is("other") ? many(a.next_steps) : [],
      contact_want: value(a.contact_want),
      contact_email: yes ? text(a.contact_email) : null,
      contact_name: yes ? text(a.contact_name) : null,
      contact_discreet: yes ? choice(a.contact_discreet) : null,
      external_contact: consent,
      external_contact_scope: consent === "anonymous" || consent === "named" ? text(a.external_contact_scope) : null
    };
  }

  // Which question's options label each stored field.
  var FIELD_NODE = {
    safe: "intro", help: "help", categories: "a_categories", where: "a_where", when: "a_when", frequency: "a_frequency",
    ongoing: "a_ongoing", wants: "a_wants", office: "b_office", contacted: "b_contacted", assist: "b_assist",
    deadline: "b_deadline", peer_kind: "c_kind", advocacy_kind: "d_kind", topic: "e_topic", next_steps: "f_next",
    contact_want: "contact_want", contact_discreet: "contact_discreet", external_contact: "consent"
  };

  /** Label for a stored value of a report field. */
  function labelFor(field, stored) {
    if (stored === null || stored === undefined || stored === "") return "";
    if (Array.isArray(stored)) return stored.map(function (v) { return labelFor(field, v); }).join(", ");
    if (typeof stored === "object") return stored.value === "other" && stored.text ? stored.text : labelFor(field, stored.value);
    var node = nodes[FIELD_NODE[field]];
    var hit = node && node.options.filter(function (o) { return o.value === stored; })[0];
    return hit ? hit.label : String(stored).replace(/_/g, " ");
  }

  /** Short dashboard name for each kind of help. */
  var HELP_SHORT = {
    report: "Incident report", office: "Help with University office", peer: "Peer support",
    advocate: "Advocacy requested", info: "Information or resources", other: "Something else"
  };

  /**
   * A stored report as ordered [label, text] rows, with unanswered questions left out. Used by the
   * reviewer dashboard. Reports stored by the earlier version of the site are shown field by field.
   */
  function describeReport(r) {
    var rows = [];
    function add(label, v) { if (v !== null && v !== undefined && v !== "") rows.push([label, v]); }
    if (!r || r.version !== 3) {
      Object.keys(r || {}).forEach(function (key) {
        var v = r[key];
        if (key === "version" || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
        var shown = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? (v.value === "other" && v.text ? v.text : v.value) : v;
        add(key.replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }), String(shown).replace(/_/g, " "));
      });
      return rows;
    }
    add("Safe right now", labelFor("safe", r.safe));
    add("How we can help", labelFor("help", r.help));
    if (r.help === "office") add("Office or process", labelFor("office", r.office));
    add(NARRATIVE_LABEL[r.help] || "In their words", r.narrative);
    add("Categories", labelFor("categories", r.categories));
    add("Where", labelFor("where", r.where));
    add("When", labelFor("when", r.when));
    add("How often", labelFor("frequency", r.frequency));
    add("Still happening", labelFor("ongoing", r.ongoing));
    add("What they want to happen", labelFor("wants", r.wants));
    add("Already contacted the office", labelFor("contacted", r.contacted));
    add("What happened when they did", r.contact_summary);
    add("Outcome hoped for", r.outcome);
    add("Deadline", labelFor("deadline", r.deadline));
    add("Assistance that would help", labelFor("assist", r.assist));
    add("Support wanted", labelFor("peer_kind", r.peer_kind));
    add("What advocacy looks like", labelFor("advocacy_kind", r.advocacy_kind));
    add("Topic", labelFor("topic", r.topic));
    add("Next steps that might help", labelFor("next_steps", r.next_steps));
    return rows;
  }

  // Rule-based safety nets, not risk assessments. When a student writes about self-harm or a threat,
  // the page shows who to call at once instead of leaving it for a reviewer to find days later.
  var crisisPattern = /\b(kill(ing)? myself|suicid(e|al)|end(ing)? my (own )?life|hurt(ing)? myself|harm(ing)? myself|self[- ]harm|don'?t want to (live|be alive|be here anymore)|want to die)\b/i;
  var dangerPattern = /\b(threaten(ed|ing|s)? to (hurt|kill|beat|attack)|going to (hurt|kill|attack) (me|us|them|him|her)|afraid for my (life|safety)|fear for my (life|safety)|(has|had|have|with) a (gun|knife|weapon)|stalking me|following me home)\b/i;
  function detectCrisis(str) { return crisisPattern.test(String(str || "")); }

  /** "crisis", "danger" or null for an answer just given. */
  function alertFor(node, answer) {
    if (!answer || answer.skipped) return null;
    if (answer.text && detectCrisis(answer.text)) return "crisis";
    if (answer.text && dangerPattern.test(answer.text)) return "danger";
    if (node && node.field === "categories" && picked(answer, "safety")) return "danger";
    return null;
  }

  return {
    start: "intro",
    totalSteps: 4,
    maxLength: 4000,
    nodes: nodes,
    context: context,
    branchStart: BRANCH_START,
    needsConsent: needsConsent,
    needsReply: needsReply,
    summary: summary,
    toReport: toReport,
    labelFor: labelFor,
    helpShort: HELP_SHORT,
    describeReport: describeReport,
    detectCrisis: detectCrisis,
    alertFor: alertFor,
    statuses: {
      "new": "New",
      in_review: "In review",
      awaiting_follow_up: "Awaiting follow-up",
      closed: "Closed"
    }
  };
});
