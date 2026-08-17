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

// ── official scoresheet download (spec/29 F7) ───────────────────────────────
//
// The renderer is covered by unit fixtures; what those cannot see is the ROUTE
// — auth, headers, and the fact that a real HTTP response carries a PDF rather
// than an HTML error page. That is the whole point of this one.
test.describe("official scoresheet route", () => {
  test("refuses an unauthenticated export instead of leaking a sheet", async ({
    request,
  }) => {
    const res = await request.get("/api/matches/does-not-exist/export.pdf", {
      maxRedirects: 0,
    });
    // Unauthorized / not found / redirect to login — never 200 with a document.
    expect(res.status()).not.toBe(200);
    expect(res.headers()["content-type"] ?? "").not.toContain("application/pdf");
  });
});
