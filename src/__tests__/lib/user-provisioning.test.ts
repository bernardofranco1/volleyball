// Account-provisioning helpers (spec/23 addendum): the temp-password alphabet
// contract and origin resolution for links in outgoing emails.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appOrigin, genPassword } from "@/lib/user-provisioning";

// @/lib/user-provisioning pulls in @/db and the service-role Supabase client at
// module level — stub both so importing it is inert in tests.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/supabase-admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const hdrs = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => hdrs.current }));

describe("genPassword", () => {
  it("is 5-dash-7 alphanumeric with no ambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const pw = genPassword();
      expect(pw).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{7}$/);
      // 0/O, 1/l/I are indistinguishable when read aloud or handwritten.
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });
});

describe("appOrigin", () => {
  beforeEach(() => {
    hdrs.current = new Headers();
  });

  it("NEXT_PUBLIC_APP_URL wins, trailing slash stripped", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://volleyball.example.com/");
    hdrs.current.set("x-forwarded-host", "ignored.example.com");
    expect(await appOrigin()).toBe("https://volleyball.example.com");
  });

  it("without the env, uses x-forwarded-host + x-forwarded-proto", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    hdrs.current.set("x-forwarded-host", "app.example.com");
    hdrs.current.set("x-forwarded-proto", "http");
    hdrs.current.set("host", "internal:3000"); // forwarded host outranks it
    expect(await appOrigin()).toBe("http://app.example.com");
  });

  it("falls back to the host header and https", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    hdrs.current.set("host", "app.example.com");
    expect(await appOrigin()).toBe("https://app.example.com");
  });

  it("last resort is https://localhost:3000", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(await appOrigin()).toBe("https://localhost:3000");
  });
});
