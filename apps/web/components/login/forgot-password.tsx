"use client";

import { useState } from "react";
import { CodeInput, SentNote, fieldCls, labelCls, postPublic, primaryBtn, useResendTimer } from "@/components/login/email-code";

// Email codes (docs/modules/email-codes.md §2.2): forgot password by code. Step 1 asks for the email (the answer
// never says whether an account exists); step 2 takes the code and the new password.

export function ForgotPasswordForm({ initialEmail, onDone, onCancel }: { initialEmail: string; onDone: (email: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useResendTimer(false);

  const cleanEmail = email.trim().toLowerCase();
  const rules = [
    { ok: password.length >= 8, label: "8+ characters" },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), label: "A letter and a number" },
    { ok: password.length > 0 && password === confirm, label: "Passwords match" },
  ];

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postPublic("/auth/password/forgot", { email: cleanEmail });
      setStep("code");
      setCode("");
      timer.restart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code.");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postPublic("/auth/password/reset", { email: cleanEmail, code, newPassword: password });
      onDone(cleanEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rise-in space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-extrabold text-[#30343B]">Reset your password</h3>
        <p className="mt-1 text-xs text-[#666D7A]">{step === "email" ? "We'll email you a 6-digit code." : "Enter the code and choose a new password."}</p>
      </div>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-sm font-semibold text-rose-700">{error}</div>}

      {step === "email" ? (
        <form className="space-y-4" onSubmit={sendCode}>
          <div>
            <label className={labelCls} htmlFor="fp-email">
              Email address
            </label>
            <input autoComplete="email" className={fieldCls} id="fp-email" onChange={(e) => setEmail(e.target.value)} placeholder="yourname@lpu.in" required type="email" value={email} />
          </div>
          <button className={primaryBtn} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)} type="submit">
            {busy ? "Sending…" : "Send me a code"}
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={resetPassword}>
          <SentNote email={cleanEmail} ifAccountExists />
          <div>
            <label className={labelCls} htmlFor="fp-code">
              6-digit code
            </label>
            <CodeInput id="fp-code" onChange={setCode} value={code} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="fp-password">
                New password
              </label>
              <input autoComplete="new-password" className={fieldCls} id="fp-password" maxLength={128} onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
            </div>
            <div>
              <label className={labelCls} htmlFor="fp-confirm">
                Confirm password
              </label>
              <input autoComplete="new-password" className={fieldCls} id="fp-confirm" maxLength={128} onChange={(e) => setConfirm(e.target.value)} type="password" value={confirm} />
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {rules.map((r) => (
              <li className={r.ok ? "font-semibold text-emerald-700" : "text-[#8C93A0]"} key={r.label}>
                {r.ok ? "✓" : "○"} {r.label}
              </li>
            ))}
          </ul>
          <button className={primaryBtn} disabled={busy || code.length !== 6 || !rules.every((r) => r.ok)} type="submit">
            {busy ? "Saving…" : "Set new password"}
          </button>
          <p className="text-center text-[11px] text-[#8C93A0]">Changing your password signs you out on every device.</p>
        </form>
      )}

      <div className="flex items-center justify-between text-xs font-bold">
        <button className="text-[#666D7A] hover:text-[#30343B]" onClick={step === "code" ? () => setStep("email") : onCancel} type="button">
          ← {step === "code" ? "Change email" : "Back to sign in"}
        </button>
        {step === "code" && (
          <button className="text-[#3978B8] hover:underline disabled:text-[#8C93A0] disabled:no-underline" disabled={timer.left > 0 || busy} onClick={() => sendCode()} type="button">
            {timer.left > 0 ? `Send a new code in ${timer.left}s` : "Send a new code"}
          </button>
        )}
      </div>
    </div>
  );
}
