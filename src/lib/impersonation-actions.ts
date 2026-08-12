"use server";

// "Sign in as…" start/stop (spec/26 §6). Global admins only; the overlay is a
// cookie read by getCurrentUser, never a Supabase session swap.
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  getImpersonation,
  getRealUser,
  isGlobalAdmin,
  requireGlobalAdmin,
} from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  clearImpersonationCookie,
  setImpersonationCookie,
} from "@/lib/impersonation";
import { postLoginDestination } from "@/lib/login-destination";
import { fail, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";

/**
 * Begin impersonating `userId`. Lands wherever a fresh login as that user
 * would (console is impossible — global admins can't be targets — so it is a
 * tenant dashboard, the picker, or the tenantless landing).
 */
export async function startImpersonation(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user: actor } = await requireGlobalAdmin();
  const userId = str(fd, "userId");
  if (!userId) return fail("Missing user.");
  if (userId === actor.id) return fail("You are already signed in as yourself.");
  // requireGlobalAdmin resolves the EFFECTIVE user, so an already-active
  // overlay would have 404'd this action for a non-admin target. Belt and
  // braces for an admin-on-admin cookie: never stack sessions.
  if (await getImpersonation())
    return fail("Already signed in as someone else — exit that session first.");

  const target = (
    await db
      .select({
        id: users.id,
        email: users.email,
        isGlobalAdmin: users.isGlobalAdmin,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!target) return fail("Unknown user.");
  // Impersonating another global admin would be a lateral move between equals
  // with the actor's name hidden behind it — refuse, and keep /admin honest.
  if (target.isGlobalAdmin)
    return fail("Global admins can't be impersonated. Revoke the flag first.");

  const { expiresAt } = await setImpersonationCookie(actor.id, target.id);

  await recordAudit({
    tenantId: null,
    actor: { userId: actor.id, email: actor.email },
    action: "admin.impersonate.start",
    entityType: "user",
    entityId: target.id,
    summary: `${actor.email ?? actor.id} started signing in as ${target.email}`,
    metadata: { targetEmail: target.email, expiresAt },
  });

  // redirect() throws NEXT_REDIRECT — must sit outside any try/catch.
  redirect((await postLoginDestination(target.id)) ?? "/");
}

/**
 * End the impersonation session and return to the People console.
 *
 * Deliberately NOT gated on requireGlobalAdmin: that resolves the effective
 * (impersonated) user and would 404 the very action that gets you out. The
 * real session plus a valid overlay is the authorization here.
 */
export async function stopImpersonation(): Promise<void> {
  const imp = await getImpersonation();
  const real = await getRealUser();
  await clearImpersonationCookie();

  if (imp) {
    await recordAudit({
      tenantId: null,
      actor: { userId: imp.actor.id, email: imp.actor.email },
      action: "admin.impersonate.stop",
      entityType: "user",
      entityId: imp.target.id,
      summary: `${imp.actor.email ?? imp.actor.id} stopped signing in as ${imp.target.email}`,
      metadata: { targetEmail: imp.target.email },
    });
  }

  // A stale/expired cookie leaves no overlay to audit; still clear it and send
  // the admin somewhere sensible (the console if they can see it, else home).
  const backToConsole = real ? await isGlobalAdmin(real.id) : false;
  redirect(backToConsole ? "/admin/access" : "/");
}
