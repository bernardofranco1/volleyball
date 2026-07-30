// Subdomain → tenant slug resolution for the edge Proxy (spec/23 §6.2).
// The proxy can't touch the DB, so it fetches this Node route; the CDN cache
// header keeps steady-state traffic off the database. Public by design: it
// reveals only that a subdomain maps to a slug — both already public facts.
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { isValidSubdomain } from "@/lib/subdomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sub = req.nextUrl.searchParams.get("subdomain")?.toLowerCase() ?? "";
  if (!isValidSubdomain(sub)) {
    return Response.json(
      { slug: null },
      { headers: { "Cache-Control": "public, s-maxage=300" } },
    );
  }
  const row = (
    await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(and(eq(tenants.subdomain, sub), isNull(tenants.deletedAt)))
      .limit(1)
  )[0];
  return Response.json(
    { slug: row?.slug ?? null },
    {
      headers: {
        // 5 min CDN + SWR: a subdomain change propagates within minutes, and
        // the proxy's in-memory memo (60 s) smooths the rest.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    },
  );
}
