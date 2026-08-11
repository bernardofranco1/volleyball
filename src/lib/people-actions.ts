"use server";

// Mutations for the people registry (spec/24 §6.1). Reads live in people.ts.
//
// Everything here is ADMIN_ROLES and tenant-scoped: a person id is always
// re-checked against the acting tenant before being written, so a hand-crafted
// form post can't reach into another tenant's registry.
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, dbTx } from "@/db";
import {
  matchOfficials,
  people,
  personRoles,
  players,
  teamStaff,
} from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import { newId } from "@/lib/id";
import {
  isPersonRole,
  looksLikeEmail,
  normalizeEmail,
  personUsage,
  PERSON_POSITIONS,
  STAFF_FUNCTIONS,
  type PersonRole,
  type StaffFunction,
} from "@/lib/people";

/**
 * Turn a unique-index violation on an identity key into something an admin can
 * act on. The whole point of these keys is that a collision means "this person
 * already exists" — so the message should say that, and point at the merge tool.
 */
function identityConflict(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("people_tenant_email_uq"))
    return "Someone in this tenant already has that email address — that is usually the same person. Search for them instead, or merge the duplicate.";
  if (msg.includes("people_tenant_vis_uq"))
    return "Someone in this tenant already has that VIS person number.";
  if (msg.includes("people_tenant_user_uq"))
    return "That login account is already linked to another person.";
  return null;
}

/** Parse an integer field, rejecting nonsense rather than storing NaN. */
function intOrNull(fd: FormData, field: string): number | null {
  const raw = str(fd, field);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function enumOrNull<T extends string>(
  fd: FormData,
  field: string,
  allowed: readonly T[],
): T | null {
  const raw = str(fd, field);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** YYYY-MM-DD or null. Stored as a date column, so the shape must be right. */
function dateOrNull(fd: FormData, field: string): string | null {
  const raw = str(fd, field);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

interface PersonFields {
  firstName: string | null;
  lastName: string | null;
  jerseyName: string;
  gender: "M" | "W" | null;
  email: string | null;
  birthdate: string | null;
  federationCode: string | null;
  heightCm: number | null;
  weightKg: number | null;
  position: (typeof PERSON_POSITIONS)[number] | null;
  spikeReachCm: number | null;
  blockReachCm: number | null;
  handedness: "LEFT" | "RIGHT" | null;
  photoUrl: string | null;
  refereeLevel: string | null;
  visPersonNo: number | null;
  notes: string | null;
}

function readFields(fd: FormData): PersonFields | { error: string } {
  const firstName = str(fd, "firstName") || null;
  const lastName = str(fd, "lastName") || null;
  // The display/shirt label defaults to the spoken name, but is stored
  // separately — VIS's equivalent is a shirt label, not a surname (spec/24 §7.5).
  // The jersey/shirt name is what every match output prints (spec/26). It
  // defaults to the SURNAME, not "First Last": that is the federation
  // convention, and it is what the boards were already displaying.
  const jerseyName =
    str(fd, "jerseyName") ||
    lastName ||
    firstName ||
    "";
  if (!jerseyName) return { error: "A name is required." };

  const federationCode = (str(fd, "federationCode") || "").toUpperCase() || null;
  if (federationCode && !/^[A-Z]{3}$/.test(federationCode))
    return { error: "Federation code must be three letters (e.g. BRA)." };

  const photoUrl = str(fd, "photoUrl") || null;
  if (photoUrl && !/^https:\/\//i.test(photoUrl))
    return { error: "Photo URL must be an https:// address." };

  const email = normalizeEmail(str(fd, "email"));
  if (email && !looksLikeEmail(email))
    return { error: "That email address doesn't look right." };

  return {
    firstName,
    lastName,
    jerseyName,
    gender: enumOrNull(fd, "gender", ["M", "W"] as const),
    email,
    birthdate: dateOrNull(fd, "birthdate"),
    federationCode,
    heightCm: intOrNull(fd, "heightCm"),
    weightKg: intOrNull(fd, "weightKg"),
    position: enumOrNull(fd, "position", PERSON_POSITIONS),
    spikeReachCm: intOrNull(fd, "spikeReachCm"),
    blockReachCm: intOrNull(fd, "blockReachCm"),
    handedness: enumOrNull(fd, "handedness", ["LEFT", "RIGHT"] as const),
    photoUrl,
    refereeLevel: str(fd, "refereeLevel") || null,
    visPersonNo: intOrNull(fd, "visPersonNo"),
    notes: str(fd, "notes") || null,
  };
}

function readRoles(fd: FormData): PersonRole[] {
  return [...new Set(fd.getAll("roles").map(String).filter(isPersonRole))];
}

async function syncRoles(
  personId: string,
  tenantId: string,
  roles: PersonRole[],
): Promise<void> {
  await db.delete(personRoles).where(eq(personRoles.personId, personId));
  if (roles.length === 0) return;
  await db.insert(personRoles).values(
    roles.map((role) => ({
      id: newId("prole"),
      personId,
      tenantId,
      role,
    })),
  );
}

/**
 * Resolve what a PersonPicker submitted into a person id, creating the person
 * when only a name came back (spec/24 §6.2/§6.3). Shared by the roster, officials
 * and staff actions so "pick or add" behaves identically everywhere.
 *
 * A submitted id is always re-checked against the acting tenant. A name-only
 * submission creates a NEW person rather than fuzzy-matching an existing one:
 * attaching a match official to the wrong human is far worse than a duplicate
 * somebody can merge later.
 */
export async function resolvePickedPerson(
  tenantId: string,
  picked: { personId?: string | null; personName?: string | null },
  role: PersonRole,
): Promise<{ id: string; name: string } | { error: string }> {
  if (picked.personId) {
    const row = (
      await db
        .select({ id: people.id, name: people.jerseyName })
        .from(people)
        .where(and(eq(people.id, picked.personId), eq(people.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!row) return { error: "Unknown person." };
    // Keep the role set honest: picking someone for a referee slot means they
    // are a referee here, even if they were first created as a player.
    await db
      .insert(personRoles)
      .values({ id: newId("prole"), personId: row.id, tenantId, role })
      .onConflictDoNothing();
    return { id: row.id, name: row.name };
  }

  const raw = (picked.personName ?? "").trim();
  if (!raw) return { error: "Pick a person or type a name." };
  const parts = raw.split(/\s+/);
  const id = newId("per");
  await db.insert(people).values({
    id,
    tenantId,
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : null,
    // Quick-add from a picker: the surname is the jersey label, matching the
    // default the person form uses (spec/26).
    jerseyName: parts.length > 1 ? parts[parts.length - 1] : raw,
  });
  await db
    .insert(personRoles)
    .values({ id: newId("prole"), personId: id, tenantId, role });
  return { id, name: raw };
}

/** Create a person. ADMIN_ROLES. */
export async function createPerson(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const parsed = readFields(fd);
  if ("error" in parsed) return fail(parsed.error);

  const id = newId("per");
  try {
    await db.insert(people).values({ id, tenantId: ctx.tenant.id, ...parsed });
  } catch (err) {
    // The identity keys are unique-when-present; say which one collided rather
    // than surfacing a raw constraint name (spec/25 §2).
    const dupe = identityConflict(err);
    if (dupe) return fail(dupe);
    throw err;
  }
  const roles = readRoles(fd);
  await syncRoles(id, ctx.tenant.id, roles);

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "person.create",
    entityType: "person",
    entityId: id,
    summary: `Created ${parsed.jerseyName}`,
    metadata: { roles },
  });
  revalidatePath(`/t/${tenantSlug}/people`);
  return ok(`${parsed.jerseyName} added.`);
}

/** Update a person. ADMIN_ROLES. */
export async function updatePerson(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const personId = str(fd, "personId");
  if (!personId) return fail("Missing person.");
  const parsed = readFields(fd);
  if ("error" in parsed) return fail(parsed.error);

  let updated;
  try {
    updated = await db
      .update(people)
      .set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(people.id, personId), eq(people.tenantId, ctx.tenant.id)))
      .returning({ id: people.id });
  } catch (err) {
    const dupe = identityConflict(err);
    if (dupe) return fail(dupe);
    throw err;
  }
  if (updated.length === 0) return fail("Unknown person.");

  const roles = readRoles(fd);
  await syncRoles(personId, ctx.tenant.id, roles);

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "person.update",
    entityType: "person",
    entityId: personId,
    summary: `Updated ${parsed.jerseyName}`,
    metadata: { roles },
  });
  revalidatePath(`/t/${tenantSlug}/people`);
  revalidatePath(`/t/${tenantSlug}/people/${personId}`);
  return ok("Saved.");
}

/**
 * Soft-delete a person. Refused while anything still references them: removing
 * someone mid-competition would leave a roster row or a signed scoresheet
 * pointing at nothing. The message names what is holding them.
 */
export async function deletePerson(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const personId = str(fd, "personId");
  if (!personId) return fail("Missing person.");

  const usage = await personUsage(ctx.tenant.id, personId);
  if (usage.inUse) {
    const bits = [
      usage.rosters.length && `${usage.rosters.length} roster spot(s)`,
      usage.officials.length && `${usage.officials.length} match official slot(s)`,
      usage.staff.length && `${usage.staff.length} staff assignment(s)`,
    ].filter(Boolean);
    return fail(
      `Still referenced by ${bits.join(", ")}. Remove those first — deleting would leave records pointing at nobody.`,
    );
  }

  const deleted = await db
    .update(people)
    .set({ deletedAt: new Date() })
    .where(and(eq(people.id, personId), eq(people.tenantId, ctx.tenant.id)))
    .returning({ name: people.jerseyName });
  if (deleted.length === 0) return fail("Unknown person.");

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "person.delete",
    entityType: "person",
    entityId: personId,
    summary: `Deleted ${deleted[0].name}`,
  });
  revalidatePath(`/t/${tenantSlug}/people`);
  return ok(`${deleted[0].name} deleted.`);
}

/**
 * Fold `sourceId` into `targetId` so one human is one row (spec/25 §5).
 *
 * This is the operation that makes "one person, one line" reachable, because
 * duplicates are inevitable: names collide, imports arrive without identity
 * keys, and the backfill deliberately created one person per roster row rather
 * than guessing. VIS ships the same operation (MovePlayerReferences) for the
 * same reason.
 *
 * Three rules that matter more than the mechanics:
 *
 *  - **Printed history is never rewritten.** match_officials keeps its own
 *    name/country/level snapshot of what was on the sheet at match time; the
 *    merge repoints the person link and leaves the snapshot untouched, so a
 *    scoresheet that was signed last season still reads exactly as it did.
 *  - **A merge that would violate roster uniqueness is refused, not forced.**
 *    If both people sit on the same team, merging would put one person on that
 *    roster twice. Silently dropping one of the rows would lose a jersey number
 *    and possibly a captain flag, so the admin is told to resolve it first.
 *  - **Roles are unioned.** A player record merged with a referee record yields
 *    someone who is both, which is exactly the transition being modelled.
 *
 * The source is soft-deleted rather than removed: audit rows and any external
 * reference to its id stay resolvable.
 */
export async function mergePeople(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const sourceId = str(fd, "sourceId");
  const targetId = str(fd, "targetId");
  if (!sourceId || !targetId) return fail("Pick a person to merge.");
  if (sourceId === targetId) return fail("That is the same person.");

  // Both must belong to the acting tenant — never trust posted ids.
  const rows = await db
    .select({ id: people.id, name: people.jerseyName })
    .from(people)
    .where(
      and(
        eq(people.tenantId, ctx.tenant.id),
        inArray(people.id, [sourceId, targetId]),
      ),
    );
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);
  if (!source || !target) return fail("Unknown person.");

  // Refuse a merge that would put one person on the same team twice.
  const clash = await db
    .select({ teamId: players.teamId })
    .from(players)
    .where(and(eq(players.personId, sourceId), eq(players.tenantId, ctx.tenant.id)));
  if (clash.length > 0) {
    const targetTeams = new Set(
      (
        await db
          .select({ teamId: players.teamId })
          .from(players)
          .where(
            and(eq(players.personId, targetId), eq(players.tenantId, ctx.tenant.id)),
          )
      ).map((r) => r.teamId),
    );
    const overlap = clash.filter((c) => targetTeams.has(c.teamId));
    if (overlap.length > 0)
      return fail(
        `Both records are on the same team (${overlap.length} roster spot(s)). Remove one of those roster entries first — merging would put the same person on that roster twice, and one jersey number would be lost.`,
      );
  }

  let moved = { rosters: 0, officials: 0, staff: 0, roles: 0 };
  await dbTx.transaction(async (tx) => {
    const r1 = await tx
      .update(players)
      .set({ personId: targetId })
      .where(eq(players.personId, sourceId))
      .returning({ id: players.id });
    // Officials keep their printed snapshot; only the link moves.
    const r2 = await tx
      .update(matchOfficials)
      .set({ personId: targetId })
      .where(eq(matchOfficials.personId, sourceId))
      .returning({ id: matchOfficials.id });
    const r3 = await tx
      .update(teamStaff)
      .set({ personId: targetId })
      .where(eq(teamStaff.personId, sourceId))
      .returning({ id: teamStaff.id });

    // Union the roles, then drop the source's own rows.
    const srcRoles = await tx
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, sourceId));
    for (const { role } of srcRoles) {
      await tx
        .insert(personRoles)
        .values({
          id: newId("prole"),
          personId: targetId,
          tenantId: ctx.tenant.id,
          role,
        })
        .onConflictDoNothing();
    }
    await tx.delete(personRoles).where(eq(personRoles.personId, sourceId));

    // Free the identity keys before soft-deleting, so the unique-when-present
    // indexes don't keep a dead row reserving an email or a VIS number.
    await tx
      .update(people)
      .set({
        email: null,
        visPersonNo: null,
        userId: null,
        deletedAt: new Date(),
        notes: `Merged into ${targetId} on ${new Date().toISOString().slice(0, 10)}`,
      })
      .where(eq(people.id, sourceId));

    moved = {
      rosters: r1.length,
      officials: r2.length,
      staff: r3.length,
      roles: srcRoles.length,
    };
  });

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "person.merge",
    entityType: "person",
    entityId: targetId,
    summary: `Merged ${source.name} into ${target.name}`,
    metadata: { sourceId, targetId, moved },
  });

  revalidatePath(`/t/${tenantSlug}/people`);
  revalidatePath(`/t/${tenantSlug}/people/${targetId}`);
  return ok(
    `Merged ${source.name} into ${target.name} — moved ${moved.rosters} roster spot(s), ${moved.officials} officials slot(s), ${moved.staff} staff assignment(s).`,
  );
}

/**
 * Assign (or clear) a team staff function. Used by the roster page's staff
 * panel — this is what finally fills the coach box on the official scoresheets
 * (spec/21 gap G4).
 */
export async function setTeamStaff(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const teamId = str(fd, "teamId");
  const fn = str(fd, "function");
  const personId = str(fd, "personId");
  if (!teamId) return fail("Missing team.");
  if (!(STAFF_FUNCTIONS as readonly string[]).includes(fn))
    return fail("Unknown staff function.");

  // Empty person = clear the slot.
  if (!personId) {
    await db
      .delete(teamStaff)
      .where(
        and(
          eq(teamStaff.teamId, teamId),
          eq(teamStaff.function, fn as StaffFunction),
          eq(teamStaff.tenantId, ctx.tenant.id),
        ),
      );
    revalidatePath(`/t/${tenantSlug}`, "layout");
    return ok("Cleared.");
  }

  // The person must belong to this tenant — never trust the posted id.
  const person = (
    await db
      .select({ name: people.jerseyName })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.tenantId, ctx.tenant.id)))
      .limit(1)
  )[0];
  if (!person) return fail("Unknown person.");

  await db
    .insert(teamStaff)
    .values({
      id: newId("stf"),
      teamId,
      tenantId: ctx.tenant.id,
      personId,
      function: fn as StaffFunction,
    })
    .onConflictDoUpdate({
      target: [teamStaff.teamId, teamStaff.function],
      set: { personId },
    });

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "team-staff.set",
    entityType: "team",
    entityId: teamId,
    summary: `${fn}: ${person.name}`,
  });
  revalidatePath(`/t/${tenantSlug}`, "layout");
  return ok("Saved.");
}
