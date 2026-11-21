import bcrypt from "bcryptjs";
import type { User } from "@edurev/types";
import { isDbConnected } from "../config/db.js";
import { OneTimeCodeModel, UserModel } from "../models/index.js";
import { passwordChangedEmail, resetCodeEmail, sendMail, signupCodeEmail } from "./mail.service.js";
import { checkCode, failAttempt, issueCode, type CodeCheck } from "./otp.service.js";

// Email codes (docs/modules/email-codes.md): sign-up verification and forgot password.

function httpError(message: string, statusCode: number) {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const normaliseEmail = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

/** RESET-06: there is nowhere to keep codes in demo data mode. */
function requireDatabase() {
  if (!isDbConnected()) throw httpError("Email codes aren't available in demo data mode (no database is connected).", 503);
}

/** The answer for a failed check. `withPassword` = the sign-up check, where the password is checked too (VERIFY-04). */
function codeError(result: CodeCheck & { ok: false }, withPassword = false) {
  if (result.reason === "LOCKED") return httpError("Too many wrong tries. Ask for a new code.", 429);
  if (result.reason === "WRONG") {
    const what = withPassword ? "That code or password isn't right." : "That code isn't right.";
    return httpError(`${what} You have ${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left.`, 400);
  }
  return httpError("This code has expired or isn't valid. Ask for a new code.", 400);
}

/** A sign-up that still has to type its email code (sign-ups from before this feature never need to). */
export function needsEmailVerification(user: Pick<User, "status" | "signup"> | null | undefined): boolean {
  return Boolean(user && user.status === "PENDING_APPROVAL" && user.signup?.verificationRequired && !user.signup?.emailVerifiedAt);
}

/** Emails a sign-up code unless one went out in the last 60 s (OTP-05 / OTP-06). Failures are logged only (VERIFY-08). */
export async function sendSignupCode(user: Pick<User, "id" | "name" | "email">): Promise<void> {
  const code = await issueCode(user.email, "SIGNUP_VERIFY", user.id);
  if (code) await sendMail(signupCodeEmail(user.email, user.name, code));
}

/**
 * POST /auth/signup/verify. The code proves the mailbox; the password proves this is the person who sent the
 * latest sign-up form (VERIFY-03). Wrong passwords count as wrong tries.
 */
export async function verifySignupService(emailInput: unknown, password: unknown, code: unknown): Promise<void> {
  requireDatabase();
  const email = normaliseEmail(emailInput);
  const user = email ? await UserModel.findOne({ email }).lean<User>() : null;
  if (!user || !needsEmailVerification(user) || !user.passwordHash) throw codeError({ ok: false, reason: "INVALID" });

  const passwordOk = typeof password === "string" && (await bcrypt.compare(password, user.passwordHash));
  if (!passwordOk) throw codeError(await failAttempt(email, "SIGNUP_VERIFY"), true);

  const result = await checkCode(email, "SIGNUP_VERIFY", code);
  if (!result.ok) throw codeError(result, true);

  await UserModel.updateOne(
    { id: user.id, status: "PENDING_APPROVAL", "signup.emailVerifiedAt": { $exists: false } },
    { $set: { "signup.emailVerifiedAt": new Date().toISOString() } }
  );
}

/** POST /auth/signup/resend. Always the same answer; a code goes out only to an unverified sign-up. */
export async function resendSignupCodeService(emailInput: unknown): Promise<void> {
  requireDatabase();
  const email = normaliseEmail(emailInput);
  if (!email) return;
  const user = await UserModel.findOne({ email }).lean<User>();
  if (needsEmailVerification(user)) await sendSignupCode(user!);
}

/** POST /auth/password/forgot. Always the same answer; only ACTIVE accounts get a code (RESET-01). */
export async function forgotPasswordService(emailInput: unknown): Promise<void> {
  requireDatabase();
  const email = normaliseEmail(emailInput);
  if (!email) return;
  const user = await UserModel.findOne({ email }).lean<User>();
  if (!user || (user.status ?? "ACTIVE") !== "ACTIVE" || !user.passwordHash) return;
  const code = await issueCode(email, "PASSWORD_RESET", user.id);
  if (code) await sendMail(resetCodeEmail(email, user.name, code));
}

/** POST /auth/password/reset. A right code sets the new password and ends every session (RESET-04). */
export async function resetPasswordService(emailInput: unknown, code: unknown, newPassword: string): Promise<void> {
  requireDatabase();
  const email = normaliseEmail(emailInput);
  const result = email ? await checkCode(email, "PASSWORD_RESET", code) : ({ ok: false, reason: "INVALID" } as const);
  if (!result.ok) throw codeError(result);

  const now = new Date();
  const updated = await UserModel.findOneAndUpdate(
    { id: result.userId, email, status: { $nin: ["PENDING_APPROVAL", "REJECTED"] } },
    { $set: { passwordHash: await bcrypt.hash(newPassword, 10) }, $inc: { tokenVersion: 1 } },
    { new: true }
  ).lean<User>();
  if (!updated) throw codeError({ ok: false, reason: "INVALID" });
  await sendMail(passwordChangedEmail(email, updated.name, now));
}

/** VERIFY-02: first-time sign-ups that never typed their code are removed after 24 h (frees the email and reg. no.). */
export async function deleteUnverifiedSignupsService(now = new Date()): Promise<number> {
  if (!isDbConnected()) return 0;
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const filter = {
    status: "PENDING_APPROVAL",
    "signup.verificationRequired": true,
    "signup.emailVerifiedAt": { $exists: false },
    "signup.attempts": { $lte: 1 }, // re-applications keep their history (the 3-attempt cap)
    "signup.requestedAt": { $lt: cutoff },
    studentId: { $exists: false },
  };
  const stale = await UserModel.find(filter, { email: 1 }).lean<{ email: string }[]>();
  if (stale.length === 0) return 0;
  const result = await UserModel.deleteMany({ ...filter, email: { $in: stale.map((u) => u.email) } });
  await OneTimeCodeModel.deleteMany({ email: { $in: stale.map((u) => u.email) }, purpose: "SIGNUP_VERIFY" });
  return result.deletedCount ?? 0;
}
