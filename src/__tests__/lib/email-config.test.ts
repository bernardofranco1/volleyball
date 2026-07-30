// Email template config (spec/23 addendum): friendly [TOKEN]s → real values
// at send time, plus the greeting-name derivation. The templates are runtime
// config (config/emails/) — a bad edit must fail here, not in a recipient's
// inbox.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findUnreplacedTokens,
  renderEmail,
  type EmailSettings,
  type EmailValues,
} from "@/lib/email-config";
import { firstNameFrom } from "@/lib/user-provisioning";

const SETTINGS = { platformUrl: "https://app.example.com", linkExpiryHours: 24 };
const VALUES: EmailValues = {
  firstName: "Ana",
  accessDetails: "Lisbon League — Admin",
  setPasswordLink: "https://sb.example.com/verify?token=abc",
  email: "ana@club.pt",
};

describe("renderEmail", () => {
  it("substitutes every documented token with its real value", () => {
    const out = renderEmail(
      "[FIRST_NAME]|[ACCESS_DETAILS]|[SET_PASSWORD_LINK]|[PLATFORM_LINK]|[LINK_EXPIRY_HOURS]|[EMAIL]",
      SETTINGS,
      VALUES,
    );
    expect(out).toBe(
      "Ana|Lisbon League — Admin|https://sb.example.com/verify?token=abc|https://app.example.com|24|ana@club.pt",
    );
    expect(findUnreplacedTokens(out)).toEqual([]);
  });

  it("falls back for a missing name and missing access details", () => {
    const out = renderEmail("[FIRST_NAME] / [ACCESS_DETAILS]", SETTINGS, {
      ...VALUES,
      firstName: "",
      accessDetails: null,
    });
    expect(out).toBe("there / the Volleyball Scoring Platform");
  });

  it("escapes HTML in person-controlled values", () => {
    const out = renderEmail("[FIRST_NAME]", SETTINGS, {
      ...VALUES,
      firstName: '<img src=x onerror="x">',
    });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("flags unknown tokens so they can't reach recipients", () => {
    expect(findUnreplacedTokens("hello [TYPO_TOKEN]")).toEqual(["[TYPO_TOKEN]"]);
  });

  // The shipped config files must always render clean — the same check the
  // sender enforces, pinned as a test so a bad edit fails CI before any send.
  it("the checked-in templates contain only known tokens", () => {
    const dir = join(process.cwd(), "config/emails");
    const settings = JSON.parse(
      readFileSync(join(dir, "emails.json"), "utf8"),
    ) as EmailSettings;
    for (const kind of ["invite", "recovery"] as const) {
      const html = readFileSync(join(dir, settings[kind].template), "utf8");
      expect(
        findUnreplacedTokens(renderEmail(html, settings, VALUES)),
        `${kind} template`,
      ).toEqual([]);
      expect(
        findUnreplacedTokens(renderEmail(settings[kind].subject, settings, VALUES)),
        `${kind} subject`,
      ).toEqual([]);
    }
  });
});

describe("firstNameFrom", () => {
  it("prefers the provided name's first word, capitalised", () => {
    expect(firstNameFrom("shyamang goswami", "x@y.z")).toBe("Shyamang");
  });

  it("derives from the email local part when no name is given", () => {
    expect(firstNameFrom(null, "bernardo.franco@fivb.com")).toBe("Bernardo");
    expect(firstNameFrom("", "ana-ribeiro@club.pt")).toBe("Ana");
  });
});
