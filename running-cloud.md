# Running notes: where we left off (22 Nov 2026)

**Next:** fix the project review findings below (R-01 first), then Phase 5 (polish) in `docs/improvement-plan.md`. Phase 4 is on `main` and GitHub. Email codes are merged into `main` and pushed (23 Nov 2026); real emails tested with the Gmail App password.

## Email codes: sign-up verification and forgot password, done 22 Nov 2026

Full doc: `docs/modules/email-codes.md` (local). Edge cases OTP-*, VERIFY-*, RESET-*, MAIL-* in `docs/edge-cases.md`.

- **Sign-up:** after the form, the student types a 6-digit code emailed to their `@lpu.in` mailbox (plus the password they just chose). Until then the request is hidden from the Cell Coordinator; signing in shows the code screen again; never-verified first-time sign-ups are deleted after 24 h. Coordinators see "✓ Email verified" on each request. Older pending requests work as before.
- **Forgot password:** "Forgot password?" on the sign-in tab → code by email → new password. Same reply for every email; every old session ends; a "password changed" email is sent.
- **Codes:** 10 minutes, 5 tries, single use, new code after 60 s. Codes rather than links because Outlook scans links.
- **Sending is free:** Gmail + App password. Until `SMTP_USER` / `SMTP_PASS` are in `apps/api/.env`, codes are printed in the API terminal. Production refuses to start without them.
- Also fixed: the login page and sign-up checkbox said "20h weekly cap"; now 10 h in term (20 h in breaks).
- 213 API tests (211 pass + 2 skipped on MongoDB; 190 pass + 23 skipped in demo mode), typecheck and web build OK. Screenshots: sign-up code step, wrong code, verified, coordinator list with "Email verified", forgot password (both steps), password changed, phone.
- ✅ Gmail App password set up in `apps/api/.env` (git-ignored) and real codes arrive in Outlook (23 Nov 2026).

## Project review: findings to fix later (10 Nov 2026)

Whole-project read-through after Phase 4. Nothing changed yet. Full details, edge cases and fix ideas are in [`docs/review-findings.md`](docs/review-findings.md) (local; `docs/` is git-ignored, so this checklist is the committed copy). Suggested order: R-01 → R-02 → R-04 → R-05 → R-06. Every fix updates the module doc and `edge-cases.md` first.

**Bugs**
- [ ] R-01 New opportunities always saved as 20 h (`estimatedHours` never passed by the create form or controller), so the weekly-hours safeguard is wrong.
- [ ] R-02 Web lists merge fake demo data into real data (Opportunities, Students when empty, Proposals, opportunity detail start); a student can bid on a fake project and get 404.
- [ ] R-03 Students can mark their own training COMPLETED and add their own skills; both feed tier suggestions unchecked (mentor confirmation needed).
- [ ] R-04 Earnings: student-sent `exchangeRate` accepted, currency free text, `earningDate` not validated, no text length limits.
- [ ] R-05 A rejected earning can't be resubmitted (the duplicate check and unique index include REJECTED).
- [ ] R-06 Sign-up approve/reject read the record then save it: concurrent approve + reject, or a failure halfway, leave a broken or stuck request.

**Logic gaps**
- [ ] R-07 No edit / close / cancel for an opportunity before allocation.
- [ ] R-08 Opportunity create accepts any tier text, past deadline, negative budget, `bidsCloseAt` after the deadline, a client-sent id, a fake match score.
- [ ] R-09 The allocated (or reassigned-to) student is never messaged.
- [ ] R-10 No message for earning verified/rejected, tier changed, tier suggestion decided.
- [ ] R-11 Tier change has no reason, history or conditional update; pending suggestions aren't resolved.
- [ ] R-12 A pending in-time extension or hand-back still goes overdue, gets reminders and counts toward the cool-down.
- [ ] R-13 Overdue alerts and waiting decisions reach only the student, not mentor or coordinator.
- [ ] R-14 After a reassign, the new student sees the previous student's timeline and reason.
- [ ] R-15 `allocatedStudentId` visible to every student in the opportunity list.
- [ ] R-16 The old HourLog says 20 h while the cap is 10 h; `requiredCgpa` is per student instead of a Settings value.
- [ ] R-17 (partly done 22 Nov: unverified sign-ups now expire after 24 h) Pending sign-ups never expire; "received" shown after the last attempt; a user id tied to the first registration number can cause a false "taken".
- [ ] R-18 A verified earning can't be reopened; the student's total is saved by read-then-save.

**Security (before deploy)**
- [ ] R-31 The API creates the 9 demo accounts (Administrator too, `Password123!`) on an empty production database. The login page role buttons and pre-filled login were removed 23 Nov 2026; accounts are listed in `docs/demo-accounts.md` (local). Until fixed: change every demo password right after deploying.
- [ ] R-19 Login limit only per email + IP (add per-IP and per-email limits).
- [ ] R-20 `trust proxy` not set: behind a host proxy everyone shares one IP for the rate limits.
- [ ] R-21 Logout only clears the browser (token valid up to 1 day, kept in localStorage): add "Sign out everywhere".
- [ ] R-22 Login is faster for unknown emails (compare against a dummy hash).

**Performance**
- [ ] R-23 Lists return every record with screenshots, photos and proposal PDFs inside; no pagination.
- [ ] R-24 Rate limits and hourly checks assume one server (document it).

**Improvements:** R-25 no demo fallbacks in production web builds · R-26 admin activity log · R-27 mentor-confirmed training + skill endorsements · R-28 decision notifications + "bid closes soon" · R-29 already planned (email OTP, public holidays, mentors by account, Messages follow-ups) · R-30 hide analytics groups under 5 students.

## Phase 4 (safeguards, weekly hours, SLA): done 10 Nov 2026

The user asked to go with every recommended default, so **D1–D5 are agreed**: 10 h term / 20 h break cap (outside paid work counts via the check-in), 75% attendance, projects at once T1 1 · T2 1 · T3 2 · T4 3, 1 extension ≤ 30% before the deadline, 2 overdue in 60 days → 14-day cool-down. All are editable by an Administrator on Institutional settings.

Docs to study: [`docs/modules/safeguards.md`](docs/modules/safeguards.md) (rules, hours, Request help) and [`docs/modules/sla-and-delivery.md`](docs/modules/sla-and-delivery.md) (lifecycle, SLA states, reminders). Edge cases SAFE-*, HOURS-*, HELP-*, SLA-* in `docs/edge-cases.md`.

- `f62d095` API: safeguards engine (9 rules, hard/soft, overrides), limits, blackouts per programme, attendance/compliance, weekly hours (POST /hours now stores; timer; Monday check-in), SLA lifecycle (kick-off, milestones, submit/accept/revision, extensions, pause, cancel, hand-back, timeline), SLA board, reminders never sent twice, Request help with escalation, skill match, hourly daily checks (`DAILY_CHECKS=off` turns them off).
- `b1acfa5` Web: Safeguards page on live data, "Before you bid" card, project panel, My week + check-in, At-risk projects and Help requests cards, waiting times, staff safeguards panel on student records, limits editor. Fixes: opportunity page always refreshes from the API; dashboard grid no longer overflows on phones.
- 200 API tests pass in MongoDB and demo mode (1 / 12 skipped, as before). Typecheck and web build OK. Screenshots (demo data mode): student dashboard, safeguards, project, eligibility, phone; coordinator dashboard and project; faculty safeguards and student record; admin limits.
- Loose ends from the old list: `joinedAt` timezone was already fixed (E9); Rohan's stale tier suggestion is withdrawn by the daily checks; README was done 1 Nov.

**Heads-up for your real data:** the hour cap is now **10 h in term** (before, the old hour log showed 20 h). Students whose planned projects exceed 10 h/week will be blocked for *new* work until a project finishes or a coordinator overrides "Weekly hours". Add break periods on Institutional settings to use the 20 h cap. Existing allocations are never cancelled. Checked on your MongoDB data (10 Nov, read-only): **Rohan (stu-202, TIER 4)** has 38 h/week planned and a cool-down from late deliveries, so he's blocked for new work; Amara (stu-203) is blocked by CGPA as before; your own account (stu-12411347) by "CGPA not recorded"; Maya (stu-201) is clear.

**Still yours to decide:** your own account `shivam.thakur2024@lpu.in` is TIER 4 with 0% training and no official CGPA (likely set while testing). Only an Administrator can change it.

## Phase 4 design discussion (8 Nov 2026), kept for reference (now built)

### Agreed
- **D10: weekly hours** (also in `docs/improvement-plan.md` section 0). "A student only gets work that fits inside their weekly hours."
  1. **Planned hours gate allocation:** `estimatedHours` ÷ project weeks = hours/week. Allocate only if hours already planned + the new project's hours/week ≤ the weekly cap. Example: Riya has Logo 4 h/wk + Website 10 h/wk = 14 h; a 12 h/wk project → 26 h > 20 → blocked ("can take it after Logo finishes"); a 5 h/wk project → 19 h → OK.
  2. **Monday check-in:** a 1-minute form pre-filled with planned hours; the student corrects the actual hours (+ optional "other paid work" line). Over the cap → mentor warned, never an automatic block mid-project. Missed check-in → counts as planned hours + a reminder.
  3. **Optional Start/Stop timer per project** fills in the check-in. **No login timer** (it measures time in the app, not work: tabs left open, work done in Figma/VS Code).
  4. Week = Monday 00:00 to Sunday 23:59 IST (`utils/time.ts`).

### Open questions (asked, not answered yet)
1. **D1:** is the cap 20 h always, or 10 h in term / 20 h in holidays? (suggested 10/20)
2. Does **outside freelance work** (Upwork etc.) count toward the cap? (suggested yes, via the check-in's "other paid work" line)
3. **D3:** parallel projects per tier (suggested T1 = 1, T2 = 1, T3 = 2, T4 = 3)
4. **D2** attendance 75%, **D4** extensions (1 per project, ≤ 30%, before the deadline), **D5** cool-down (2 overdue in 60 days → 14 days, Coordinator can override): recommended, not confirmed.

### Proposed, still to discuss with examples (one topic at a time, simple words)
- **Blocked student → how to fix it:** each block reason shows what's wrong, how to unlock it, who can help, plus a **"Request help"** button. It opens a private Messages thread with the reason attached (the only way a student can *start* a thread). Routed to the assigned person, else a shared role queue (CGPA/compliance → Faculty Director; hours/cool-down → mentor → Cell Coordinator). One open request per reason; reply within 1 working day; escalates after 2 working days (Coordinator → Admin). Outcomes are logged with a reason.
  - **Hard (no override):** exam blackout, tier too low, parallel-project limit, CGPA below required.
  - **Soft (override with reason + expiry, logged):** CGPA not recorded, hours full, compliance, cool-down.
  - Show eligibility **before** bidding.
- **SLA lifecycle:** Allocated → kick-off within 24 h → milestones → submitted → accepted / revision (2 rounds) → completed on time or late. Side states: paused, extension, cancelled, handed back. Status is worked out on read: on track / at risk (time used ahead of milestones, < 48 h left with nothing submitted, or 3 days idle) / overdue / paused. Reminders at 48 h, 24 h, at risk and overdue, never sent twice. The agreed deadline can't go past the client's date: a Coordinator decides (reassign or renegotiate).
- **Tier vs safeguard are separate:** tier = what work you can bid on (Admin only); safeguard = whether you can take work now (automatic). If a record drops below the tier (e.g. CGPA), **no auto-demotion**: current work continues, the Admin gets a "tier review" item, and new allocations are blocked by the safeguard.
- **Edge cases listed:** CGPA drops mid-project (finish current work, block new), exam blackout inside a project's dates (warn; deadline before it or a planned pause), illness / hand-back (reassign, not counted as late), client cancels (no penalty), override expires mid-project (affects only new work), deactivation with active work (reassign first), appeal once to Admin/Dean, unassigned mentor → shared queue.

### Noticed, user to decide
- The user's own account `shivam.thakur2024@lpu.in` (reg no. 12411347, which they entered at sign-up on 28 Oct) is **TIER 4** with 0% training and a RESTRICTED CGPA. That was likely set by an Admin while testing; only an Administrator can reset it.

## Since Phase 3 (8 Nov)
- `6c8555b` CORS fix (S14): the app works from http://127.0.0.1:3000 and other loopback ports in dev (Firefox "NetworkError" on login).
- `0fa5116` Lighter rail (white with orange accents) + "Reg. No." moved to the profile dropdown.
- MongoDB crashed on 7 Nov because drive C: was full (Claude's leftover headless-browser profiles). Fixed: space freed, data verified intact, and the scripts now delete their profiles. Branch `phase-3-new-look` is not merged into `main` yet.

## Phase 3 (new look): done 7 Nov

See [`docs/modules/ui-shell.md`](docs/modules/ui-shell.md). Covers:
- U1 fonts (Inter + JetBrains Mono via `next/font`) and U2 CSS-variable design tokens
- U3 orange collapsible icon rail (`preferences.navCollapsed`) and U4 top-bar identity block
- U5 notice line, U6 quick links, U7 `TabCard`
- U8 student and U9 staff dashboard cards (each card fails on its own)
- U10 contrast and focus fixes; U11 names trimmed on read and the fake "% match" hidden

163 API tests in both modes (3 new; 1 / 12 skipped as before), web build OK. Screenshots: student (desktop and phone), administrator, coordinator (rail collapsed), analyst opportunities list.
**Heads-up:** `next/font` downloads the fonts from Google at build/dev start, so it needs internet once. Without it, dev falls back to system fonts.

Pick up here next session. Project rules and conventions are in `CLAUDE.md`.

**Master to-do:** [`docs/improvement-plan.md`](docs/improvement-plan.md) (phases 0–6, decisions D1–D9). Edge cases: [`docs/edge-cases.md`](docs/edge-cases.md).

## State of the repo

- Last commits (30 Oct): Tailwind fix, Messages (Phase 3), security (Phase 1), docs.
- Phases 1 and 2 committed. Next: Phase 3 (new look).
- API tests: 160 total, all passing in both modes (`npm test` and `npm run test:mock --workspace @edurev/api`).

## Phase 2 (bids and allocation): done 30 Oct

See [`docs/modules/bids-and-allocation.md`](docs/modules/bids-and-allocation.md). 160 tests pass in both modes; web build OK; checked in Chrome as a student, an analyst and a coordinator.
Next: Phase 3 (new look) in `docs/improvement-plan.md`. Phase 4 needs decisions D1–D5 (hour caps, attendance, parallel projects, extensions, cool-down).

## Phase 1 (security): done and committed 30 Oct (3ba0e49)

See [`docs/modules/security.md`](docs/modules/security.md). 141 tests pass in both modes; web build OK; checked in Chrome for a student and an analyst.
**Restart `npm run dev`** (Next.js was patched from 15.5.25 to 15.5.28, and `next.config.ts` changed).

## To-do: tomorrow

### 1. ~~Fix: "Send" in My Messages does nothing~~ ✅ Fixed (30 Oct)

Fixed by the user. The cause was unrelated to the layout, so the planned layout and robustness changes aren't needed.

### 2. Commit

- [x] Committed: `c152a50` Tailwind fix, `e72bf51` Messages, `3ba0e49` security, `97ac0b4` docs.

### 3. Loose ends from earlier phases

- [ ] **Stale tier suggestion for Rohan (stu-202):** a pending TIER 2 → TIER 3 suggestion created under the *old* rules. Under the new rules he doesn't qualify (CGPA 7.80 < 9.0). Dismiss it on the Students page, or let the system withdraw it the next time his record changes.
- [ ] `joinedAt` for newly approved sign-ups uses the UTC date, so it can show the previous day in IST. Use the institution timezone instead.
- [x] ~~Update `README.md` for sign-up, tiers, delivery tracking and messages.~~ Rewritten 1 Nov 2026 with Mermaid diagrams.

### 4. Messages follow-ups (agreed for later)

- [ ] Link mentors (Guild Leads) to student records by account instead of by name, then optionally limit mentors to messaging their own mentees.
- [ ] Staff-to-staff direct messages.
- [ ] Instant updates (server push) instead of the 30-second poll.

### 5. Phase 4 extras (roadmap in CLAUDE.md)

- [ ] Skill-based match score (replace the fixed "94% match")
- [ ] Achievement badges (first bid, first verified earning, training complete, tier up)
- [ ] Saved / bookmarked opportunities
- [ ] Mentor skill endorsements
- [ ] Dark mode
- [ ] Deadline reminders ("bid closes in 2 days")

## How to resume

```bash
npm run dev                                  # web :3000, api :4000 (MongoDB on 127.0.0.1:27017)
npm run typecheck
npm test
npm run test:mock --workspace @edurev/api
NEXT_DIST_DIR=.next-build npm run build --workspace @edurev/web   # build while dev is running
```

**Heads-up:** a production build rewrites `apps/web/tsconfig.json` and `next-env.d.ts`, which makes a running `next dev` reload. Restore both afterwards (`git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json`), and avoid building while you're actively testing in the browser.
