// TEMPORARY deploy diagnostic (Phase 11 / deploy debug). Gated by ?k=. Reports
// what the running function actually sees for the critical env vars (presence +
// length + non-secret fingerprints) and the REAL database error. Remove after
// the deploy is confirmed healthy.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = "diag-k7m2p9";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== TOKEN) {
    return new Response("not found", { status: 404 });
  }

  const v = (name: string) => process.env[name] ?? "";
  const info = (name: string) => {
    const s = v(name);
    return { set: s.length > 0, len: s.length };
  };

  let dbOk = false;
  let dbError: string | null = null;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    dbError = `${err?.code ?? ""} ${err?.message ?? String(e)}`.trim().slice(0, 400);
  }

  const dbu = v("DATABASE_URL");
  return Response.json(
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
      anonKey: { ...info("NEXT_PUBLIC_SUPABASE_ANON_KEY"), tail: v("NEXT_PUBLIC_SUPABASE_ANON_KEY").slice(-6) },
      serviceKey: { ...info("SUPABASE_SERVICE_ROLE_KEY"), prefix: v("SUPABASE_SERVICE_ROLE_KEY").slice(0, 10) },
      databaseUrl: {
        ...info("DATABASE_URL"),
        endpoint: dbu.replace(/^postgres[a-z]*:\/\/[^@]*@/, "").slice(0, 80),
        hasPct25: dbu.includes("%25"),
        port6543: dbu.includes(":6543"),
      },
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
      db: { ok: dbOk, error: dbError },
      vercelRegion: process.env.VERCEL_REGION ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
