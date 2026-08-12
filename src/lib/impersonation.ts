// "Sign in as…" — the signed cookie behind global-admin impersonation
// (spec/26). The admin's own Supabase session is never swapped; this cookie is
// an OVERLAY read by getCurrentUser() (authz.ts), and it is never sufficient on
// its own: every request re-verifies that the real session belongs to `actor`
// and that `actor` is still a global admin.
//
// Node-only (node:crypto + next/headers). The edge Proxy may check the cookie's
// PRESENCE but never verifies or trusts it.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { authCookieOptions, IMPERSONATION_COOKIE } from "@/lib/subdomain";

export { IMPERSONATION_COOKIE };

/** Hard cap on a single impersonation session (spec/26 §3.4). */
export const IMPERSONATION_TTL_S = 60 * 60;

/** Context prefix — domain-separates this HMAC from the scorer-PIN one. */
const SIG_CONTEXT = "vbimp:v1:";
const VERSION = "v1";

export interface ImpersonationClaim {
  /** Real signed-in global admin (the actor). */
  actorUserId: string;
  /** The user being impersonated. */
  targetUserId: string;
  /** Unix seconds. */
  issuedAt: number;
  expiresAt: number;
}

/** Wire form: short keys keep the cookie small. */
interface Payload {
  a: string;
  t: string;
  iat: number;
  exp: number;
}

/**
 * Same fail-closed key chain as the scorer PIN (scorer-pin.ts): a missing
 * secret must never fall back to a guessable constant — an offline-forgeable
 * impersonation cookie would be a privilege-escalation primitive.
 */
function hmacKey(): string {
  const key =
    process.env.PIN_HMAC_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.DATABASE_URL;
  if (!key)
    throw new Error(
      "PIN_HMAC_SECRET (or SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL) must be set to sign impersonation cookies.",
    );
  return key;
}

function sign(payloadB64: string): string {
  return crypto
    .createHmac("sha256", hmacKey())
    .update(SIG_CONTEXT + payloadB64)
    .digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Build the signed cookie value for a new impersonation session. */
export function makeImpersonationCookie(
  actorUserId: string,
  targetUserId: string,
  now: Date = new Date(),
): { value: string; expiresAt: number } {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + IMPERSONATION_TTL_S;
  const payload: Payload = { a: actorUserId, t: targetUserId, iat, exp };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { value: `${VERSION}.${b64}.${sign(b64)}`, expiresAt: exp };
}

/**
 * Verify a cookie value. Returns null for ANY problem — bad shape, unknown
 * version, tampered payload or signature, expired, or a lifetime longer than
 * the cap (which would mean the value predates a TTL change or was minted by
 * something other than makeImpersonationCookie).
 *
 * A null result always means "no impersonation": callers fall back to the real
 * user rather than failing the request.
 */
export function readImpersonationCookie(
  value: string | undefined | null,
  now: Date = new Date(),
): ImpersonationClaim | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [version, b64, sig] = parts;
  if (version !== VERSION) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(b64) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!timingSafeEqualHex(sig, sign(b64))) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { a, t, iat, exp } = payload ?? {};
  if (typeof a !== "string" || !a) return null;
  if (typeof t !== "string" || !t) return null;
  if (typeof iat !== "number" || typeof exp !== "number") return null;
  if (exp - iat > IMPERSONATION_TTL_S) return null;
  if (exp <= Math.floor(now.getTime() / 1000)) return null;
  // Self-impersonation is meaningless and would hide the actor in attribution.
  if (a === t) return null;

  return { actorUserId: a, targetUserId: t, issuedAt: iat, expiresAt: exp };
}

// ── cookie jar helpers (Server Actions / Route Handlers only) ────────────────
//
// The apex `domain` from authCookieOptions() is essential: once subdomain
// routing is live, postLoginDestination sends the admin to
// https://{tenant}.{root}/… and a host-only cookie would not follow
// (spec/26 §4). Same reason the proxy applies it to lastTenant.

export async function setImpersonationCookie(
  actorUserId: string,
  targetUserId: string,
): Promise<{ expiresAt: number }> {
  const { value, expiresAt } = makeImpersonationCookie(actorUserId, targetUserId);
  const { domain } = authCookieOptions();
  (await cookies()).set(IMPERSONATION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_TTL_S,
    ...(domain ? { domain } : {}),
  });
  return { expiresAt };
}

/** Delete the cookie (must repeat domain/path or the browser keeps it). */
export async function clearImpersonationCookie(): Promise<void> {
  const { domain } = authCookieOptions();
  (await cookies()).delete({
    name: IMPERSONATION_COOKIE,
    path: "/",
    ...(domain ? { domain } : {}),
  });
}

/**
 * Raw cookie value for this request, if any.
 *
 * Tolerant of having no request scope at all (provisioning scripts, unit
 * tests, anything calling authz outside a request): there is no cookie jar,
 * therefore no overlay — the caller resolves to the real user. Failing closed
 * IS the safe direction here, since the overlay only ever grants LESS access
 * than the admin already has.
 */
export async function currentImpersonationCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(IMPERSONATION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
