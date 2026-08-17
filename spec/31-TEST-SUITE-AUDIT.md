# 31 — Test-suite audit: number, depth, and what "attested on build" actually means

**Status: AUDITED 2026-08-17; first installment of fixes shipped the same day.**
Requested as: can the number and depth of the unit tests be optimised so every
functionality is attested to work at build time? Short answer: the suite is
fast and its engine core is genuinely deep, so "number" was never the problem —
the real findings were three structural ones: tests that could not fail with
the code (mirror tests), tests made redundant by a stronger technique arriving
later, and a large, uneven blind spot around server actions and consoles. Plus
one uncomfortable fact about the word "build".

## 0. The baseline (measured, not felt)

- **62 files, 611 tests, ~23 s wall** (≈11 s test time; half the wall clock is
  module imports). Speed is not a constraint and nothing here optimises for it.
- **Coverage of files the tests actually import: 72% statements.** But only
  **92 of 294** source files are imported by any test at all — the other 205
  (~70% of files) have no automated attestation of any kind.
- The blind spot is not random. What's dark: nearly all of
  `src/components/**` (consoles, admin UI, boards), all `src/app/**` routes
  and pages, and **28 of the `src/lib/*-actions.ts` server-action modules** —
  the mutation layer. What's lit: the four engines, the scoresheet data layer
  and renderers, authz/tenancy, backups, releases logic, the queue.

That distribution is defensible — the engines and the sheet are the parts a
federation would sue over — but it was never *chosen*, and the mutation layer
being dark is the biggest single risk in the suite.

## 1. What "attested on build" currently means — the honest version

- CI (`.github/workflows/ci.yml`) runs lint + typecheck + all unit tests on
  every push to main and every PR. Good.
- **The Vercel build does not wait for CI.** A push to main produces the
  homologation preview whether or not tests pass; nothing in the deploy path
  consults the test result. The unit suite is *advisory* to deployment.
- The compensating control is procedural and real: promotion to production is
  a deliberate human act through the release console, and homologation sits in
  between. But "the tests gate production" is true only if the person
  promoting checked the Actions tab first.
- The e2e job silently skips the scorer/tablet specs when `E2E_*` secrets are
  absent — a green e2e job does not mean the scoring flow was exercised.

**Recommendation (not implemented, needs an owner decision):** either enable
GitHub branch protection so `main` requires the CI check (costs: no more
direct pushes — the current workflow pushes to main directly), or surface the
candidate's CI status in the release console (costs: a GITHUB_TOKEN, which
spec/28 deliberately avoided). Until one of those, the attestation chain has a
human link, and this spec's job is to say so out loud.

## 2. Finding: mirror tests — tests that cannot fail when the code drifts

Three suites asserted **private copies** of production logic rather than the
production logic:

| Suite | What it mirrored | Why it mattered |
|---|---|---|
| `offline-queue.test.ts` | the queue restore/age-out decision in `match-provider.tsx` | the double-scoring hazard's regression net was fictional |
| `exceptional-substitution.test.ts` | the quota backstop in the interrupt-requests route + the SubPanel confirm gate | the exact gates that had *just* shipped a three-gate bug |
| `releases-console-scope.test.ts` | nothing — it re-tested `db/env` under a new name | four tests, zero unique signal |

A mirror test is worse than no test: it documents an intention while attesting
nothing, and it turns green precisely when the code walks away from it.

**Fixed (this audit's first installment):**
- Queue decisions extracted to `src/lib/offline-queue.ts`
  (`decideQueueRestore`, `describeLegacyQueue`, `QUEUE_MAX_AGE_MS`); the
  provider and the tests now import the same functions.
- Quota bypass extracted to `src/lib/interrupt-quota.ts`
  (`quotaBypassAllowed`); route + tests share it. The SubPanel gate extracted
  to `roster.ts` (`canConfirmSubstitution`); panel + tests share it.
- `releases-console-scope.test.ts` deleted outright.

## 3. Finding: tests subsumed by a stronger technique

PDF text extraction (spec/30 Phase G) made two older techniques obsolete:

- The `%PDF- && length > 20000` renderer smokes in `official-scoresheet.test.ts`
  were strictly weaker than the golden extraction suite rendering the same
  shapes. **Deleted.**
- `coach-box.test.ts` (1.9 s — the second-slowest file) rendered each sheet
  twice and asserted the *bytes differed*, because extraction didn't exist when
  it was written. Any incidental byte difference would also have passed.
  **Rewritten** to assert the coach's *name* is printed — stronger, and half
  the renders.

Net: −9 tests of ceremony, +13 tests of substance elsewhere; 611 → 615.

## 4. Finding: gaps the audit filled immediately (small, high-value)

- **Grass/light emergency-substitution slot waiver** — shipped in spec/30
  Phase A *without tests*, i.e. the same omission that let the indoor half of
  that bug survive spec/29. Now pinned for both engines, including the
  "waiving Rule 15.6 does not waive reality" physical checks.
- **`vercel.ts` promote-path parsing** (`normalise`, `vercelConfig`) — 25%
  covered, feeding the console's target/state gates. Now tested — and the
  tests immediately found two real defects: a **blanked** `RELEASE_REPO_ID`
  (dashboard-cleared = empty string, the exact gotcha `db/env.ts` documents)
  coalesced to `repoId: 0` and produced a "configured" console that would
  deploy repo 0; a blanked `HOMOLOG_ALIAS` produced `""` instead of null.
  Both fixed: blanks now count as absent throughout `vercelConfig`.

That is the audit's strongest argument for *depth* over *number*: eight new
tests on forty lines of config parsing found two live defects; the suite's 611
existing tests had walked past them.

## 5. The prioritized backlog (recommended, not yet built)

In value order, with the pattern to use:

1. **Server actions** (28 dark modules). The drizzle-mock pattern in
   `user-admin-actions.test.ts` / `tenant-admin-actions.test.ts` already
   exists; extend it to the highest-blast-radius actions first:
   `release-actions` (promote orchestration — guards are pure-tested, the
   orchestration is not), `match-admin-actions` (rewind + fault-correction
   gates), `team-actions` (`rosterKind`, jersey/captain rules), `csv-actions`
   (imports write rosters wholesale). Est. 1–2 days for the four.
2. **Engine validators to parity** — grass 31%, light 29% vs indoor/beach
   ~70%+. The uncovered branches are mostly refusals; refusals are what stand
   between a mis-tap and the official record. Est. half a day.
3. **`liveMatches` window-count** (spec/28 hardening fix, untested — needs a
   small `db.execute` mock). Est. an hour.
4. **Consoles/components**: do NOT chase unit coverage here. The right
   instrument is the existing Playwright layer plus the spec/27 browser-QA
   pattern; unit-testing React consoles buys little per test. Instead, wire
   the `E2E_*` secrets in CI so the scorer/tablet specs stop silently
   skipping.
5. **Coverage visibility**: `npm run test:coverage` now exists
   (`@vitest/coverage-v8` dev-dep). Recommendation: after backlog item 1,
   add thresholds (~statements 75%) so the ratchet only turns one way.
   Adding thresholds *now* would freeze the blind spot into the baseline.

## 6. What was deliberately left alone

- The engine suites (beach 31, indoor 28, light 18, grass 11 tests) — the
  depth is real: replay semantics, undo batches, auto-emits, win conditions.
- `multitenancy.test.ts` (35) — includes the journal-idx drift guard that has
  already caught two real mistakes in two days.
- The golden fixtures — after spec/30 they are the closest thing the repo has
  to a whole-product attestation, and both recent stale-cache bugs were caught
  by exactly this layer.
- Suite speed. 23 s is not a problem worth a single line of churn.
