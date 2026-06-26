import { test, expect } from "@playwright/test";
import { E2E, hasCreds, login } from "./helpers";

// Authenticated scorer flow. Skips unless E2E creds + a scorer page path are set.
// Scoring is a two-tap "arm → confirm" interaction (see *ActionBar.tsx): the first
// tap on "Point <team>" arms it ("Confirm — <team>"), the second commits.
test.describe("scorer flow", () => {
  test.skip(
    !hasCreds || !E2E.scorerPath,
    "set E2E_EMAIL / E2E_PASSWORD / E2E_SCORER_PATH to run",
  );

  test("scorer awards a point via arm + confirm", async ({ page }) => {
    await login(page);
    await page.goto(E2E.scorerPath!);

    const arm = page.getByRole("button", { name: /^Point / }).first();
    await expect(arm).toBeVisible();
    await arm.click();

    const confirm = page.getByRole("button", { name: /^Confirm/ }).first();
    await expect(confirm).toBeVisible();
    await confirm.click();

    // A successful commit disarms the bar back to the "Point <team>" label.
    await expect(
      page.getByRole("button", { name: /^Point / }).first(),
    ).toBeVisible();
  });
});
