import { type Page, expect, test } from "@playwright/test";

/** Credentials/targets for the authenticated flows — set in CI secrets / .env. */
export const E2E = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
  /** Full path to a live/in-progress match's scorer page, e.g.
   *  /t/<slug>/competitions/<cid>/matches/<mid>/live */
  scorerPath: process.env.E2E_SCORER_PATH,
  /** Full path to a team-tablet page, e.g. /t/<slug>/matches/<mid>/team/A */
  tabletPath: process.env.E2E_TABLET_PATH,
};

export const hasCreds = Boolean(E2E.email && E2E.password);

/**
 * Refuse to run a WRITING flow against the production tables.
 *
 * The authenticated e2e specs are not read-only: the scorer flow awards a real
 * point, and the tablet flow files a real request. Both append to an
 * append-only log that is somebody's official record.
 *
 * Nothing else stops them. CI boots the app itself, and `DB_SCHEMA` unset means
 * `public` — production — because that default exists so a missing dashboard
 * variable can never take the live site down (db/env.ts). The Vercel
 * cross-check that would catch the mismatch only fires on a Vercel deployment,
 * and GitHub Actions is not one.
 *
 * So the check lives with the tests, where it cannot be lost to a workflow
 * edit: ask the running app which tables it is serving and stop if the answer
 * is production. `/api/version` is unauthenticated and cheap.
 *
 * Deliberately a FAILURE, not a skip: a silent skip is how these specs came to
 * be believed-green while never running at all (spec/31 §1).
 */
export async function requireNonProductionTarget(page: Page): Promise<void> {
  const res = await page.request.get("/api/version");
  expect(
    res.ok(),
    "/api/version did not answer — cannot prove this is not production",
  ).toBe(true);
  const body = (await res.json()) as { schema?: string; environment?: string };
  expect(
    body.schema,
    `E2E write flows must never run against the production tables. ` +
      `The target reports schema="${body.schema}". Set DB_SCHEMA=homolog ` +
      `(and point E2E_SCORER_PATH / E2E_TABLET_PATH at homologation data).`,
  ).not.toBe("public");
}

/**
 * Guard + skip reason for the authenticated specs, in one call.
 *
 * `test.skip()` at describe level handles "no credentials configured"; this
 * handles "configured, but aimed somewhere it must not write".
 */
export function describeAuthenticatedFlow(reason: string, configured: boolean) {
  test.skip(!configured, reason);
  test.beforeEach(async ({ page }) => {
    await requireNonProductionTarget(page);
  });
}

/** Log in via the real /login form and wait for the tenant area. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E.email!);
  await page.fill('input[name="password"]', E2E.password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/t\//, { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);
}
