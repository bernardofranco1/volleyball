import { type Page, expect } from "@playwright/test";

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

/** Log in via the real /login form and wait for the tenant area. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E.email!);
  await page.fill('input[name="password"]', E2E.password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/t\//, { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);
}
