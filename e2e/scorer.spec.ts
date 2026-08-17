import { test, expect } from "@playwright/test";
import { E2E, describeAuthenticatedFlow, hasCreds, login } from "./helpers";

// Authenticated scorer flow. Skips unless E2E creds + a scorer page path are set.
//
// Two interactions, in order:
//
// 1. THE RALLY GATE (spec/22). Between rallies the two point buttons are
//    REPLACED by a single "Start rally ●", so every rally gets a precise start
//    timestamp by construction — scoring is impossible until the rally is
//    opened. All four action bars do this. This spec asserted the point button
//    was simply present, which stopped being true when the gate shipped; the
//    staleness went unnoticed because the spec has never actually run in CI
//    (spec/31 §1).
//
// 2. ARM → CONFIRM. The first tap on "Point <team>" arms it ("Confirm — <team>"),
//    the second commits (see *ActionBar.tsx).
test.describe("scorer flow", () => {
  // Skips without credentials; FAILS if pointed at the production tables —
  // this test awards a real point (see requireNonProductionTarget).
  describeAuthenticatedFlow(
    "set E2E_EMAIL / E2E_PASSWORD / E2E_SCORER_PATH to run",
    hasCreds && Boolean(E2E.scorerPath),
  );

  test("scorer awards a point via the rally gate, then arm + confirm", async ({
    page,
  }) => {
    await login(page);
    await page.goto(E2E.scorerPath!);

    // Open the rally when the gate is showing. Deliberately optional: which
    // phase the target match is parked in depends on whatever was last done to
    // it, and a fixture that must sit in one exact phase is a fixture that
    // rots between runs.
    const startRally = page.getByRole("button", { name: /^Start rally/ });
    if (await startRally.isVisible().catch(() => false)) {
      await startRally.click();
    }

    const arm = page.getByRole("button", { name: /^Point / }).first();
    await expect(arm).toBeVisible();
    await arm.click();

    const confirm = page.getByRole("button", { name: /^Confirm/ }).first();
    await expect(confirm).toBeVisible();
    await confirm.click();

    // A successful commit disarms the bar. Either label passes: the point
    // buttons return, or the rally gate closes again behind the scored point.
    await expect(
      page.getByRole("button", { name: /^(Point |Start rally)/ }).first(),
    ).toBeVisible();
  });
});
