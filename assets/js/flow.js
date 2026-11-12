/* Pride Guide script: every question, option and branch.
 *
 * Tone rules for anyone editing this file:
 *  - Help comes first. The first real question is "What can we do for you?".
 *  - Neutral, calm, direct. No exaggerated sympathy, no guessing at anyone's identity.
 *  - Never judge whether something "counts" as discrimination, and never promise an outcome.
 *  - Never claim to be a person, a counselor, or a University official.
 *  - Every incident-detail question must be skippable.
 *  - Do not ask for the student's sexual orientation or gender identity.
 *  - Emergency contacts: University Public Safety first, then 911.
 *  - No em dashes in anything a student reads.
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
  //   mode:     "demo" | "email" | "backend"
  //   tracking: true when students can come back with an access code (demo and backend modes)
  var context = { mode: "demo", tracking: true, expectation: "" };

  var UNSURE = { value: "unsure", label: "I’m not sure", aliases: ["not sure", "unsure", "idk", "i don't know", "dont know"] };

  // The four kinds of direct help, in the order students see them.
  var HELP_NEEDS = ["advocate", "office", "support", "conflict"];

  function has(a, need) { return !!(a.needs && a.needs.values && a.needs.values.indexOf(need) !== -1); }
  function wantsHelp(a) { return HELP_NEEDS.some(function (n) { return has(a, n); }); }
  function isIncident(a) { return !!(a.path && a.path.value === "incident"); }

  // After "What can we do for you?", ask one short follow-up for each kind of help that was chosen.
  var DETAIL_ORDER = [["advocate", "advocate_consent"], ["office", "office_which"], ["support", "support_kind"], ["conflict", "conflict_with"]];
  function nextDetail(a, after) {
    var start = 0;
    for (var i = 0; i < DETAIL_ORDER.length; i++) if (DETAIL_ORDER[i][0] === after) start = i + 1;
    for (var j = start; j < DETAIL_ORDER.length; j++) if (has(a, DETAIL_ORDER[j][0])) return DETAIL_ORDER[j][1];
    return "path";
  }

  var nodes = {
    welcome: {
      type: "choice", step: 0,
      say: function () {
        return [
          "Hi. I’m Pride Guide, the automated assistant for UNewHaven Pride Report. I’m a scripted program, not a person, a counselor, or a University official.",
          "Pride Report is run by students. We can advocate for you, help you deal with a University office, support you, or help resolve a conflict. It is not an official University complaint process, and it is not monitored live.",
          context.mode === "demo"
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
        var recorded = {
          demo: "What is recorded? In this demo, your answers are kept only in this browser so you can try the rest of the site. They are not sent anywhere.",
          email: "What is recorded? Only what you choose to submit at the end. It is delivered by email to the Pride Report reviewers’ inbox through a form delivery service. You can skip nearly every question.",
          backend: "What is recorded? Only what you choose to submit at the end. You can skip nearly every question, and you don’t need to give your name, a login, an email or a phone number."
        };
        return [
          "Who runs this? Students. Pride Report is not part of the University, and reviewers have no power to investigate or discipline anyone.",
          recorded[context.mode] || recorded.backend,
          "Is it anonymous? You can submit without identifying yourself, but details you write may still identify you, and the companies that host and deliver this site process technical information such as IP addresses. We can’t promise complete anonymity.",
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
        { value: "safe", label: "No, I’m safe right now", aliases: ["no", "safe", "i'm safe", "im safe"], next: "needs" },
        { value: "danger", label: "Yes", aliases: ["yes", "danger"], next: "emergency" },
        { value: "unsure", label: "I’m not sure", aliases: ["not sure", "unsure", "maybe"], next: "emergency" }
      ]
    },

    emergency: {
      type: "choice", step: 1, tone: "urgent",
      say: [
        "I can’t call anyone or send help. I’m an automated tool and nobody is watching this conversation live.",
        "If there is immediate danger, call University Public Safety at (203) 932-7070, or call 911.",
        "If you’re thinking about harming yourself, you can call or text 988 at any time.",
        "You can come back to this whenever you want. What would you like to do?"
      ],
      links: [
        { label: "Call Public Safety", href: "tel:+12039327070" },
        { label: "Call 911", href: "tel:911" },
        { label: "Call or text 988", href: "tel:988" }
      ],
      options: [
        { value: "continue", label: "Continue", aliases: ["continue"], next: "needs" },
        { value: "stop", label: "Stop for now", aliases: ["stop"], next: "bye" }
      ]
    },

    needs: {
      type: "multi", step: 2, field: "needs",
      say: [
        "What can we do for you? Choose everything that fits, then select Done.",
        "If you only want something on the record, choose “Just document it”."
      ],
      links: [
        { label: "Browse resources instead", href: "resources.html", newTab: true },
        { label: "Check on a report I already sent", href: "track.html" }
      ],
      options: [
        { value: "advocate", label: "Advocate for me" },
        { value: "office", label: "Help me with a University office" },
        { value: "support", label: "Support me" },
        { value: "conflict", label: "Help me resolve a conflict" },
        { value: "official", label: "Explain my official reporting options" },
        { value: "document", label: "Just document it" },
        { value: "unsure", label: "I’m not sure yet" }
      ],
      onAnswer: function (answers) {
        // Drop follow-up answers that belong to kinds of help the student has unselected.
        if (!has(answers, "advocate")) delete answers.advocate_consent;
        if (!has(answers, "office")) delete answers.office_which;
        if (!has(answers, "support")) delete answers.support_kind;
        if (!has(answers, "conflict")) { delete answers.conflict_with; delete answers.conflict_contact; }
      },
      next: function (a) { return nextDetail(a, null); }
    },

    advocate_consent: {
      type: "choice", step: 3, field: "advocate_consent", optional: true, partOf: "needs",
      say: [
        "You asked us to advocate for you. Advocating can mean a student reviewer raising this with a University office or staff member.",
        "How would you like us to do that? Nothing is raised with anyone until a reviewer has read your report."
      ],
      options: [
        { value: "ask_first", label: "Talk to me before doing anything", aliases: ["talk to me first", "ask first", "ask me first"] },
        { value: "without_name", label: "Raise it without naming me", aliases: ["without my name", "no name"] },
        { value: "with_name", label: "You can use my name", aliases: ["use my name", "with my name"] },
        UNSURE
      ],
      next: function (a) { return nextDetail(a, "advocate"); }
    },

    office_which: {
      type: "choice", step: 3, field: "office_which", allowText: true, optional: true, maxLength: 300, partOf: "needs",
      say: ["Which office or service do you need help with? If it isn’t listed, type it."],
      options: [
        { value: "housing", label: "Housing or residential life", aliases: ["housing", "residential life", "reslife"] },
        { value: "records", label: "Records or registration (name, ID, email)", aliases: ["registrar", "records", "name change"] },
        { value: "health", label: "Health or counseling services", aliases: ["health", "counseling"] },
        { value: "financial", label: "Financial aid or billing", aliases: ["financial aid", "billing", "bursar"] },
        { value: "student_affairs", label: "Student affairs or conduct", aliases: ["dean of students", "student affairs", "conduct"] },
        { value: "title_ix", label: "Title IX", aliases: ["title ix", "title 9"] },
        { value: "public_safety", label: "Public Safety", aliases: ["public safety", "campus police"] },
        { value: "athletics", label: "Athletics or recreation", aliases: ["athletics", "recreation"] },
        { value: "academic", label: "An academic department or advisor", aliases: ["department", "advisor", "academic"] },
        UNSURE
      ],
      next: function (a) { return nextDetail(a, "office"); }
    },

    support_kind: {
      type: "choice", step: 3, field: "support_kind", optional: true, partOf: "needs",
      say: [
        "What kind of support would help most?",
        "Reviewers are trained students, not counselors. They can also point you to professional support."
      ],
      options: [
        { value: "talk", label: "A student to talk it through with", aliases: ["talk", "someone to talk to"] },
        { value: "accompany", label: "Someone to come with me to a meeting or office", aliases: ["come with me", "accompany"] },
        { value: "resources", label: "Help finding counseling or community", aliases: ["counseling", "community", "resources"] },
        { value: "checkin", label: "Someone to check in with me", aliases: ["check in", "check-ins"] },
        UNSURE
      ],
      next: function (a) { return nextDetail(a, "support"); }
    },

    conflict_with: {
      type: "choice", step: 3, field: "conflict_with", optional: true, partOf: "needs",
      say: ["Who is the conflict with? A general description is enough. You don’t need to name anyone."],
      options: [
        { value: "roommate", label: "A roommate or housemate", aliases: ["roommate", "housemate"] },
        { value: "student", label: "Another student", aliases: ["student", "classmate"] },
        { value: "group", label: "A student group or team", aliases: ["group", "club", "team"] },
        { value: "faculty", label: "Faculty or an instructor", aliases: ["faculty", "instructor", "professor"] },
        { value: "staff", label: "University staff", aliases: ["staff"] },
        UNSURE
      ],
      next: "conflict_contact"
    },

    conflict_contact: {
      type: "choice", step: 3, field: "conflict_contact", optional: true, partOf: "needs",
      say: [
        "Resolving a conflict usually means the other person learns that you asked for help.",
        "How do you feel about that? A reviewer will never contact them without talking to you first."
      ],
      options: [
        { value: "ok", label: "That’s OK with me", aliases: ["ok", "okay", "fine", "yes"] },
        { value: "ask_first", label: "Only after checking with me", aliases: ["ask first", "check with me"] },
        { value: "no", label: "I’d rather they not know", aliases: ["no", "rather not"] },
        UNSURE
      ],
      next: function (a) { return nextDetail(a, "conflict"); }
    },

    path: {
      type: "choice", step: 4, field: "path",
      say: ["Is this about something specific that happened, or a more general situation?"],
      options: [
        { value: "incident", label: "Something specific that happened", aliases: ["incident", "something happened", "specific"] },
        { value: "concern", label: "An ongoing situation or general concern", aliases: ["concern", "general", "ongoing", "situation"] }
      ],
      onAnswer: function (answers, ans) {
        if (ans.value !== "incident") {
          delete answers.when; delete answers.who; delete answers.role; delete answers.reported;
        }
      },
      next: "category"
    },

    category: {
      type: "choice", step: 5, field: "category", allowText: true, optional: true, maxLength: 300,
      say: [
        "Which of these is closest to what it’s about? If none fit, type your own words instead.",
        "This only helps route your report. Choosing a category isn’t a judgment about what it “counts” as."
      ],
      options: [
        { value: "harassment", label: "Harassment or bullying", aliases: ["harassment", "bullying"] },
        { value: "discrimination", label: "Discrimination", aliases: ["unequal treatment"] },
        { value: "deadnaming", label: "Deadnaming or misgendering", aliases: ["deadnaming", "misgendering", "pronouns"] },
        { value: "housing", label: "Housing or residence life", aliases: ["housing", "residence life", "roommate", "dorm"] },
        { value: "academics", label: "Faculty or academics", aliases: ["faculty", "academics", "class", "professor"] },
        { value: "facilities", label: "Facilities or accessibility", aliases: ["facilities", "accessibility", "restroom", "bathroom"] },
        { value: "climate", label: "Campus climate", aliases: ["climate", "graffiti", "policy"] },
        UNSURE
      ],
      next: "what"
    },

    what: {
      type: "text", step: 6, field: "what", optional: true, multiline: true,
      placeholder: "Type here, or skip",
      say: function (a) {
        return [
          isIncident(a)
            ? "In your own words, what happened? Share as much or as little as you want."
            : "In your own words, what is going on? Share as much or as little as you want.",
          "You don’t need to include anyone’s name. Anything you write here will be read by the student reviewers."
        ];
      },
      next: function (a) { return isIncident(a) ? "when" : "where"; }
    },

    when: {
      type: "choice", step: 7, field: "when", allowText: true, optional: true, maxLength: 300,
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
      type: "choice", step: 8, field: "where", allowText: true, optional: true, maxLength: 300,
      say: function (a) {
        return [isIncident(a)
          ? "Where did it happen? A general answer is fine."
          : "Where does this come up? A general answer is fine."];
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
      type: "choice", step: 9, field: "who", optional: true,
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
      type: "choice", step: 10, field: "frequency", optional: true,
      say: function (a) {
        return [isIncident(a) ? "Has this happened more than once?" : "Is this a one-time issue or an ongoing one?"];
      },
      options: [
        { value: "once", label: "One time", aliases: ["once", "one time", "no"] },
        { value: "repeated", label: "More than once", aliases: ["repeated", "more than once", "yes"] },
        { value: "ongoing", label: "It’s ongoing", aliases: ["ongoing"] },
        UNSURE
      ],
      next: function (a) { return isIncident(a) ? "role" : "outcome"; }
    },

    role: {
      type: "choice", step: 11, field: "role", optional: true,
      say: ["How are you connected to it?"],
      options: [
        { value: "experienced", label: "It happened to me", aliases: ["me", "happened to me"] },
        { value: "witnessed", label: "I witnessed it", aliases: ["witness", "witnessed", "i saw it"] },
        { value: "heard", label: "Someone told me about it", aliases: ["heard", "someone told me"] }
      ],
      next: "reported"
    },

    reported: {
      type: "choice", step: 12, field: "reported", optional: true,
      say: ["Has this been reported to a University office, such as Report It!, Title IX, or Public Safety?"],
      options: [
        { value: "yes", label: "Yes", aliases: ["yes", "y"] },
        { value: "no", label: "No", aliases: ["no", "n"] },
        UNSURE
      ],
      next: "outcome"
    },

    outcome: {
      type: "text", step: 13, field: "outcome", optional: true, multiline: true, maxLength: 2000,
      placeholder: "Type here, or skip",
      say: [
        "What would a good outcome look like for you?",
        "For example: an apology, a room change, a corrected name on a roster, a policy fixed, or just being heard. We can’t promise a result, but it tells reviewers what to work toward."
      ],
      next: "timing"
    },

    timing: {
      type: "choice", step: 14, field: "timing", allowText: true, optional: true, maxLength: 300,
      say: ["Is there a deadline or date coming up that we should know about? You can also type one."],
      options: [
        { value: "none", label: "No deadline", aliases: ["no", "none", "no deadline"] },
        { value: "days", label: "Within a few days", aliases: ["days", "this week", "soon"] },
        { value: "weeks", label: "Within a few weeks", aliases: ["weeks", "this month"] },
        UNSURE
      ],
      next: "anything_else"
    },

    anything_else: {
      type: "text", step: 15, field: "anything_else", optional: true, multiline: true,
      placeholder: "Type here, or skip",
      say: ["Is there anything else you want the reviewers to know?"],
      next: "contact_mode"
    },

    contact_mode: {
      type: "choice", step: 16, field: "contact_mode",
      say: function (a) {
        var lines = ["Last part: how would you like to submit this?"];
        var choices = "• Anonymous: no name or contact details. " + (context.tracking
          ? "You get an access code to view your report, but reviewers can’t message you."
          : "Reviewers will read it but have no way to reply to you.");
        if (context.tracking) {
          choices += "\n• Private follow-up: still no name or contact details. You and a reviewer exchange messages on this site using your access code.";
        }
        choices += "\n• Identified: you choose to share a name and a way to reach you.";
        lines.push(choices);
        if (wantsHelp(a)) {
          lines.push(context.tracking
            ? "You asked for help, so a reviewer needs a way to reach you. Private follow-up or identified makes that possible."
            : "You asked for help, so a reviewer needs a way to reach you. Choose identified if you’d like us to act on this with you.");
        }
        return lines;
      },
      get options() {
        var all = [
          { value: "anonymous", label: "Anonymous", aliases: ["anonymous", "anon"] },
          { value: "portal", label: "Private follow-up on this site", aliases: ["private", "private follow up", "follow up", "portal"] },
          { value: "identified", label: "Identified", aliases: ["identified", "share my name"] }
        ];
        return context.tracking ? all : all.filter(function (o) { return o.value !== "portal"; });
      },
      onAnswer: function (answers, ans) {
        if (ans.value !== "identified") {
          delete answers.contact_name;
          delete answers.contact_method;
          delete answers.contact_discreet;
        }
      },
      next: function (a) { return a.contact_mode.value === "identified" ? "contact_name" : "review"; }
    },

    contact_name: {
      type: "text", step: 16, field: "contact_name", optional: true, partOf: "contact_mode", maxLength: 120,
      placeholder: "Name to use for you",
      say: ["What name should a reviewer use for you? It doesn’t have to be your legal name."],
      next: "contact_method"
    },

    contact_method: {
      type: "text", step: 16, field: "contact_method", partOf: "contact_mode", maxLength: 200,
      placeholder: "Email or phone number",
      say: ["What’s the best way to reach you? For example, an email address or phone number you’re comfortable using."],
      next: "contact_discreet"
    },

    contact_discreet: {
      type: "choice", step: 16, field: "contact_discreet", optional: true, partOf: "contact_mode",
      say: ["When a reviewer contacts you, is it OK for the message to mention Pride Report?"],
      options: [
        { value: "ok", label: "Yes, that’s fine", aliases: ["yes", "fine", "ok", "okay"] },
        { value: "discreet", label: "No, please be discreet", aliases: ["no", "discreet", "be discreet"] }
      ],
      next: "review"
    },

    review: {
      type: "review", step: 17,
      say: [
        "Here is everything you’ve told me. Nothing has been submitted yet.",
        "You can change any answer. When you’re ready, confirm the two statements and submit."
      ],
      next: "submitted"
    },

    submitted: { type: "end", step: 17, receipt: true, say: [] },

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
    { node: "needs", label: "What we can do for you" },
    { node: "advocate_consent", label: "How to advocate", need: "advocate" },
    { node: "office_which", label: "Office or service", need: "office" },
    { node: "support_kind", label: "Kind of support", need: "support" },
    { node: "conflict_with", label: "Conflict with", need: "conflict" },
    { node: "conflict_contact", label: "Involving the other person", need: "conflict" },
    { node: "path", label: "About" },
    { node: "category", label: "Category" },
    { node: "what", label: "What happened", concernLabel: "What is going on" },
    { node: "when", label: "When", incidentOnly: true },
    { node: "where", label: "Where" },
    { node: "who", label: "Who was involved", incidentOnly: true },
    { node: "frequency", label: "How often" },
    { node: "role", label: "Your connection", incidentOnly: true },
    { node: "reported", label: "Reported to the University", incidentOnly: true },
    { node: "outcome", label: "A good outcome" },
    { node: "timing", label: "Deadline or date" },
    { node: "anything_else", label: "Anything else" },
    { node: "contact_mode", label: "How you’re submitting" },
    { node: "contact_name", label: "Name", identifiedOnly: true },
    { node: "contact_method", label: "Contact", identifiedOnly: true },
    { node: "contact_discreet", label: "OK to mention Pride Report", identifiedOnly: true }
  ];

  function summary(answers) {
    var incident = isIncident(answers);
    var identified = answers.contact_mode && answers.contact_mode.value === "identified";
    return summaryFields.filter(function (f) {
      if (f.incidentOnly && !incident) return false;
      if (f.identifiedOnly && !identified) return false;
      if (f.need && !has(answers, f.need)) return false;
      return true;
    }).map(function (f) {
      return {
        node: f.node,
        label: !incident && f.concernLabel ? f.concernLabel : f.label,
        editable: true,
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
    var identified = !!(a.contact_mode && a.contact_mode.value === "identified");
    var incident = isIncident(a);
    return {
      version: 2,
      needs: a.needs && a.needs.values ? a.needs.values.slice() : [],
      advocate_consent: has(a, "advocate") ? choice(a.advocate_consent) : null,
      office_which: has(a, "office") ? choice(a.office_which) : null,
      support_kind: has(a, "support") ? choice(a.support_kind) : null,
      conflict_with: has(a, "conflict") ? choice(a.conflict_with) : null,
      conflict_contact: has(a, "conflict") ? choice(a.conflict_contact) : null,
      path: a.path ? a.path.value : null,
      category: choice(a.category),
      what: text(a.what),
      when: incident ? choice(a.when) : null,
      where: choice(a.where),
      who: incident ? choice(a.who) : null,
      frequency: choice(a.frequency),
      role: incident ? choice(a.role) : null,
      reported: incident ? choice(a.reported) : null,
      outcome: text(a.outcome),
      timing: choice(a.timing),
      anything_else: text(a.anything_else),
      contact_mode: a.contact_mode ? a.contact_mode.value : null,
      contact_name: identified ? text(a.contact_name) : null,
      contact_method: identified ? text(a.contact_method) : null,
      contact_discreet: identified ? choice(a.contact_discreet) : null
    };
  }

  /** Label for a stored choice value, used by the tracking page, emails and the dashboard. */
  function labelFor(nodeId, value) {
    if (value === null || value === undefined || value === "") return "Skipped";
    if (Array.isArray(value)) {
      return value.length ? value.map(function (v) { return labelFor(nodeId, v); }).join(", ") : "Nothing selected";
    }
    if (typeof value === "string") {
      var opts = nodes[nodeId] && nodes[nodeId].options;
      var hit = opts && opts.filter(function (o) { return o.value === value; })[0];
      if (hit) return hit.label;
      // "portal" is hidden from students in email mode but may still appear in stored reports.
      return value === "portal" ? "Private follow-up on this site" : value;
    }
    if (value.value === "other") return value.text || "Other";
    return labelFor(nodeId, value.value);
  }

  /**
   * A stored report as ordered [label, text] rows. One definition shared by the tracking page,
   * the dashboard and the emailed copy, so they can never disagree.
   */
  function describeReport(r, opts) {
    var rows = [];
    var contact = !opts || opts.contact !== false;
    function add(label, value) { if (value !== null && value !== undefined && value !== "") rows.push([label, value]); }
    function pick(label, nodeId, value) { if (value) add(label, labelFor(nodeId, value)); }
    var needs = r.needs || [];
    add("What we can do for you", labelFor("needs", needs));
    if (needs.indexOf("advocate") !== -1) pick("How to advocate", "advocate_consent", r.advocate_consent);
    if (needs.indexOf("office") !== -1) pick("Office or service", "office_which", r.office_which);
    if (needs.indexOf("support") !== -1) pick("Kind of support", "support_kind", r.support_kind);
    if (needs.indexOf("conflict") !== -1) {
      pick("Conflict with", "conflict_with", r.conflict_with);
      pick("Involving the other person", "conflict_contact", r.conflict_contact);
    }
    pick("About", "path", r.path);
    pick("Category", "category", r.category);
    add(r.path === "concern" ? "What is going on" : "What happened", r.what);
    pick("When", "when", r.when);
    pick("Where", "where", r.where);
    pick("Who was involved", "who", r.who);
    pick("How often", "frequency", r.frequency);
    pick("Connection to it", "role", r.role);
    pick("Reported to the University", "reported", r.reported);
    add("A good outcome", r.outcome);
    pick("Deadline or date", "timing", r.timing);
    add("Anything else", r.anything_else);
    if (contact) {
      pick("Submitted as", "contact_mode", r.contact_mode);
      add("Name", r.contact_name);
      add("Contact", r.contact_method);
      pick("OK to mention Pride Report", "contact_discreet", r.contact_discreet);
    }
    return rows;
  }

  // A rule-based safety net, not a risk assessment: when someone writes about self-harm we show crisis
  // contacts immediately rather than waiting for a reviewer who may not read the report for days.
  var crisisPattern = /\b(kill(ing)? myself|suicid(e|al)|end(ing)? my (own )?life|hurt(ing)? myself|harm(ing)? myself|self[- ]harm|don'?t want to (live|be alive|be here anymore)|want to die)\b/i;
  function detectCrisis(str) { return crisisPattern.test(String(str || "")); }

  return {
    start: "welcome",
    totalSteps: 17,
    maxLength: 4000,
    nodes: nodes,
    context: context,
    helpNeeds: HELP_NEEDS,
    wantsHelp: wantsHelp,
    summary: summary,
    toReport: toReport,
    labelFor: labelFor,
    describeReport: describeReport,
    detectCrisis: detectCrisis,
    statuses: {
      received: { label: "Received", detail: "The system stored the report." },
      under_review: { label: "Under review", detail: "An authorized reviewer has opened it." },
      response_available: { label: "Response available", detail: "A reviewer has added a message or resource." },
      closed: { label: "Closed", detail: "Student-led review is complete. This does not mean the University resolved the underlying concern." }
    }
  };
});
