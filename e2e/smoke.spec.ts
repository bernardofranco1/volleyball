import { test, expect } from "@playwright/test";

// No-auth smoke: proves the app boots, routing works, and the health contract
// holds. Runs everywhere (no DB secrets required) — health may report degraded
// when the DB is unreachable, which is still a valid, monitored response.
test.describe("smoke", () => {
  test("health endpoint returns a valid contract", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(["ok", "degraded"]).toContain(body.status);
    expect(["ok", "down"]).toContain(body.db);
    expect(typeof body.time).toBe("string");
  });

  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("unauthenticated tenant route redirects to login", async ({ page }) => {
    await page.goto("/t/demo/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
