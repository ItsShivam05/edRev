import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import type { User } from "@edurev/types";
import { isDbConnected } from "../config/db.js";
import { mailConfigProblems, mailTransportName } from "../config/runtime.js";
import { OneTimeCodeModel, UserModel } from "../models/index.js";
import { deleteUnverifiedSignupsService } from "../services/email-codes.service.js";
import { clearMailOutbox, mailOutbox } from "../services/mail.service.js";
import { deleteCodesFor } from "../services/otp.service.js";
import { deleteSignupAccount } from "../services/signup.service.js";
import { resetRateLimits } from "../utils/rate-limit.js";
import { makeClient, startTestServer, stopTestServer } from "./helpers.js";

// Email codes: sign-up verification and forgot password (docs/modules/email-codes.md)
process.env.MAIL_TRANSPORT = "memory";
process.env.SIGNUP_RATE_LIMIT = "1000";
process.env.LOGIN_FAILURE_LIMIT = "1000";
process.env.OTP_SEND_RATE_LIMIT = "1000";
process.env.OTP_CHECK_RATE_LIMIT = "1000";

const PASSWORD = "Campus2026";
const person = (key: string, reg: string) => ({ name: `Otp ${key}`, email: `test.otp.${key.toLowerCase()}@lpu.in`, registrationNumber: reg });
const V = person("Vera", "TESTOTP001");
const W = person("Wes", "TESTOTP002");
const L = person("Lee", "TESTOTP003");
const Y = person("Yara", "TESTOTP004");
const Z = person("Zoe", "TESTOTP005");
const RESET = { id: "usr-test-otp-reset", name: "Otp Reset", email: "test.otp.reset@lpu.in" };
const STALE = person("Stale", "TESTOTP006");
const KEPT = person("Kept", "TESTOTP007");
const ALL = [V, W, L, Y, Z, STALE, KEPT].map((p) => p.email);

const form = (p: { name: string; email: string; registrationNumber: string }, extra: Record<string, unknown> = {}) => ({
  ...p,
  password: PASSWORD,
  program: "Computer Science and Engineering",
  course: "B.Tech",
  year: 2,
  acceptSafeguards: true,
  ...extra,
});

describe("Email codes Suite", () => {
  let server: Server;
  let baseUrl = "";
  const call = makeClient(() => baseUrl);

  const signup = (body: unknown) => call("POST", "/auth/signup", { body });
  const verify = (email: string, code: string, password = PASSWORD) => call("POST", "/auth/signup/verify", { body: { email, password, code } });
  const resend = (email: string) => call("POST", "/auth/signup/resend", { body: { email } });
  const forgot = (email: string) => call("POST", "/auth/password/forgot", { body: { email } });
  const reset = (email: string, code: string, newPassword: string) => call("POST", "/auth/password/reset", { body: { email, code, newPassword } });
  const login = (email: string, password = PASSWORD) => call("POST", "/auth/login", { body: { email, password } });
  const mailsTo = (email: string) => mailOutbox().filter((m) => m.to === email);
  const lastCode = (email: string) => mailsTo(email).at(-1)?.subject.match(/(\d{6})/)?.[1] ?? "";
  const otherCode = (code: string) => (code === "000000" ? "111111" : "000000");
  const requestFor = async (email: string) => (await call("GET", "/signup-requests", { as: "admin" })).json.data.find((r: { email: string }) => r.email === email);
  /** Moves the last email back in time, so the 60-second resend rule allows a new code. */
  const age = async (email: string, purpose: string) => OneTimeCodeModel.updateOne({ email, purpose }, { $set: { lastSentAt: new Date(Date.now() - 2 * 60 * 1000) } });

  const cleanup = async () => {
    if (!isDbConnected()) return;
    for (const email of ALL) await deleteSignupAccount(email);
    await UserModel.deleteOne({ id: RESET.id });
    await deleteCodesFor([...ALL, RESET.email]);
  };

  before(async () => {
    ({ server, baseUrl } = await startTestServer());
    resetRateLimits();
    clearMailOutbox();
    await cleanup();
  });

  after(async () => {
    await cleanup();
    resetRateLimits();
    await stopTestServer(server);
  });

  it("chooses where emails go and checks the production mail settings (MAIL-01 / MAIL-02)", () => {
    assert.strictEqual(mailTransportName({}), "console");
    assert.strictEqual(mailTransportName({ NODE_TEST_CONTEXT: "child-v8" }), "memory");
    assert.strictEqual(mailTransportName({ SMTP_USER: "a@gmail.com", SMTP_PASS: "app-password" }), "smtp");
    assert.strictEqual(mailTransportName({ NODE_ENV: "production" }), "smtp");
    assert.strictEqual(mailTransportName({ MAIL_TRANSPORT: "console", SMTP_USER: "a", SMTP_PASS: "b" }), "console");
    assert.deepStrictEqual(mailConfigProblems({ NODE_ENV: "development" }), []);
    assert.strictEqual(mailConfigProblems({ NODE_ENV: "production" }).length, 2, "user and password missing");
    assert.strictEqual(mailConfigProblems({ NODE_ENV: "production", MAIL_TRANSPORT: "console", SMTP_USER: "a", SMTP_PASS: "b" }).length, 1);
    assert.deepStrictEqual(mailConfigProblems({ NODE_ENV: "production", SMTP_USER: "a@gmail.com", SMTP_PASS: "app-password" }), []);
  });

  it("answers 503 in demo data mode (RESET-06)", async (t) => {
    if (isDbConnected()) return t.skip("database connected");
    assert.strictEqual((await verify(V.email, "123456")).status, 503);
    assert.strictEqual((await resend(V.email)).status, 503);
    assert.strictEqual((await forgot("student@revalanche.local")).status, 503);
    assert.strictEqual((await reset("student@revalanche.local", "123456", "NewPass2026")).status, 503);
  });

  describe("Sign-up verification", () => {
    it("emails a 6-digit code and hides the request until it is verified (VERIFY-01 / VERIFY-05)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      assert.strictEqual((await signup(form(V))).status, 202);
      const mails = mailsTo(V.email);
      assert.strictEqual(mails.length, 1);
      const code = lastCode(V.email);
      assert.match(code, /^\d{6}$/);
      assert.ok(mails[0].text.includes(code), "the code is in the text");
      assert.ok(!/<img|https?:\/\//i.test(mails[0].html ?? ""), "plain email: no images or links (MAIL-03)");

      const user = await UserModel.findOne({ email: V.email }).lean<User>();
      assert.strictEqual(user?.signup?.verificationRequired, true);
      assert.strictEqual(user?.signup?.emailVerifiedAt, undefined);
      const stored = await OneTimeCodeModel.findOne({ email: V.email }).lean<{ codeHash: string }>();
      assert.ok(stored && stored.codeHash !== code && !stored.codeHash.includes(code), "only a hash is stored");

      assert.strictEqual(await requestFor(V.email), undefined, "not listed for reviewers yet");
      assert.strictEqual((await call("POST", `/signup-requests/${user!.id}/approve`, { as: "admin" })).status, 409);
      const signIn = await login(V.email);
      assert.strictEqual(signIn.status, 403);
      assert.strictEqual(signIn.json.code, "EMAIL_NOT_VERIFIED");
    });

    it("refuses a wrong code or password, accepts the right one once (OTP-01 / OTP-04 / VERIFY-04)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      const code = lastCode(V.email);
      const wrong = await verify(V.email, otherCode(code));
      assert.strictEqual(wrong.status, 400);
      assert.match(wrong.json.message, /4 tries left/);
      const wrongPassword = await verify(V.email, code, "NotMine2026");
      assert.strictEqual(wrongPassword.status, 400);
      assert.match(wrongPassword.json.message, /3 tries left/);

      const ok = await verify(V.email, code);
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.json.data.status, "VERIFIED");
      const listed = await requestFor(V.email);
      assert.ok(listed?.emailVerifiedAt, "now listed, with the verification time");
      assert.match((await verify(V.email, code)).json.message, /expired or isn't valid/, "single use");
      assert.strictEqual((await login(V.email)).json.code, "ACCOUNT_PENDING");
    });

    it("locks a code after 5 wrong tries (OTP-02)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      assert.strictEqual((await signup(form(W))).status, 202);
      const code = lastCode(W.email);
      for (let i = 1; i <= 4; i++) assert.strictEqual((await verify(W.email, otherCode(code))).status, 400, `try ${i}`);
      assert.strictEqual((await verify(W.email, otherCode(code))).status, 429, "fifth wrong try");
      assert.strictEqual((await verify(W.email, code)).status, 429, "even the right code is refused now");
    });

    it("refuses an expired code (OTP-03)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      await age(W.email, "SIGNUP_VERIFY");
      assert.strictEqual((await resend(W.email)).status, 202);
      const fresh = lastCode(W.email);
      await OneTimeCodeModel.updateOne({ email: W.email, purpose: "SIGNUP_VERIFY" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await verify(W.email, fresh);
      assert.strictEqual(res.status, 400);
      assert.match(res.json.message, /expired/);
    });

    it("resends with the same answer, waits 60 s, and only the newest code works (OTP-05 / OTP-08 / OTP-09)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      assert.strictEqual((await signup(form(Y))).status, 202);
      const first = lastCode(Y.email);
      const again = await resend(Y.email);
      assert.strictEqual(again.status, 202);
      assert.strictEqual(mailsTo(Y.email).length, 1, "no second email within 60 s");

      const unknown = await resend("nobody.here@lpu.in");
      assert.strictEqual(unknown.status, 202);
      assert.strictEqual(unknown.json.message, again.json.message, "same answer for an unknown email");
      assert.strictEqual(mailsTo("nobody.here@lpu.in").length, 0);

      await age(Y.email, "SIGNUP_VERIFY");
      assert.strictEqual((await resend(Y.email)).status, 202);
      const second = lastCode(Y.email);
      assert.strictEqual(mailsTo(Y.email).length, 2);
      if (first !== second) assert.strictEqual((await verify(Y.email, first)).status, 400, "the old code no longer works");
      const spaced = `${second.slice(0, 3)} ${second.slice(3)}`;
      assert.strictEqual((await verify(Y.email, spaced)).status, 200, "spaces are ignored");
    });

    it("lets the latest form replace an unverified sign-up (VERIFY-03)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      assert.strictEqual((await signup(form(Z))).status, 202);
      const code = lastCode(Z.email);
      assert.strictEqual((await signup(form({ ...Z, name: "Zoe Real" }, { password: "Mine2026zz" }))).status, 202);
      assert.strictEqual((await UserModel.findOne({ email: Z.email }).lean<User>())?.name, "Zoe Real");
      assert.strictEqual((await verify(Z.email, code)).status, 400, "the earlier password no longer verifies");
      assert.strictEqual((await verify(Z.email, code, "Mine2026zz")).status, 200, "the latest password does");
    });

    it("keeps sign-ups from before email codes working as before (VERIFY-06)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      await UserModel.create({
        id: "usr-testotp003",
        name: L.name,
        email: L.email,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        role: "STUDENT",
        status: "PENDING_APPROVAL",
        signup: { registrationNumber: L.registrationNumber, program: "Data Analytics", course: "B.Tech", year: 3, requestedAt: new Date().toISOString(), attempts: 1 },
      });
      assert.strictEqual((await login(L.email)).json.code, "ACCOUNT_PENDING");
      const request = await requestFor(L.email);
      assert.ok(request, "listed without a code");
      assert.strictEqual((await call("POST", `/signup-requests/${request.userId}/approve`, { as: "admin" })).status, 200);
    });

    it("removes first-time sign-ups that never verified after 24 h (VERIFY-02)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const base = { passwordHash: "x", role: "STUDENT", status: "PENDING_APPROVAL" };
      const details = (p: typeof STALE) => ({ registrationNumber: p.registrationNumber, program: "Data Analytics", course: "B.Tech", year: 1, requestedAt: twoDaysAgo, attempts: 1, verificationRequired: true });
      await UserModel.create({ ...base, id: "usr-testotp006", name: STALE.name, email: STALE.email, signup: details(STALE) });
      await UserModel.create({ ...base, id: "usr-testotp007", name: KEPT.name, email: KEPT.email, signup: { ...details(KEPT), emailVerifiedAt: twoDaysAgo } });
      assert.ok((await deleteUnverifiedSignupsService()) >= 1);
      assert.strictEqual(await UserModel.countDocuments({ email: STALE.email }), 0, "never verified: removed");
      assert.strictEqual(await UserModel.countDocuments({ email: KEPT.email }), 1, "verified: kept");
      assert.strictEqual(await UserModel.countDocuments({ email: V.email }), 1, "recent sign-ups are untouched");
    });
  });

  describe("Forgot password", () => {
    before(async () => {
      if (!isDbConnected()) return;
      await UserModel.create({ ...RESET, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "PLACEMENT_OFFICE", status: "ACTIVE" });
    });

    it("gives every email the same answer and only emails active accounts (RESET-01)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      const unknown = await forgot("nobody.here@lpu.in");
      const pending = await forgot(W.email);
      const active = await forgot(RESET.email);
      for (const res of [unknown, pending, active]) assert.strictEqual(res.status, 202);
      assert.strictEqual(unknown.json.message, active.json.message);
      assert.strictEqual(pending.json.message, active.json.message);
      assert.strictEqual(mailsTo("nobody.here@lpu.in").length, 0);
      assert.strictEqual(mailsTo(W.email).filter((m) => /reset/i.test(m.subject)).length, 0, "pending sign-ups get no reset code");
      assert.match(mailsTo(RESET.email).at(-1)?.subject ?? "", /password reset code: \d{6}/);
    });

    it("refuses a wrong code or weak password, then changes it and ends every session (RESET-02..04)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      const signedIn = await login(RESET.email);
      assert.strictEqual(signedIn.status, 200);
      const oldToken = signedIn.json.token;
      const code = lastCode(RESET.email);

      assert.strictEqual((await reset(RESET.email, code, "short")).status, 400, "weak password");
      assert.strictEqual((await reset(RESET.email, otherCode(code), "NewPass2026")).status, 400, "wrong code");
      const done = await reset(RESET.email, code, "NewPass2026");
      assert.strictEqual(done.status, 200);
      assert.strictEqual(done.json.data.status, "CHANGED");

      const me = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } });
      assert.strictEqual(me.status, 401, "the old session ended");
      assert.strictEqual((await login(RESET.email)).status, 401, "old password no longer works");
      assert.strictEqual((await login(RESET.email, "NewPass2026")).status, 200);
      assert.match(mailsTo(RESET.email).at(-1)?.subject ?? "", /password was changed/);
      assert.strictEqual((await reset(RESET.email, code, "Another2026")).status, 400, "the code works once");
    });

    it("limits code requests from one device (OTP-07)", async (t) => {
      if (!isDbConnected()) return t.skip("demo data mode");
      process.env.OTP_SEND_RATE_LIMIT = "2";
      resetRateLimits();
      try {
        assert.strictEqual((await forgot("nobody.one@lpu.in")).status, 202);
        assert.strictEqual((await forgot("nobody.two@lpu.in")).status, 202);
        assert.strictEqual((await forgot("nobody.three@lpu.in")).status, 429);
      } finally {
        process.env.OTP_SEND_RATE_LIMIT = "1000";
        resetRateLimits();
      }
    });
  });
});
