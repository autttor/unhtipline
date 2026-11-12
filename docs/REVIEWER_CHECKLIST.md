# Reviewer operations and privacy checklist

For every member of the Pride Report student team. Read it before you are invited, and again each semester.

## Your account

- [ ] You have your own account. You never share your password or your authenticator with anyone, including other reviewers.
- [ ] Your password is at least 12 characters, used nowhere else, and stored in a password manager.
- [ ] Your authenticator app is on a phone you control and that locks.
- [ ] You sign in only on a device you trust. Never on a shared or lab computer.
- [ ] You sign out when you finish. The dashboard also signs you out after 30 minutes without activity, and when the tab is closed.
- [ ] If your phone or laptop is lost, you tell an admin the same day so your access can be removed.

## What you are and are not

- You are a student volunteer. You listen, document, explain options, help someone prepare, and connect them with resources.
- You are not an investigator, a counselor, a lawyer, or a University official.
- You never decide whether something "really happened", never promise an outcome, and never tell a student what the University will do.
- Pride Report is not an emergency service. If a case suggests someone is in danger now, follow the escalation procedure below. Do not try to handle it alone.

## Working the queue

- [ ] Work within the published review hours. Do not create an expectation of round-the-clock replies.
- [ ] Triage order is shown by the queue: possible safety risk first, then deadlines, then advocacy requests, then whatever has waited longest. A request type alone is not an emergency.
- [ ] **Claim a case before you work on it.** One person per case. If you can't continue, tell an admin so it can be reassigned.
- [ ] Opening a case is logged with your name and the time. Open only the cases you are working on.
- [ ] **Advocacy cases** go to advocates and admins only.
- [ ] Keep the status current: New, In review, Awaiting follow-up, Closed.
- [ ] If the student mentioned a deadline, set a team due date on the case.

## Conflicts of interest

- [ ] If you know the people involved, are involved yourself, or could not be impartial, do not open the case. Tell an admin, who will restrict you from it.
- [ ] If a case is about another reviewer, an admin restricts that reviewer before anyone discusses it.
- [ ] Never look up a case out of curiosity about someone you know.

## Permissions: read these on every case

The case shows two permissions. They are separate, and both default to no.

**Contact the student.**
- [ ] Only if they asked to be contacted, and only at the email address they gave.
- [ ] If the case says "be discreet", your message must not mention Pride Report, LGBTQ+ topics, or the nature of their request in the subject or the opening lines. Someone else may see their inbox.
- [ ] Write from the team mailbox, never from a personal account. Then log the attempt on the case.
- [ ] If they did not ask to be contacted, do not try to find or reach them by any means.

**Contact anyone else on their behalf.**
- [ ] Asking for an advocate, or for help with an office, is **not** permission.
- [ ] "Not permitted" means you contact nobody: no office, no staff member, no other student.
- [ ] "Ask first" means you get a clear yes from the student for that specific contact, each time.
- [ ] "Without identifying me" means nothing that could identify them, which is more than leaving out their name.
- [ ] Share only what the student said may be shared, with only who they named.
- [ ] Record what you shared, and with whom, in a note on the case.

## Notes, exports and sharing

- [ ] Notes are factual: what was done, when, and what happens next. No opinions about credibility or character.
- [ ] Never copy a student's words into email, chat apps, documents or screenshots.
- [ ] Do not discuss cases outside the reviewer team, and inside the team only with those who need to know.
- [ ] If you print a case, the dashboard logs it. Printed copies are shredded when the meeting ends.
- [ ] Never publish a narrative, a name, or details that could identify a student or anyone they described.

## Escalation

The project owner fills this in with appropriate University staff before intake opens. Until it is filled in, intake stays closed.

| Situation | What to do | Who to tell |
| --- | --- | --- |
| Someone may be in immediate danger | TO BE CONFIRMED | TO BE CONFIRMED |
| A student describes thoughts of self-harm | TO BE CONFIRMED | TO BE CONFIRMED |
| Sexual misconduct or sex-based harassment is described | TO BE CONFIRMED (check each reviewer's own reporting duties) | TO BE CONFIRMED |
| You are unsure whether something must be passed on | Stop, and ask an admin before doing anything else | An admin |

## Leaving the team

- [ ] Tell an admin. Your access is removed, and your open cases are released for reassignment.
- [ ] You keep nothing: no notes, exports, screenshots or forwarded emails.
- [ ] Your duty not to discuss what you read continues after you leave.

## For admins

- [ ] Invite only people who have completed training. Give the lowest role that fits.
- [ ] Remove access the same day someone leaves or loses a device.
- [ ] Review the Activity log regularly for unexpected reads or exports.
- [ ] Check the Email delivery tab for failed notifications. A failed email never means a lost report, but it can mean a case nobody has noticed.
- [ ] Keep at least two admins, so that conflicts of interest can be handled and no one person is a single point of failure.
- [ ] Delete cases when the retention period ends if the automatic purge has not already done so.

## Privacy and security review before launch

For the project owner. Tick each before setting `INTAKE_ENABLED: true`.

- [ ] Every policy value in `assets/js/config.js` is filled in and matches what the team will actually do.
- [ ] The escalation table above is complete and has been agreed with appropriate University staff.
- [ ] Every core record in `assets/js/resources-data.js` is verified against its official page.
- [ ] Public sign-ups are off in Supabase, and the minimum password length is 12.
- [ ] `EMAIL_INCLUDE_DETAILS` is not set, or is `false`.
- [ ] The service-role key, Resend key, `CODE_PEPPER` and `DISPATCH_SECRET` exist only as Supabase secrets.
- [ ] The reviewer mailbox has two-step sign-in and is not anyone's personal account.
- [ ] The checks in SETUP.md Part D pass on the live site, using made-up content.
- [ ] Someone outside the project has reviewed the security of the deployment.
- [ ] The site has been tried with a keyboard only, with a screen reader, and on a phone.
- [ ] The terms and plan limits of GitHub, Supabase and Resend have been read with this kind of data in mind.
- [ ] The University has been told the project exists and is comfortable with the name.
