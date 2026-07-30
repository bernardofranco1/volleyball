// Email template rendering (spec/23 addendum). Pure — the templates live as
// editable files under config/emails/ and the APP renders + sends them (via
// src/lib/email.ts): Supabase only generates the secure link. This keeps all
// wording in config files and sidesteps the free-tier restriction on
// modifying Supabase's own mailer templates.

export interface EmailSettings {
  platformUrl: string;
  linkExpiryHours: number;
  invite: { subject: string; template: string };
  recovery: { subject: string; template: string };
}

export interface EmailValues {
  firstName: string;
  /** Null → generic wording (the fallback below). */
  accessDetails: string | null;
  setPasswordLink: string;
  email: string;
}

/**
 * Substitute the friendly [TOKEN]s with real values. Every token must resolve
 * — an unreplaced [TOKEN] would reach a real recipient verbatim (the caller
 * verifies with findUnreplacedTokens; a unit test pins the shipped files).
 */
export function renderEmail(
  text: string,
  settings: Pick<EmailSettings, "platformUrl" | "linkExpiryHours">,
  values: EmailValues,
): string {
  return text
    .replaceAll("[FIRST_NAME]", escapeHtml(values.firstName) || "there")
    .replaceAll(
      "[ACCESS_DETAILS]",
      escapeHtml(values.accessDetails ?? "") ||
        "the Volleyball Scoring Platform",
    )
    .replaceAll("[SET_PASSWORD_LINK]", values.setPasswordLink)
    .replaceAll("[PLATFORM_LINK]", settings.platformUrl)
    .replaceAll("[LINK_EXPIRY_HOURS]", String(settings.linkExpiryHours))
    .replaceAll("[EMAIL]", escapeHtml(values.email));
}

/** Tokens that must not survive into a sent email. */
export function findUnreplacedTokens(rendered: string): string[] {
  return [...rendered.matchAll(/\[[A-Z_]+\]/g)].map((m) => m[0]);
}

/** Names/labels are interpolated into HTML — never as markup. */
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
