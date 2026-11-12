/* Pride Guide script: every question, option and branch.
 *
 * Tone rules for anyone editing this file:
 *  - Neutral, calm, direct. No exaggerated sympathy, no guessing at anyone's identity.
 *  - Never judge whether something "counts" as discrimination, and never promise an outcome.
 *  - Never claim to be a person, a counselor, or a University official.
 *  - Every incident-detail question must be skippable.
 *  - Do not ask for the student's sexual orientation or gender identity.
 *
 * Option values here must stay in sync with supabase/functions/_shared/validate.ts
 * (tests/consistency.test.js checks this).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.PR = root.PR || {}).flow = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Set by the page before the conversation starts.
  var context = { demo: true, expectation: "" };

  var UNSURE = { value: "unsure", label: "I’m not sure", aliases: ["not sure", "unsure", "idk", "i don't know", "dont know"] };

  var categories = [
    { value: "harassment", label: "Harassment or bullying", aliases: ["harassment", "bullying"] },
    { value: "discrimination", label: "Discrimination", aliases: ["unequal treatment"] },
    { value: "deadnaming", label: "Deadnaming or misgendering", aliases: ["deadnaming", "misgendering", "pronouns"] },
    { value: "housing", label: "Housing or residence life", aliases: ["housing", "residence life", "roommate", "dorm"] },
    { value: "academics", label: "Faculty or academics", aliases: ["faculty", "academics", "class", "professor"] },
    { value: "facilities", label: "Facilities or accessibility", aliases: ["facilities", "accessibility", "restroom", "bathroom"] },
    { value: "climate", label: "Campus climate", aliases: ["climate", "graffiti", "policy"] },
    UNSURE
  ];

  function isIncident(a) { return a.path && a.path.value === "incident"; }

  var nodes = {
    welcome: {
      type: "choice", step: 0,
      say: function () {
        return [
          "Hi. I’m Pride Guide, the automated reporting assistant for UNewHaven Pride Report. I’m a scripted program — not a person, a counselor, or a University official.",
          "This is an independent student-led service, not an official University complaint process. Reports are not monitored continuously.",
          context.demo
            ? "This site is currently a demo. Nothing you enter is sent anywhere, so please don’t include real names or real incidents."
            : null,
          "Are you ready to continue?"
        ].filter(Boolean);
      },
      options: [
        { value: "continue", label: "Yes, continue", aliases: ["yes", "y", "continue", "ok", "okay", "ready"], next: "safety" },
        { value: "privacy", label: "Explain privacy first", aliases: ["privacy", "explain privacy", "explain"], next: "privacy" }
      ]
    },

    privacy: {
      type: "choice", step: 0,
      say: function () {
        return [
          "Who runs this? Students. Pride Report is not part of the University, and reviewers have no power to investigate or discipline anyone.",
          context.demo
            ? "What is recorded? In this demo, your answers are kept only in this browser so you can try the tracking page. They are not sent to a server."
            : "What is recorded? Only what you choose to submit at the end. You can skip nearly every question, and you don’t need to give your name, a login, an email or a phone number.",
          "Is it anonymous? You can report without identifying yourself, but details you write may still identify you, and the companies that host this site process technical information such as IP addresses. We can’t promise complete anonymity.",
          "Is it monitored? No. " + (context.expectation || "Reports are read by student reviewers when they are able to, not in real time."),
          "The About & privacy page has the full details. Ready to continue?"
        ];
      },
      links: [{ label: "Open About & privacy", href: "about.html", newTab: true }],
      options: [
        { value: "continue", label: "OK, continue", aliases: ["yes", "ok", "okay", "continue"], next: "safety" },
        { value: "stop", label: "I’ll stop here", aliases: ["stop", "no", "exit"], next: "bye" }
      ]
    },

    safety: {
      type: "choice", step: 1,
      say: ["Before we start: are you, or is anyone else, in immediate danger right now?"],
      options: [
        { value: "safe", label: "No, I’m safe right now", aliases: ["no", "safe", "i'm safe", "im safe"], next: "path" },
        { value: "danger", label: "Yes", aliases: ["yes", "danger"], next: "emergency" },
        { value: "unsure", label: "I’m not sure", aliases: ["not sure", "unsure", "maybe"], next: "emergency" }
      ]
    },

    emergency: {
      type: "choice", step: 1, tone: "urgent",
      say: [
        "I can’t call anyone or send help — I’m an automated tool and nobody is watching this conversation live.",
        "If there is immediate danger, call 911, or University Public Safety at (203) 932-7070.",
        "If you’re thinking about harming yourself, you can call or text 988 at any time.",
        "You can come back to this whenever you want. What would you like to do?"
      ],
      links: [
        { label: "Call 911", href: "tel:911" },
        { label: "Call Public Safety", href: "tel:+12039327070" },
        { label: "Call or text 988", href: "tel:988" }
      ],
      options: [
        { value: "continue", label: "Continue to the report", aliases: ["continue"], next: "path" },
        { value: "stop", label: "Stop for now", aliases: ["stop"], next: "bye" }
      ]
    },

    path: {
      type: "choice", step: 2, field: "path",
      say: ["What would you like to do today?"],
      options: [
        { value: "incident", label: "Report an incident", aliases: ["incident", "report"], next: "category" },
        { value: "concern", label: "Share a campus concern", aliases: ["concern", "campus concern"], next: "category" },
        { value: "support", label: "Find support", aliases: ["support", "resources", "help"], next: "support" },
        { value: "followup", label: "Follow up on a report", aliases: ["follow up", "followup", "track"], next: "followup" }
      ]
    },

    support: {
      type: "choice", step: 2, field: "path",
      say: [
        "The Resources page lists campus and national support, including the Myatt Center for Diversity and Inclusion at (203) 932-7427, and explains the official University reporting routes.",
        "You don’t need to file anything to use those. Would you like to do anything else here?"
      ],
      links: [{ label: "Open Resources", href: "resources.html", newTab: true }],
      options: [
        { value: "incident", label: "Report an incident", next: "category" },
        { value: "concern", label: "Share a campus concern", next: "category" },
        { value: "done", label: "I’m done for now", aliases: ["done", "no", "stop"], next: "bye" }
      ]
    },

    followup: {
      type: "choice", step: 2, field: "path",
      say: [
        "To check on a report you already submitted, open the My report page and enter your private access code.",
        "Would you like to do anything else here?"
      ],
      links: [{ label: "Open My report", href: "track.html" }],
      options: [
        { value: "incident", label: "Report an incident", next: "category" },
        { value: "concern", label: "Share a campus concern", next: "category" },
        { value: "done", label: "I’m done for now", aliases: ["done", "no", "stop"], next: "bye" }
      ]
    },

    category: {
      type: "choice", step: 3, field: "category", allowText: true, optional: true, maxLength: 300,
      say: function (a) {
        return [
          isIncident(a)
            ? "Which of these is closest to what happened? If none fit, type your own words instead."
            : "Which of these is closest to your concern? If none fit, type your own words instead.",
          "This only helps route your report. Choosing a category isn’t a judgment about what it “counts” as."
        ];
      },
      options: categories,
      next: "what"
    },

    what: {
      type: "text", step: 4, field: "what", optional: true, multiline: true,
      placeholder: "Type here, or skip",
      say: function (a) {
        return [
          isIncident(a)
            ? "In your own words, what happened? Share as much or as little as you want."
            : "In your own words, what is the concern? Share as much or as little as you want.",
          "You don’t need to include anyone’s name. Anything you write here will be visible to the student reviewers."
        ];
      },
      next: function (a) { return isIncident(a) ? "when" : "where"; }
    },

    when: {
      type: "choice", step: 5, field: "when", allowText: true, optional: true, maxLength: 300,
      say: ["Roughly when did it happen? You can also type a date."],
      options: [
        { value: "recent", label: "Today or yesterday", aliases: ["today", "yesterday"] },
        { value: "week", label: "In the past week", aliases: ["this week", "past week"] },
        { value: "month", label: "In the past month", aliases: ["this month", "past month"] },
        { value: "earlier", label: "Longer ago", aliases: ["earlier", "a while ago"] },
        UNSURE
      ],
      next: "where"
    },

    where: {
      type: "choice", step: 6, field: "where", allowText: true, optional: true, maxLength: 300,
      say: function (a) {
        return [isIncident(a)
          ? "Where did it happen? A general answer is fine."
          : "Where on campus does this come up? A general answer is fine."];
      },
      options: [
        { value: "residence", label: "Residence hall", aliases: ["dorm", "residence"] },
        { value: "academic", label: "Classroom or academic building", aliases: ["classroom", "class", "academic building"] },
        { value: "common", label: "Dining or common space", aliases: ["dining", "common space"] },
        { value: "office", label: "Campus office or service", aliases: ["office", "campus office"] },
        { value: "athletics", label: "Athletics or recreation", aliases: ["athletics", "recreation", "gym"] },
        { value: "online", label: "Online or social media", aliases: ["online", "social media"] },
        { value: "off_campus", label: "Off campus", aliases: ["off campus"] },
        { value: "campus_wide", label: "Campus-wide", aliases: ["everywhere", "campus wide"] },
        UNSURE
      ],
      next: function (a) { return isIncident(a) ? "who" : "frequency"; }
    },

    who: {
      type: "choice", step: 7, field: "who", optional: true,
      say: [
        "Who was involved? Please choose a general description rather than a name.",
        "Pride Report documents what you share. It doesn’t investigate or decide whether anyone did something wrong."
      ],
      options: [
        { value: "student", label: "Another student or students", aliases: ["student", "students"] },
        { value: "faculty", label: "Faculty or an instructor", aliases: ["faculty", "instructor", "professor"] },
        { value: "staff", label: "University staff", aliases: ["staff"] },
        { value: "non_affiliated", label: "Someone not affiliated with the University", aliases: ["not affiliated", "visitor"] },
        { value: "unknown", label: "I don’t know who", aliases: ["unknown", "don't know", "dont know"] }
      ],
      next: "frequency"
    },

    frequency: {
      type: "choice", step: 8, field: "frequency", optional: true,
      say: function (a) {
        return [isIncident(a) ? "Has this happened more than once?" : "Is this a one-time issue or an ongoing one?"];
      },
      options: [
        { value: "once", label: "One time", aliases: ["once", "one time", "no"] },
        { value: "repeated", label: "More than once", aliases: ["repeated", "more than once", "yes"] },
        { value: "ongoing", label: "It’s ongoing", aliases: ["ongoing"] },
        UNSURE
      ],
      next: function (a) { return isIncident(a) ? "role" : "anything_else"; }
    },

    role: {
      type: "choice", step: 9, field: "role", optional: true,
      say: ["How are you connected to it?"],
      options: [
        { value: "experienced", label: "It happened to me", aliases: ["me", "happened to me"] },
        { value: "witnessed", label: "I witnessed it", aliases: ["witness", "witnessed", "i saw it"] },
        { value: "heard", label: "Someone told me about it", aliases: ["heard", "someone told me"] }
      ],
      next: "reported"
    },

    reported: {
      type: "choice", step: 10, field: "reported", optional: true,
      say: ["Has this been reported to a University office, such as Report It!, Title IX, or Public Safety?"],
      options: [
        { value: "yes", label: "Yes", aliases: ["yes", "y"] },
        { value: "no", label: "No", aliases: ["no", "n"] },
        UNSURE
      ],
      next: "anything_else"
    },

    anything_else: {
      type: "text", step: 11, field: "anything_else", optional: true, multiline: true,
      placeholder: "Type here, or skip",
      say: ["Is there anything else you want the reviewers to know?"],
      next: "wants"
    },

    wants: {
      type: "multi", step: 12, field: "wants", optional: true,
      say: ["What would be helpful? Choose any that apply, then select Done."],
      options: [
        { value: "document", label: "Just document it" },
        { value: "resources", label: "Information about support resources" },
        { value: "official", label: "Help understanding official reporting options" },
        { value: "reply", label: "A reply from a student reviewer" }
      ],
      next: "contact_mode"
    },

    contact_mode: {
      type: "choice", step: 13, field: "contact_mode",
      say: function (a) {
        var wantsReply = a.wants && a.wants.values && a.wants.values.indexOf("reply") !== -1;
        return [
          "Last question: how would you like to submit this?",
          "• Anonymous — no name or contact details. You get an access code to view your report, but reviewers can’t message you.\n" +
          "• Private follow-up — still no name or contact details. You and a reviewer can exchange messages on this site using your access code.\n" +
          "• Identified — you choose to share a name and a way to reach you.",
          wantsReply ? "You asked for a reply, so private follow-up or identified would make that possible." : null
        ].filter(Boolean);
      },
      options: [
        { value: "anonymous", label: "Anonymous", aliases: ["anonymous", "anon"] },
        { value: "portal", label: "Private follow-up on this site", aliases: ["private", "private follow up", "follow up", "portal"] },
        { value: "identified", label: "Identified", aliases: ["identified", "share my name"] }
      ],
      onAnswer: function (answers, ans) {
        if (ans.value !== "identified") {
          delete answers.contact_name;
          delete answers.contact_method;
        }
      },
      next: function (a) { return a.contact_mode.value === "identified" ? "contact_name" : "review"; }
    },

    contact_name: {
      type: "text", step: 13, field: "contact_name", optional: true, partOf: "contact_mode", maxLength: 120,
      placeholder: "Name to use for you",
      say: ["What name should a reviewer use for you? It doesn’t have to be your legal name."],
      next: "contact_method"
    },

    contact_method: {
      type: "text", step: 13, field: "contact_method", partOf: "contact_mode", maxLength: 200,
      placeholder: "Email or phone number",
      say: ["What’s the best way to reach you? For example, an email address or phone number you’re comfortable using."],
      next: "review"
    },

    review: {
      type: "review", step: 14,
      say: [
        "Here is everything you’ve told me. Nothing has been submitted yet.",
        "You can change any answer. When you’re ready, confirm the two statements and submit."
      ],
      next: "submitted"
    },

    submitted: { type: "end", step: 14, receipt: true, say: [] },

    bye: {
      type: "end", step: 0,
      say: [
        "Okay. Nothing has been submitted.",
        "You can come back any time. If you need support now, the Resources page lists people you can contact."
      ],
      links: [{ label: "Open Resources", href: "resources.html" }]
    }
  };

  var summaryFields = [
    { node: "path", label: "Type", editable: false },
    { node: "category", label: "Category" },
    { node: "what", label: "What happened", concernLabel: "The concern" },
    { node: "when", label: "When", incidentOnly: true },
    { node: "where", label: "Where" },
    { node: "who", label: "Who was involved", incidentOnly: true },
    { node: "frequency", label: "How often" },
    { node: "role", label: "Your connection", incidentOnly: true },
    { node: "reported", label: "Reported to the University", incidentOnly: true },
    { node: "anything_else", label: "Anything else" },
    { node: "wants", label: "What would help" },
    { node: "contact_mode", label: "How you’re submitting" },
    { node: "contact_name", label: "Name", identifiedOnly: true },
    { node: "contact_method", label: "Contact", identifiedOnly: true }
  ];

  function summary(answers) {
    var incident = isIncident(answers);
    var identified = answers.contact_mode && answers.contact_mode.value === "identified";
    return summaryFields.filter(function (f) {
      if (f.incidentOnly && !incident) return false;
      if (f.identifiedOnly && !identified) return false;
      return true;
    }).map(function (f) {
      return {
        node: f.node,
        label: !incident && f.concernLabel ? f.concernLabel : f.label,
        editable: f.editable !== false,
        answer: answers[nodes[f.node].field]
      };
    });
  }

  function choice(ans) {
    if (!ans || ans.skipped) return null;
    return ans.value === "other" ? { value: "other", text: ans.text } : { value: ans.value };
  }
  function text(ans) { return ans && !ans.skipped && ans.text ? ans.text : null; }

  /** The JSON document that is submitted. Skipped questions become null. */
  function toReport(a) {
    var identified = a.contact_mode && a.contact_mode.value === "identified";
    return {
      version: 1,
      path: a.path ? a.path.value : null,
      category: choice(a.category),
      what: text(a.what),
      when: choice(a.when),
      where: choice(a.where),
      who: choice(a.who),
      frequency: choice(a.frequency),
      role: choice(a.role),
      reported: choice(a.reported),
      anything_else: text(a.anything_else),
      wants: a.wants && a.wants.values ? a.wants.values.slice() : [],
      contact_mode: a.contact_mode ? a.contact_mode.value : null,
      contact_name: identified ? text(a.contact_name) : null,
      contact_method: identified ? text(a.contact_method) : null
    };
  }

  /** Label for a stored choice value, used by the tracking page and dashboard. */
  function labelFor(nodeId, value) {
    if (!value) return "Skipped";
    if (typeof value === "string") {
      var opts = nodes[nodeId] && nodes[nodeId].options;
      var hit = opts && opts.filter(function (o) { return o.value === value; })[0];
      return hit ? hit.label : value;
    }
    if (value.value === "other") return value.text || "Other";
    return labelFor(nodeId, value.value);
  }

  // A rule-based safety net, not a risk assessment: when someone writes about self-harm we show crisis
  // contacts immediately rather than waiting for a reviewer who may not read the report for days.
  var crisisPattern = /\b(kill(ing)? myself|suicid(e|al)|end(ing)? my (own )?life|hurt(ing)? myself|harm(ing)? myself|self[- ]harm|don'?t want to (live|be alive|be here anymore)|want to die)\b/i;
  function detectCrisis(str) { return crisisPattern.test(String(str || "")); }

  return {
    start: "welcome",
    totalSteps: 14,
    maxLength: 4000,
    nodes: nodes,
    context: context,
    summary: summary,
    toReport: toReport,
    labelFor: labelFor,
    detectCrisis: detectCrisis,
    statuses: {
      received: { label: "Received", detail: "The system stored the report." },
      under_review: { label: "Under review", detail: "An authorized reviewer has opened it." },
      response_available: { label: "Response available", detail: "A reviewer has added a message or resource." },
      closed: { label: "Closed", detail: "Student-led review is complete. This does not mean the University resolved the underlying concern." }
    }
  };
});
