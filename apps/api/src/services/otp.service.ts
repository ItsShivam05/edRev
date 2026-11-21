import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { OneTimeCodePurpose } from "@edurev/types";
import { DEV_JWT_SECRET } from "../config/runtime.js";
import { OneTimeCodeModel, type OneTimeCodeDocument } from "../models/index.js";
import { consume } from "../utils/rate-limit.js";

// Email codes (docs/modules/email-codes.md §3): 6-digit one-time codes. Change the numbers only here.
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_TRIES = 5;
export const CODE_RESEND_AFTER_MS = 60 * 1000;
export const CODES_PER_EMAIL_PER_HOUR = 5;

const secret = () => process.env.JWT_SECRET || DEV_JWT_SECRET;
const hashCode = (purpose: OneTimeCodePurpose, email: string, code: string) => createHmac("sha256", secret()).update(`${purpose}:${email}:${code}`).digest("hex");

/** OTP-08: people type "482 913" or paste with spaces. */
export const normaliseCode = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, "") : "");

/**
 * Creates (or replaces, OTP-09) the live code for an email and purpose and returns it for the email.
 * Returns null without sending when a code went out less than 60 s ago (OTP-05) or 5 codes already went
 * to this email in the last hour (OTP-06).
 */
export async function issueCode(email: string, purpose: OneTimeCodePurpose, userId: string, now = new Date()): Promise<string | null> {
  const existing = await OneTimeCodeModel.findOne({ email, purpose }).lean<OneTimeCodeDocument>();
  if (existing && now.getTime() - new Date(existing.lastSentAt).getTime() < CODE_RESEND_AFTER_MS) return null;
  if (!consume(`otp-email:${purpose}:${email}`, CODES_PER_EMAIL_PER_HOUR, 60 * 60 * 1000)) return null;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  try {
    await OneTimeCodeModel.updateOne(
      { email, purpose },
      { $set: { userId, codeHash: hashCode(purpose, email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), attempts: 0, lastSentAt: now } },
      { upsert: true }
    );
  } catch (error: any) {
    if (error?.code === 11000) return null; // two requests at the same moment: the other one sent the code
    throw error;
  }
  return code;
}

export type CodeCheck = { ok: true; userId: string } | { ok: false; reason: "INVALID" | "WRONG" | "LOCKED"; triesLeft?: number };

async function liveCode(email: string, purpose: OneTimeCodePurpose, now: Date) {
  const doc = await OneTimeCodeModel.findOne({ email, purpose }).lean<OneTimeCodeDocument & { _id: unknown }>();
  // OTP-03: the TTL index can take up to a minute to remove an expired code, so expiry is also checked here
  return doc && new Date(doc.expiresAt).getTime() > now.getTime() ? doc : null;
}

/** Counts one wrong try against the live code (OTP-01 / OTP-02). Conditional on the count read, so tries are never lost. */
export async function failAttempt(email: string, purpose: OneTimeCodePurpose, now = new Date()): Promise<CodeCheck & { ok: false }> {
  const doc = await liveCode(email, purpose, now);
  if (!doc) return { ok: false, reason: "INVALID" };
  if (doc.attempts >= CODE_MAX_TRIES) return { ok: false, reason: "LOCKED" };
  const updated = await OneTimeCodeModel.findOneAndUpdate({ _id: doc._id, attempts: doc.attempts }, { $inc: { attempts: 1 } }, { new: true }).lean<OneTimeCodeDocument>();
  const attempts = updated?.attempts ?? doc.attempts + 1;
  return attempts >= CODE_MAX_TRIES ? { ok: false, reason: "LOCKED" } : { ok: false, reason: "WRONG", triesLeft: CODE_MAX_TRIES - attempts };
}

/** Checks a typed code. The right code is deleted in the same step, so it works exactly once (OTP-04). */
export async function checkCode(email: string, purpose: OneTimeCodePurpose, typed: unknown, now = new Date()): Promise<CodeCheck> {
  const doc = await liveCode(email, purpose, now);
  if (!doc) return { ok: false, reason: "INVALID" };
  if (doc.attempts >= CODE_MAX_TRIES) return { ok: false, reason: "LOCKED" };

  const code = normaliseCode(typed);
  const expected = Buffer.from(doc.codeHash, "hex");
  const actual = Buffer.from(hashCode(purpose, email, code), "hex");
  if (!/^\d{6}$/.test(code) || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return failAttempt(email, purpose, now);

  const removed = await OneTimeCodeModel.deleteOne({ _id: doc._id, codeHash: doc.codeHash });
  if (removed.deletedCount === 0) return { ok: false, reason: "INVALID" }; // used a moment ago by another request
  return { ok: true, userId: doc.userId };
}

/** Removes every code for these emails (account deleted, tests). */
export async function deleteCodesFor(emails: string[]): Promise<void> {
  await OneTimeCodeModel.deleteMany({ email: { $in: emails.map((e) => e.toLowerCase()) } });
}
