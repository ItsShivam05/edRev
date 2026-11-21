import nodemailer, { type Transporter } from "nodemailer";
import { mailTransportName } from "../config/runtime.js";

// Email codes (docs/modules/email-codes.md §6). One small sender with three transports:
// memory (tests), console (development: printed in the API terminal) and smtp (Gmail App password, free).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const outbox: (MailMessage & { sentAt: string })[] = [];

/** Test helper: everything "sent" with the memory transport, newest last. */
export function mailOutbox(): readonly (MailMessage & { sentAt: string })[] {
  return outbox;
}

/** Test helper. */
export function clearMailOutbox(): void {
  outbox.length = 0;
}

let smtp: Transporter | null = null;
function smtpTransport(): Transporter {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return smtp;
}

/**
 * Sends one email. Returns false (and logs) when sending fails: callers never change their answer because of it
 * (VERIFY-08), the student can simply ask for a new code.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const transport = mailTransportName();
  try {
    if (transport === "memory") {
      outbox.push({ ...message, sentAt: new Date().toISOString() });
      return true;
    }
    if (transport === "console") {
      console.log(`\n[mail] To: ${message.to}\n[mail] Subject: ${message.subject}\n${message.text}\n`);
      return true;
    }
    const from = process.env.MAIL_FROM ?? `"REVALANCHE" <${process.env.SMTP_USER}>`;
    await smtpTransport().sendMail({ from, ...message });
    return true;
  } catch (error) {
    console.warn(`[mail] could not send "${message.subject}" to ${message.to}: ${(error as Error).message}`);
    return false;
  }
}

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain, Outlook-friendly layout (MAIL-03): text first, simple HTML, no images, nothing to click. */
function layout(lines: string[], code?: string): string {
  const body = lines.map((line) => `<p style="margin:0 0 12px">${esc(line)}</p>`).join("");
  const codeBlock = code
    ? `<p style="margin:16px 0;font-size:28px;font-weight:bold;letter-spacing:6px;font-family:Consolas,monospace;color:#30343B">${esc(code)}</p>`
    : "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#30343B;max-width:480px">${body.replace("{{code}}", codeBlock)}<p style="margin:16px 0 0;color:#666D7A;font-size:12px">REVALANCHE · Institutional Earning OS</p></div>`;
}

export function signupCodeEmail(to: string, name: string, code: string): MailMessage {
  const lines = [`Hi ${name},`, "Your code to verify your email for REVALANCHE is:", "{{code}}", "It expires in 10 minutes. If you didn't sign up, you can ignore this email."];
  return {
    to,
    subject: `Your REVALANCHE code: ${code}`,
    text: `Hi ${name},\n\nYour code to verify your email for REVALANCHE is: ${code}\n\nIt expires in 10 minutes. If you didn't sign up, you can ignore this email.\n\nREVALANCHE`,
    html: layout(lines, code),
  };
}

export function resetCodeEmail(to: string, name: string, code: string): MailMessage {
  const lines = [`Hi ${name},`, "Your code to reset your REVALANCHE password is:", "{{code}}", "It expires in 10 minutes. If you didn't ask for this, you can ignore this email: your password stays the same."];
  return {
    to,
    subject: `Your REVALANCHE password reset code: ${code}`,
    text: `Hi ${name},\n\nYour code to reset your REVALANCHE password is: ${code}\n\nIt expires in 10 minutes. If you didn't ask for this, you can ignore this email: your password stays the same.\n\nREVALANCHE`,
    html: layout(lines, code),
  };
}

export function passwordChangedEmail(to: string, name: string, when: Date): MailMessage {
  const at = when.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const lines = [`Hi ${name},`, `Your REVALANCHE password was changed on ${at}. You've been signed out everywhere.`, "If this wasn't you, contact your cell coordinator straight away."];
  return {
    to,
    subject: "Your REVALANCHE password was changed",
    text: `Hi ${name},\n\nYour REVALANCHE password was changed on ${at}. You've been signed out everywhere.\n\nIf this wasn't you, contact your cell coordinator straight away.\n\nREVALANCHE`,
    html: layout(lines),
  };
}
