import type { Request, Response } from "express";
import { changePasswordService, getMeService, loginService, updatePreferencesService } from "../services/auth.service.js";
import { SIGNUP_COURSES, SIGNUP_PROGRAMS, type UserPreferences } from "@edurev/types";
import { getSignupConfigService, signupService } from "../services/signup.service.js";
import { forgotPasswordService, resendSignupCodeService, resetPasswordService, verifySignupService } from "../services/email-codes.service.js";
import { clear, consume, isLimited, record } from "../utils/rate-limit.js";

const errorResponse = (res: Response, message: string, status = 400) =>
  res.status(status).json({ message });

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailureLimit = () => Number(process.env.LOGIN_FAILURE_LIMIT ?? 10);

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    errorResponse(res, "Email and password are required.");
    return;
  }

  // Slow down password guessing: too many failures for this email from this address → short lock-out
  const limitKey = `login:${email.trim().toLowerCase()}:${req.ip}`;
  if (isLimited(limitKey, loginFailureLimit(), LOGIN_WINDOW_MS)) {
    errorResponse(res, "Too many failed sign-in attempts. Please wait 15 minutes and try again.", 429);
    return;
  }

  try {
    const result = await loginService(email, password);
    clear(limitKey);
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    if (status === 401) record(limitKey);
    res.status(status).json({ message: err.message || "Login failed.", ...(err.code ? { code: err.code } : {}) });
  }
}

const signupRateLimit = () => Number(process.env.SIGNUP_RATE_LIMIT ?? 5);

/**
 * Public student self sign-up. Validates input, applies a per-address rate limit and a hidden "website"
 * field that only bots fill in. Always answers 202 for accepted or silently ignored requests.
 */
export async function signupHandler(req: Request, res: Response): Promise<void> {
  const body = req.body ?? {};
  const received = () =>
    res.status(202).json({ status: "RECEIVED", message: "Thanks! If these details can be registered, your request is now waiting for approval." });

  if (typeof body.website === "string" && body.website.trim() !== "") {
    received(); // honeypot: pretend it worked
    return;
  }
  if (!consume(`signup:${req.ip}`, signupRateLimit(), 60 * 60 * 1000)) {
    errorResponse(res, "Too many sign-up attempts from this device. Please try again later.", 429);
    return;
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const registrationNumber = typeof body.registrationNumber === "string" ? body.registrationNumber.trim() : "";

  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) return void errorResponse(res, "Please enter your full name (2–60 letters).");
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void errorResponse(res, "Please enter a valid email address.");
  if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return void errorResponse(res, "Password must be 8 to 128 characters and include a letter and a number.");
  }
  if (password.toLowerCase() === email) return void errorResponse(res, "Password can't be the same as your email.");
  if (!/^[A-Za-z0-9]{4,20}$/.test(registrationNumber)) return void errorResponse(res, "Registration number must be 4 to 20 letters or digits.");
  if (!(SIGNUP_PROGRAMS as readonly string[]).includes(body.program)) return void errorResponse(res, "Please choose your program from the list.");
  if (!(SIGNUP_COURSES as readonly string[]).includes(body.course)) return void errorResponse(res, "Please choose your course from the list.");
  if (!Number.isInteger(body.year) || body.year < 1 || body.year > 5) return void errorResponse(res, "Year must be between 1 and 5.");
  if (body.acceptSafeguards !== true) return void errorResponse(res, "Please accept the academic safeguards to continue.");

  try {
    await signupService({ name, email, password, registrationNumber, program: body.program, course: body.course, year: body.year, acceptSafeguards: true });
    received();
  } catch (err: any) {
    errorResponse(res, err.message || "Sign-up failed.", err.statusCode || 400);
  }
}

export async function signupConfigHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await getSignupConfigService() });
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to load sign-up settings.", 500);
  }
}

export async function getMeHandler(req: Request, res: Response): Promise<void> {
  if (!req.user || !req.user.id) {
    errorResponse(res, "Authentication token is missing or invalid.", 401);
    return;
  }

  try {
    const user = await getMeService(req.user.id);
    res.json({ user });
  } catch (err: any) {
    const status = err.statusCode || 404;
    errorResponse(res, err.message || "Failed to retrieve user info.", status);
  }
}

/** Signed-in user changes their own password. Requires the current password. */
export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword) {
    errorResponse(res, "Current and new password are required.");
    return;
  }
  if (newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    errorResponse(res, "New password must be 8 to 128 characters and include a letter and a number.");
    return;
  }
  if (newPassword === currentPassword) {
    errorResponse(res, "New password must be different from the current one.");
    return;
  }

  try {
    // S5: every other session ends; `token` keeps this one signed in
    const { token } = await changePasswordService(req.user!.id, currentPassword, newPassword);
    res.json({ message: "Password changed.", token });
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to change password.", err.statusCode || 400);
  }
}

const PREFERENCE_KEYS: (keyof UserPreferences)[] = ["celebrations", "reduceMotion", "showBadges", "navCollapsed"];

/** Signed-in user updates their own preferences. Only known boolean keys are accepted. */
export async function updatePreferencesHandler(req: Request, res: Response): Promise<void> {
  const body = req.body ?? {};
  const update: Partial<UserPreferences> = {};
  for (const key of PREFERENCE_KEYS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") {
      errorResponse(res, `${key} must be true or false.`);
      return;
    }
    update[key] = body[key];
  }
  if (Object.keys(update).length === 0) {
    errorResponse(res, `Nothing to update. Preferences: ${PREFERENCE_KEYS.join(", ")}.`);
    return;
  }

  try {
    const data = await updatePreferencesService(req.user!.id, update);
    res.json({ data, message: "Preferences saved." });
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to save preferences.", err.statusCode || 400);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Email codes (docs/modules/email-codes.md): sign-up verification and forgot password. All public.
 * Replies that could reveal whether an account exists are always the same (202).
 * ---------------------------------------------------------------------------------------------- */

const HOUR_MS = 60 * 60 * 1000;
// OTP-07: per device (IP address); env overrides for tests and busy campuses
const codeSendLimit = () => Number(process.env.OTP_SEND_RATE_LIMIT ?? 20);
const codeCheckLimit = () => Number(process.env.OTP_CHECK_RATE_LIMIT ?? 30);

const validEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const passwordProblem = (value: unknown) =>
  typeof value !== "string" || value.length < 8 || value.length > 128 || !/[A-Za-z]/.test(value) || !/\d/.test(value)
    ? "New password must be 8 to 128 characters and include a letter and a number."
    : null;

function tooManyFrom(req: Request, kind: "send" | "check"): boolean {
  return kind === "send"
    ? !consume(`otp-send:${req.ip}`, codeSendLimit(), HOUR_MS)
    : !consume(`otp-check:${req.ip}`, codeCheckLimit(), 15 * 60 * 1000);
}

/** POST /auth/signup/verify { email, password, code } */
export async function verifySignupHandler(req: Request, res: Response): Promise<void> {
  const { email, password, code } = req.body ?? {};
  if (!validEmail(email) || typeof password !== "string" || !password || typeof code !== "string") {
    return void errorResponse(res, "Enter your email, your password and the 6-digit code.");
  }
  if (tooManyFrom(req, "check")) return void errorResponse(res, "Too many tries from this device. Please wait 15 minutes.", 429);
  try {
    await verifySignupService(email, password, code);
    res.json({ data: { status: "VERIFIED" }, message: "Email verified. Your request is now with your cell coordinator." });
  } catch (err: any) {
    errorResponse(res, err.message || "Couldn't verify the code.", err.statusCode || 400);
  }
}

/** POST /auth/signup/resend { email } */
export async function resendSignupCodeHandler(req: Request, res: Response): Promise<void> {
  const { email } = req.body ?? {};
  if (!validEmail(email)) return void errorResponse(res, "Please enter a valid email address.");
  if (tooManyFrom(req, "send")) return void errorResponse(res, "Too many code requests from this device. Please try again later.", 429);
  try {
    await resendSignupCodeService(email);
    res.status(202).json({ status: "RECEIVED", message: "If a sign-up is waiting for this email, we've sent a new code. Check your Junk folder too." });
  } catch (err: any) {
    errorResponse(res, err.message || "Couldn't send a new code.", err.statusCode || 400);
  }
}

/** POST /auth/password/forgot { email } */
export async function forgotPasswordHandler(req: Request, res: Response): Promise<void> {
  const { email } = req.body ?? {};
  if (!validEmail(email)) return void errorResponse(res, "Please enter a valid email address.");
  if (tooManyFrom(req, "send")) return void errorResponse(res, "Too many code requests from this device. Please try again later.", 429);
  try {
    await forgotPasswordService(email);
    res.status(202).json({ status: "RECEIVED", message: "If an account exists for this email, we've sent a code. Check your Junk folder too." });
  } catch (err: any) {
    errorResponse(res, err.message || "Couldn't send a code.", err.statusCode || 400);
  }
}

/** POST /auth/password/reset { email, code, newPassword } */
export async function resetPasswordHandler(req: Request, res: Response): Promise<void> {
  const { email, code, newPassword } = req.body ?? {};
  if (!validEmail(email) || typeof code !== "string") return void errorResponse(res, "Enter your email and the 6-digit code.");
  const problem = passwordProblem(newPassword);
  if (problem) return void errorResponse(res, problem);
  if (tooManyFrom(req, "check")) return void errorResponse(res, "Too many tries from this device. Please wait 15 minutes.", 429);
  try {
    await resetPasswordService(email, code, newPassword);
    clear(`login:${email.trim().toLowerCase()}:${req.ip}`); // RESET-04: the sign-in lock-out ends too
    res.json({ data: { status: "CHANGED" }, message: "Password changed. Sign in with your new password." });
  } catch (err: any) {
    errorResponse(res, err.message || "Couldn't reset the password.", err.statusCode || 400);
  }
}
