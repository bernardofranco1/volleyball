// TEMPORARY deploy diagnostic (deploy debug). Gated by ?k=. Reports the REAL DB
// error cause, an explicit-SSL connection test, and an HTTPS-egress/key test to
// Supabase. Remove after the deploy is confirmed healthy.
import postgres from "postgres";
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

  // 1) Default app DB client (postgres-js, prepare:false, no explicit ssl).
  const dbDefault: Record<string, unknown> = { ok: false };
  try {
    await db.execute(sql`select 1`);
    dbDefault.ok = true;
  } catch (e: unknown) {
    const err = e as {
      message?: string;
      code?: string;
      cause?: { message?: string; code?: string; errno?: number };
    };
    dbDefault.error = String(err?.message ?? e).slice(0, 150);
    dbDefault.cause = err?.cause
      ? String(err.cause.message ?? err.cause).slice(0, 250)
      : null;
    dbDefault.code = err?.cause?.code ?? err?.code ?? null;
    dbDefault.errno = err?.cause?.errno ?? null;
  }

  // 2) Fresh connection WITH explicit SSL (does ssl:'require' fix it?).
  const dbSsl: Record<string, unknown> = { ok: false };
  try {
    const c = postgres(v("DATABASE_URL"), {
      prepare: false,
      ssl: "require",
      max: 1,
      connect_timeout: 8,
      idle_timeout: 2,
    });
    const r = await c`select 1 as ok`;
    dbSsl.ok = r?.[0]?.ok === 1;
    await c.end({ timeout: 2 });
  } catch (e: unknown) {
    const err = e as {
      message?: string;
      code?: string;
      cause?: { message?: string; code?: string };
    };
    dbSsl.error = String(err?.cause?.message ?? err?.message ?? e).slice(0, 250);
    dbSsl.code = err?.cause?.code ?? err?.code ?? null;
  }

  // 3) HTTPS egress + anon-key test against Supabase Auth.
  const rest: Record<string, unknown> = {};
  try {
    const r = await fetch(`${v("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/health`, {
      headers: { apikey: v("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
    });
    rest.status = r.status;
    rest.body = (await r.text()).slice(0, 150);
  } catch (e: unknown) {
    rest.error = String((e as { message?: string })?.message ?? e).slice(0, 150);
  }

  return Response.json(
    {
      databaseUrl: {
        len: v("DATABASE_URL").length,
        hasPct25: v("DATABASE_URL").includes("%25"),
        endpoint: v("DATABASE_URL")
          .replace(/^postgres[a-z]*:\/\/[^@]*@/, "")
          .slice(0, 80),
      },
      dbDefault,
      dbSsl,
      supabaseAuthFetch: rest,
      vercelRegion: process.env.VERCEL_REGION ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
