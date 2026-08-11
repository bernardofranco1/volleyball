# 25 — One person, one row: identity keys, dedupe and merge

**Status: IMPLEMENTED 2026-08-11.** Migration `0011`. Follows spec/24 §6, which
created the registry; this makes "one human = one row" enforceable rather than
aspirational.

Product-owner decisions, confirmed 2026-08-11:

1. **Rows stay tenant-scoped, correlated by shared identity keys** — not one
   global row per human. *(confirmed)*
2. **A person can be linked to a login account now** (`people.user_id`), so the
   Referees' Hub can later show a referee their own nominations. *(confirmed)*

---

## 0. Why this was needed

spec/24 already got the *shape* right: rosters, match officials and team staff
are membership rows pointing at a person, so adding someone to a second
competition creates a membership, not a second person. Roles are person-level, so
a player who starts refereeing gains the role rather than a new record.

Three things still blocked the goal:

| Gap | Consequence |
|---|---|
| No identity key | Nothing could tell two records apart as the same human. Names collide, and some people have no surname at all — which is why spec/24's backfill deliberately created one person per roster row rather than guessing |
| No merge | Duplicates are inevitable (imports without identity data, two staff entering the same person). VIS ships `MovePlayerReferences` for exactly this reason |
| No roster uniqueness | Nothing stopped the same person being added to a team twice, or to two teams in one competition — the second is a genuine eligibility violation |

## 1. Scope decision: tenant-scoped, not global

`people.tenant_id` stays NOT NULL. A referee working for two customers of the
platform gets one row in each, correlated by `vis_person_no` / `email`.

Rejected: a platform-level `people` table. It would be the first entity shared
across tenants, and one tenant could discover a person another had registered —
through a picker search or an email collision. With minors' data and referee
records that is a data-protection exposure, not a tidiness question. Correlation
gives what a VIS push actually needs (knowing two rows are the same human)
without cross-tenant reads.

## 2. Identity keys

```sql
ALTER TABLE people ADD COLUMN email text;
CREATE UNIQUE INDEX people_tenant_email_uq ON people(tenant_id, email)
  WHERE email IS NOT NULL;
CREATE INDEX people_tenant_birthdate_idx ON people(tenant_id, birthdate);
```

`birthdate` already existed (spec/24 §2.2). Matching order, strongest first:

1. `vis_person_no` — authoritative when known
2. `email` — near-certain for adults who have one
3. name + `birthdate` — the classic sports disambiguator
4. name alone — a prompt to look, never evidence

**Unique-WHEN-PRESENT, never plain unique.** A plain unique would make email
effectively mandatory, and an absent email is normal: minors often have none,
families share one, and a veteran referee's address may be long dead. An empty
string would also occupy the index and block the next person without an address,
so `normalizeEmail()` maps blank to NULL.

A collision on any identity key is reported as *"this person already exists —
merge the duplicate"* rather than a raw constraint name, because that is what it
means.

### Placeholder addresses

`placeholderEmail(id)` → `person-<id>@example.invalid`.

Two deliberate properties. **Per-row**, because one shared value would collide on
the second row under the unique index. **`.invalid`**, reserved by RFC 2606 and
permanently unresolvable — this app has a working mail sender with invite and
welcome templates, so a placeholder at a registered domain (`gg.com`, say) would
eventually deliver real mail to a stranger. `scripts/backfill-people.ts
--placeholder-emails` fills them for dev/demo data only; the person editor labels
them as unreachable.

## 3. Login account link

```sql
ALTER TABLE people ADD COLUMN user_id text REFERENCES users(id);
CREATE UNIQUE INDEX people_tenant_user_uq ON people(tenant_id, user_id)
  WHERE user_id IS NOT NULL;
```

Nullable — most people in a registry never sign in. This is the join the Referee
Assignment stream needs: "my nominations" becomes `people WHERE user_id = me`
instead of an admin reading a list out. The person editor shows a **Has login**
badge; provisioning accounts for referees is a later slice.

## 4. Roster uniqueness

```sql
CREATE UNIQUE INDEX players_team_person_uq ON players(team_id, person_id)
  WHERE person_id IS NOT NULL;
```

The same-competition rule (a person may not play for two teams in one
competition) is enforced in `createPlayer` and `importRoster` rather than in the
database, because `players` reaches a competition only through its team and a
unique index cannot span that join. Both paths name the offending person in the
error.

## 5. Duplicate detection and merge

`findDuplicateCandidates()` surfaces candidates ranked by signal
(`EMAIL` → `VIS_NUMBER` → `NAME_AND_BIRTHDATE` → `NAME`) with a reference count,
on the person editor. It merges nothing automatically: a name-only match would
eventually fold two different players into one.

`mergePeople()` repoints rosters, officials slots and staff assignments onto the
surviving person, unions the roles, releases the dead row's identity keys (so a
soft-deleted duplicate isn't reserving an email forever) and soft-deletes it.
Three rules:

- **Printed history is never rewritten.** `match_officials` keeps its own
  name/country/level snapshot of what was on the sheet at match time; the merge
  moves the link and leaves the snapshot alone, so a sheet signed last season
  still reads as it did.
- **A merge that would double-book a roster is refused, not forced.** Silently
  dropping one of two roster rows would lose a jersey number and possibly a
  captain flag.
- **Roles are unioned** — a player record merged with a referee record yields
  someone who is both, which is the transition being modelled.

Verified against the live database: candidate found, roster spot moved, roles
unioned to `PLAYER, REFEREE`, source soft-deleted with keys released, officials
snapshots unchanged, and the double-booking merge refused.

## 6. Entry points hardened

`importRoster` matches on email → name+birthdate → name (reading optional
`Email` and `Birthdate` CSV columns), reports "N matched / M created", and rejects
a person appearing twice in one competition.

---

## 7. Incident found while implementing: transactions were dead

**Severity: every database transaction in the application was failing, including
the scoring write path. Pre-existing, introduced with the `max_pipeline: 0` fix
for the 2026-07-30 pooler incident.**

`src/db/index.ts` set `max_pipeline: 0` to stop postgres.js pipelining onto a
busy Supavisor connection — correct, and necessary. But postgres.js evaluates the
pipeline gate (`sent.length < max_pipeline`) in the *same `&&` chain* that invokes
`q.options.onexecute`, and `onexecute` is how `sql.begin()` claims its
connection. With `0` the chain short-circuits, begin's connection is never
claimed, and the driver refuses the `BEGIN`:

```
UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1
```

So `db.transaction()` threw everywhere: appending a scoring event
(`match-engine.ts` — one transaction per rally), creating a competition, saving
match officials, CSV imports, tenant purge, signatures. Nothing warned at startup
and the type checker was happy; it surfaced as a generic 500 from whichever
feature happened to need a transaction.

Two obvious fixes are both wrong:

- `max_pipeline: 1` revives transactions but re-enables depth-2 pipelining. It
  wedged a page during testing — the exact 2026-07-30 failure.
- `max: 1` with `max_pipeline: 0` still fails: begin's reservation depends on the
  same short-circuited callback.

**Fix: two pools.** Reads and single-statement writes use `db` (max 5,
`max_pipeline: 0`, no pipelining ever). Transactions use `dbTx` (max 1, default
pipelining) — postgres.js permits a raw `BEGIN` when `max === 1`, and a single
connection makes concurrent transactions *queue* rather than pipeline, so
Supavisor never sees interleaved statements. Cost: ~6 sockets per warm instance
instead of 5, and transactions serialise per instance, which is irrelevant at one
transaction per rally.

**One rule for `dbTx`: await each statement inside a transaction body, never
`Promise.all`.** Concurrent statements on that single connection are the
pipelining that wedges the pooler.

Verified end-to-end: a point scored on a live indoor match (21-21 → 22-21) and
the match restored to its exact prior state. Guarded by
`src/__tests__/lib/db-transaction.test.ts`, which asserts the pool options
directly — a comment would not survive the next well-meaning simplification.

## Out of scope

- Provisioning login accounts for referees (the `user_id` link exists; the UI
  and invite flow are the Referees' Hub's job).
- Cross-tenant correlation tooling — the keys are there, nothing consumes them
  until a VIS push exists (spec/24 §7.4 is still blocked on FIVB IT).
- Bulk "review all duplicates" screen; today detection is per-person.
