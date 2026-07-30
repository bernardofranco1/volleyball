// App-side transactional email (spec/23 addendum). Templates + wording live
// in config/emails/ (editable without touching code); this module loads them,
// renders the [TOKEN]s and sends over SMTP.
//
// SMTP is configured via env (SMTP_HOST/PORT/USER/PASS/FROM — see
// .env.example). Without it, callers fall back to Supabase's default mailer
// (its fixed template, 2 emails/hour) — so the platform works either way and
// upgrades itself the moment credentials appear.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import {
  findUnreplacedTokens,
  renderEmail,
  type EmailSettings,
  type EmailValues,
} from "@/lib/email-config";
import { captureError } from "@/lib/observability";

const CONFIG_DIR = join(process.cwd(), "config/emails");

/** True when SMTP env is present — the switch between app-send and fallback. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function loadEmailSettings(): EmailSettings {
  return JSON.parse(
    readFileSync(join(CONFIG_DIR, "emails.json"), "utf8"),
  ) as EmailSettings;
}

/**
 * Render one of the configured templates and send it. Returns honestly —
 * callers show a temp password instead when the email couldn't go out.
 */
export async function sendTemplatedEmail(
  kind: "invite" | "recovery",
  to: string,
  values: EmailValues,
): Promise<{ sent: true } | { sent: false; reason: string }> {
  if (!emailConfigured())
    return { sent: false, reason: "SMTP is not configured (SMTP_* env vars)" };

  try {
    const settings = loadEmailSettings();
    const html = renderEmail(
      readFileSync(join(CONFIG_DIR, settings[kind].template), "utf8"),
      settings,
      values,
    );
    const subject = renderEmail(settings[kind].subject, settings, values);
    const leftovers = findUnreplacedTokens(subject + html);
    if (leftovers.length > 0)
      return { sent: false, reason: `unknown template token ${leftovers[0]}` };

    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    return { sent: true };
  } catch (err) {
    captureError(err, { scope: "email", kind, to });
    return {
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
