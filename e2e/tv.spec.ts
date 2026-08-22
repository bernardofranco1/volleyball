import { test, expect } from "@playwright/test";

// The TV broadcast overlay (spec/47).
//
// The graphics' fidelity is gated elsewhere and much more precisely —
// scripts/check-tv-bug.mjs renders the bug and
// spec/reference/avc-tv-gfx/check-render.py measures it against the master to
// half a pixel. What THAT cannot see is the route: that /tv is reachable at all
// on the deployment a production truck is pointed at, that the output page
// server-renders a populated bug on the first frame rather than an empty stage,
// and that the page is not indexable.
//
// Uses `mock`, which is an embedded capture (spec/35 W9) — no VIS call, no live
// fixture to wait for, and the same numbers every run.

test.describe("tv overlay", () => {
  test("the launcher renders and refuses an unplayable link", async ({ page }) => {
    await page.goto("/tv");
    const link = page.locator("#tv-link");
    await expect(link).toBeVisible();

    // A browser cannot play RTMP, and the form has to say so rather than let
    // the operator discover it as a black frame during a warm-up.
    await link.fill("rtmp://encoder.example.com/live/court1");
    await expect(page.getByText(/cannot play RTMP/i)).toBeVisible();

    // The link VolleyStation actually hands out resolves to its HLS manifest.
    await link.fill("https://streaming.volleystation.com:5443/FIVB/play.html?id=fivb15");
    await expect(page.getByText(/Ant Media \(HLS\)/)).toBeVisible();
  });

  test("the output page paints a populated score bug on the first frame", async ({
    page,
  }) => {
    await page.goto("/tv/mock?delay=0");

    // The bar's artwork, the flags and the type all have to be there — an
    // overlay that pops in a rally later is one the director has already cut
    // away from.
    const svg = page.locator("svg").first();
    await expect(svg.locator('image[href="/tv-gfx/bug-plate.png"]')).toHaveCount(1);
    await expect(svg.locator("text")).not.toHaveCount(0);

    // Both country codes, from the capture.
    await expect(svg.getByText("JPN", { exact: true })).toBeVisible();
    await expect(svg.getByText("POL", { exact: true })).toBeVisible();
    // "SETS" appears once per side.
    await expect(svg.getByText("SETS", { exact: true })).toHaveCount(2);
  });

  test("every graphic renders in rehearsal mode", async ({ page }) => {
    // The rehearsal parameter exists because substitutions and challenges are
    // rare and unschedulable: without it the first time anyone sees the
    // substitution lower third is during a live match.
    for (const [demo, text] of [
      ["review", "VIDEO CHALLENGE REVIEW"],
      ["success", "CHALLENGE SUCCESSFUL"],
      ["fail", "CHALLENGE UNSUCCESSFUL"],
      ["challenge", "CHALLENGE"],
      ["timeout", "TIMEOUT"],
      ["keymoment", "MATCH POINT"],
    ] as const) {
      await page.goto(`/tv/mock?delay=0&demo=${demo}`);
      await expect(
        page.locator("svg").getByText(text, { exact: true }).first(),
        demo,
      ).toBeVisible();
    }
  });

  test("the motion rehearsals actually move (spec/48)", async ({ page }) => {
    // The motion constants are unit-tested and the geometry is gated in the
    // browser, but neither can answer the only question that matters here: does
    // an animation RUN on the page a production truck points at. Both of these
    // are the client overlay working end to end — hydration handing over from
    // the server's static bug, the WAAPI call landing on a real element.
    await page.goto("/tv/mock?delay=0&demo=point");
    // A digit rolling out of frame exists only while the odometer is running.
    await expect(page.locator("[data-tv-outgoing]").first()).toBeAttached({
      timeout: 10_000,
    });

    await page.goto("/tv/mock?delay=0&demo=sideout");
    await page.waitForFunction(
      () => {
        const ball = document.querySelector('image[href$="bug-ball.png"]');
        return !!ball && ball.getAnimations().length > 0;
      },
      undefined,
      { timeout: 10_000 },
    );

    // A second substitution on the SAME side (spec/48.1 F1). It used to CUT,
    // and what proves it does not is the shape of the hand-over rather than any
    // one frame: the content is animating while the plate it sits on is not.
    await page.goto("/tv/mock?delay=0&demo=subswap");
    await page.waitForFunction(
      () => {
        const plate = [...document.querySelectorAll("[data-tv-motion]")].find((g) =>
          g.querySelector("[data-tv-content]"),
        );
        if (!plate) return false;
        const content = [...plate.querySelectorAll("[data-tv-content]")];
        return (
          content.some((c) =>
            c.getAnimations().some((a) => a.playState === "running"),
          ) && plate.getAnimations().every((a) => a.playState !== "running")
        );
      },
      undefined,
      { timeout: 10_000 },
    );
  });

  test("is not indexable", async ({ page }) => {
    // The whole "invisible to the average user" mechanism is that nothing links
    // here and search engines are told to stay out — same as /m/* (spec/38).
    for (const path of ["/tv", "/tv/mock"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(
        page.locator('meta[name="robots"]'),
        path,
      ).toHaveAttribute("content", /noindex/);
    }
  });

  test("an unknown match number 404s rather than relaying arbitrary VIS data", async ({
    page,
  }) => {
    const res = await page.goto("/tv/999999999");
    expect(res?.status()).toBe(404);
  });
});
