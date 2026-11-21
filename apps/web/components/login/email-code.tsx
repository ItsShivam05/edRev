"use client";

import { useEffect, useState } from "react";
import { IconCheckCircle, IconMail } from "@/components/ui/icons";
import { API_BASE } from "@/lib/api";

// Email codes (docs/modules/email-codes.md): the shared "Enter the 6-digit code" pieces. These are public
// pages before sign-in, so they call the API without a token (like the sign-up form).

export const fieldCls =
  "mt-1.5 w-full rounded-xl border border-[#E6E6E6] bg-[#F7F7F6] px-4 py-2.5 text-sm text-[#30343B] placeholder-[#8C93A0] outline-none transition focus:border-[#3978B8] focus:bg-white focus:ring-2 focus:ring-[#C2DCF2]";
export const labelCls = "block text-xs font-bold uppercase tracking-wider text-[#666D7A]";
export const primaryBtn =
  "w-full rounded-xl bg-[#F2A65A] py-3 text-sm font-bold text-[#30343B] shadow-sm ring-1 ring-[#FBD7B3] transition hover:bg-[#E59443] hover:shadow-[0_8px_20px_-6px_rgba(242,166,90,0.7)] active:scale-[0.99] disabled:opacity-50";

/** POST to a public auth endpoint; throws with the API's message on failure. */
export async function postPublic(path: string, body: unknown): Promise<{ message?: string; data?: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || "Something went wrong. Please try again.");
  return json ?? {};
}

/** Counts down from 60 s after a code is sent (OTP-05: a new code can be sent after 60 seconds). */
export function useResendTimer(startOnMount = true) {
  const [left, setLeft] = useState(startOnMount ? 60 : 0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return { left, restart: () => setLeft(60) };
}

/** One input for the 6 digits: numbers only, OTP autofill on phones, spaced mono digits. */
export function CodeInput({ value, onChange, id = "email-code" }: { value: string; onChange: (code: string) => void; id?: string }) {
  return (
    <input
      aria-label="6-digit code"
      autoComplete="one-time-code"
      className={`${fieldCls} text-center font-mono text-2xl font-bold tracking-[0.5em]`}
      id={id}
      inputMode="numeric"
      maxLength={7}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
      placeholder="••••••"
      value={value}
    />
  );
}

/** "Sent to x. Check Junk" note (MAIL-03). */
export function SentNote({ email, ifAccountExists = false }: { email: string; ifAccountExists?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#C2DCF2] bg-[#EFF6FC] p-3 text-xs leading-relaxed text-[#204D7D]">
      <IconMail className="mt-0.5 shrink-0" size={16} />
      <p>
        {/* RESET-01: the forgot-password screen never confirms that an account exists */}
        {ifAccountExists ? "If an account exists for " : "We sent a 6-digit code to "}
        <strong className="text-[#30343B]">{email}</strong>
        {ifAccountExists ? ", we've sent it a 6-digit code" : ""}. It can take a minute and expires after 10 minutes. Not in your
        inbox? Check your <strong>Junk</strong> folder, and mark the email &quot;Not junk&quot;.
      </p>
    </div>
  );
}

/**
 * Sign-up step 2: type the code sent to the college mailbox. The password the student chose is sent with it
 * (VERIFY-03), so only the person who filled in the form and owns the mailbox can verify.
 */
export function VerifyEmailStep({ email, password, onVerified, onBack, justSent = true }: { email: string; password: string; onVerified: () => void; onBack: () => void; justSent?: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useResendTimer(justSent);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await postPublic("/auth/signup/verify", { email, password, code });
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify the code.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const res = await postPublic("/auth/signup/resend", { email });
      setNotice(res.message ?? "If a sign-up is waiting for this email, we've sent a new code.");
      setCode("");
      timer.restart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a new code.");
    }
  };

  return (
    <form className="rise-in space-y-4" onSubmit={submit}>
      <div className="text-center">
        <h3 className="text-lg font-extrabold text-[#30343B]">Verify your college email</h3>
        <p className="mt-1 text-xs text-[#666D7A]">One last step before your request goes to your cell coordinator.</p>
      </div>
      <SentNote email={email} />
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-sm font-semibold text-rose-700">{error}</div>}
      {notice && !error && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-semibold text-emerald-700">{notice}</div>}
      <div>
        <label className={labelCls} htmlFor="email-code">
          6-digit code
        </label>
        <CodeInput onChange={setCode} value={code} />
      </div>
      <button className={primaryBtn} disabled={busy || code.length !== 6} type="submit">
        {busy ? "Checking…" : "Verify email"}
      </button>
      <div className="flex items-center justify-between text-xs font-bold">
        <button className="text-[#666D7A] hover:text-[#30343B]" onClick={onBack} type="button">
          ← Back
        </button>
        <button className="text-[#3978B8] hover:underline disabled:text-[#8C93A0] disabled:no-underline" disabled={timer.left > 0} onClick={resend} type="button">
          {timer.left > 0 ? `Send a new code in ${timer.left}s` : "Send a new code"}
        </button>
      </div>
    </form>
  );
}

/** Shown after the code is accepted. */
export function VerifiedDone({ email, onBackToSignIn }: { email: string; onBackToSignIn: () => void }) {
  return (
    <div className="rise-in text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
        <IconCheckCircle size={26} />
      </span>
      <h3 className="mt-4 text-xl font-extrabold text-[#30343B]">Email verified</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#666D7A]">
        Your request is now with your cell coordinator. Once approved, sign in with <strong className="text-[#30343B]">{email}</strong> and we&apos;ll help
        you set up your profile.
      </p>
      <button className={`mt-6 ${primaryBtn}`} onClick={onBackToSignIn} type="button">
        Back to sign in
      </button>
    </div>
  );
}
