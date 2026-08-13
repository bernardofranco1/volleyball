// Match-centre CSV export (spec/27 §B). Tenant-scoped and authenticated —
// unlike the public per-competition results CSV, this crosses competitions and
// includes scheduled matches, so it is gated to the tenant's members.
//
// Two modes, both driven by the same form on the match centre: with `id`
// parameters it exports exactly the ticked rows; without them it exports every
// row matching the current filters, which is what "Export CSV" with nothing
// selected should mean.
import type { NextRequest } from "next/server";
import { getAuthContext, hasRole, VIEW_ROLES } from "@/lib/authz";
import {
  listTenantMatches,
  loadSetScores,
  type MatchStatusFilter,
} from "@/lib/competitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cell(v: string | number | null): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection: a leading =, +, -, @, or control
  // char makes Excel/Sheets evaluate the cell. Team and round names are
  // user-controlled.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_VALUES: MatchStatusFilter[] = [
  "scheduled",
  "live",
  "pending",
  "finished",
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantSlug = sp.get("tenant");
  if (!tenantSlug) return new Response("tenant required", { status: 400 });

  const ctx = await getAuthContext(tenantSlug);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!hasRole(ctx.roles, VIEW_ROLES))
    return new Response("Forbidden", { status: 403 });

  const status = sp.get("status");
  const { rows } = await listTenantMatches(ctx.tenant.id, {
    q: sp.get("q") ?? undefined,
    discipline: sp.get("discipline") ?? undefined,
    competitionId: sp.get("competition") ?? undefined,
    status: STATUS_VALUES.includes(status as MatchStatusFilter)
      ? (status as MatchStatusFilter)
      : undefined,
    order: sp.get("order") === "desc" ? "desc" : "asc",
    paginate: false,
  });

  const picked = new Set(sp.getAll("id"));
  const selected = picked.size > 0 ? rows.filter((m) => picked.has(m.id)) : rows;
  const setScores = await loadSetScores(selected.map((m) => m.id));

  const header = [
    "matchNumber",
    "scheduledAt",
    "competition",
    "discipline",
    "round",
    "court",
    "teamA",
    "teamB",
    "status",
    "setsWonA",
    "setsWonB",
    "setScores",
    "winner",
  ];
  const lines = [header.join(",")];
  for (const m of selected) {
    lines.push(
      [
        m.matchNumber,
        m.scheduledAt ? new Date(m.scheduledAt).toISOString() : "",
        m.competitionName,
        m.discipline,
        m.roundName,
        m.courtNumber,
        m.teamAName,
        m.teamBName,
        m.status,
        m.setsWonA,
        m.setsWonB,
        (setScores.get(m.id) ?? []).map((s) => `${s.a}-${s.b}`).join(" "),
        m.winner === "A" ? m.teamAName : m.winner === "B" ? m.teamBName : "",
      ]
        .map(cell)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${tenantSlug}-matches.csv"`,
      "cache-control": "no-store",
    },
  });
}
