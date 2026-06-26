import { defineConfig, devices } from "@playwright/test";

// E2E config (Phase 11). The no-auth smoke (e2e/smoke.spec.ts) runs anywhere.
// The scorer / team-tablet flows are gated on E2E_* credentials and skip when
// unset, so CI stays green without secrets. Set E2E_BASE_URL to test a deployed
// URL instead of booting a local dev server.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Only boot a server when targeting localhost; skip for a remote E2E_BASE_URL.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
