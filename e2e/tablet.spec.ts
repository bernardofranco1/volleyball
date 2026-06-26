import { test, expect } from "@playwright/test";
import { E2E, hasCreds, login } from "./helpers";

// Team-tablet flow. Skips unless E2E_TABLET_PATH is set (a tokenized team page).
// Logs in first if creds are provided, in case the route is session-gated.
test.describe("team tablet flow", () => {
  test.skip(!E2E.tabletPath, "set E2E_TABLET_PATH to run");

  test("team requests a time-out", async ({ page }) => {
    if (hasCreds) await login(page);
    await page.goto(E2E.tabletPath!);

    await page
      .getByRole("button", { name: /time-?out/i })
      .first()
      .click();

    await expect(page.getByText(/request sent/i)).toBeVisible();
  });
});
