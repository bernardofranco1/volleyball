/**
 * Provision (or remove) a throwaway TENANT_ADMIN for driving the real UI in a
 * browser during QA.
 *
 * Dev and production share one Supabase database (see the shared-DB hazard in
 * the project notes), so this deliberately creates ONE clearly-named account
 * and prints the exact command to remove it again. Never leave it behind.
 *
 *   npx tsx --env-file=.env.local scripts/qa-temp-admin.ts create
 *   npx tsx --env-file=.env.local scripts/qa-temp-admin.ts destroy
 */
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userTenantRoles, users, tenants } from "@/db/schema";
import { newId } from "@/lib/id";

const EMAIL = "qa-console-review@volleyball-demo.app";
const PASSWORD = "QaConsoleReview!2026";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function findAuthUser(): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === EMAIL)?.id ?? null;
}

async function create() {
  let id = await findAuthUser();
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    id = data.user.id;
  }
  await db
    .insert(users)
    .values({ id, email: EMAIL, name: "QA console review" })
    .onConflictDoNothing();

  const all = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants);
  for (const tn of all) {
    await db
      .insert(userTenantRoles)
      .values({
        id: newId("utr"),
        userId: id,
        tenantId: tn.id,
        role: "TENANT_ADMIN",
      })
      .onConflictDoNothing();
  }
  console.log(JSON.stringify({ id, email: EMAIL, password: PASSWORD, tenants: all }));
}

async function destroy() {
  const id = await findAuthUser();
  if (id) {
    await db.delete(userTenantRoles).where(eq(userTenantRoles.userId, id));
    await db.delete(users).where(eq(users.id, id));
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  console.log(JSON.stringify({ removed: id ?? null }));
}

// No top-level await: tsx transforms these scripts to CJS, where it is a
// syntax error (the same trap that broke db:migrate).
async function main() {
  await (process.argv[2] === "destroy" ? destroy() : create());
  process.exit(0);
}
void main();
