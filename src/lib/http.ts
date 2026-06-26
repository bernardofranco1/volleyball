import type { NextRequest } from "next/server";

/**
 * Only honor same-origin relative destinations (spec/14 §A3). Blocks open
 * redirects via `?redirectTo=https://evil.com` and protocol-relative `//evil`.
 * Pure + non-"use server" so it can be unit-tested directly.
 */
export function safeRedirect(dest: string): string {
  return /^\/(?![/\\])/.test(dest) ? dest : "";
}

/**
 * Same-origin guard for state-changing JSON routes (CSRF defence-in-depth,
 * spec/14 §A4). A cross-site `fetch` that sets an `Origin` must match our host;
 * requests with no `Origin` (same-site navigation/server-to-server) are allowed
 * — those can't be forged cross-site with a JSON content type anyway.
 */
export function sameOriginOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
