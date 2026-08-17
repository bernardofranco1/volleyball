/**
 * The Vercel client's two decision points (spec/31 test-suite audit).
 *
 * Everything else in @/lib/vercel is a thin fetch wrapper exercised end to end
 * by every real promotion, but two pieces are pure logic that the promote path
 * leans on and nothing covered:
 *
 * - `normalise` reconciles the TWO row shapes Vercel returns (list rows carry
 *   `uid`/`state`/`created`, detail rows `id`/`readyState`/`createdAt`). The
 *   console's target/state gates — "that is a production build", "that build
 *   is BUILDING, not READY" — read the normalised row, so a regression here
 *   silently weakens promote-time checks.
 * - `vercelConfig` decides whether the console exists. Its null is what the
 *   releases page renders as the setup notice, so which variables make it
 *   null is behaviour, not plumbing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing, vercelConfig } from "@/lib/vercel";

const { normalise } = __testing;

afterEach(() => vi.unstubAllEnvs());

describe("normalise", () => {
  it("reads a LIST row (uid / state / created)", () => {
    const d = normalise({
      uid: "dpl_1",
      url: "x.vercel.app",
      target: "production",
      state: "READY",
      created: 123,
      meta: {
        githubCommitSha: "b09d4e5ffffffff",
        githubCommitMessage: "title line\nbody to drop",
        githubCommitRef: "main",
      },
    });
    expect(d).toMatchObject({
      id: "dpl_1",
      target: "production",
      state: "READY",
      shortSha: "b09d4e5",
      message: "title line",
      branch: "main",
      createdAt: 123,
    });
  });

  it("reads a DETAIL row (id / readyState / createdAt)", () => {
    const d = normalise({
      id: "dpl_2",
      url: "y.vercel.app",
      readyState: "BUILDING",
      createdAt: 456,
    });
    expect(d.id).toBe("dpl_2");
    expect(d.state).toBe("BUILDING");
    expect(d.createdAt).toBe(456);
  });

  it("treats anything that is not production as a preview", () => {
    // The promote gate refuses non-production builds off this field. A null
    // or novel target must never read as promotable.
    for (const target of [undefined, null, "preview", "staging"] as const) {
      expect(normalise({ url: "u", target: target as never }).target).toBe(
        "preview",
      );
    }
  });

  it("never fabricates a state — unknown reads as QUEUED, not READY", () => {
    expect(normalise({ url: "u" }).state).toBe("QUEUED");
  });
});

describe("vercelConfig", () => {
  const stubAll = () => {
    vi.stubEnv("RELEASE_TOKEN", "tok");
    vi.stubEnv("RELEASE_PROJECT_ID", "prj_1");
    vi.stubEnv("RELEASE_TEAM_ID", "team_1");
    vi.stubEnv("RELEASE_REPO_ID", "42");
    vi.stubEnv("HOMOLOG_ALIAS", "volleyball-homolog.vercel.app");
  };

  it("is configured when the four required pieces are present", () => {
    stubAll();
    expect(vercelConfig()).toMatchObject({
      token: "tok",
      projectId: "prj_1",
      teamId: "team_1",
      repoId: 42,
    });
  });

  it("is null when any required piece is missing — the console must not half-work", () => {
    for (const missing of [
      "RELEASE_TOKEN",
      "RELEASE_PROJECT_ID",
      "RELEASE_TEAM_ID",
      "RELEASE_REPO_ID",
    ]) {
      vi.unstubAllEnvs();
      stubAll();
      vi.stubEnv(missing, "");
      // VERCEL_* system fallbacks must not be present either.
      vi.stubEnv("VERCEL_TOKEN", "");
      vi.stubEnv("VERCEL_PROJECT_ID", "");
      vi.stubEnv("VERCEL_GIT_REPO_ID", "");
      expect(vercelConfig()).toBeNull();
    }
  });

  it("survives a missing alias — only Set-as-homolog needs it", () => {
    stubAll();
    vi.stubEnv("HOMOLOG_ALIAS", "");
    expect(vercelConfig()?.homologAlias).toBeNull();
  });

  it("refuses a non-numeric repo id rather than deploying into NaN", () => {
    stubAll();
    vi.stubEnv("RELEASE_REPO_ID", "not-a-number");
    vi.stubEnv("VERCEL_GIT_REPO_ID", "");
    expect(vercelConfig()).toBeNull();
  });
});
