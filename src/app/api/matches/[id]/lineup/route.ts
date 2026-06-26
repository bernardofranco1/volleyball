// Team-tablet lineup submission (LINEUP_CONFIRMED). Token-gated, not user-gated:
// the tablet proves it speaks for a team via its match_sessions token.
import type { NextRequest } from "next/server";
import {
  EventRejectedError,
  MatchNotFoundError,
  UnsupportedDisciplineError,
  appendMatchEvent,
} from "@/lib/match-engine";
import { validateTabletToken } from "@/lib/match-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    team?: "A" | "B";
    setNumber?: number;
    playerIds?: string[];
    liberoId?: string | null;
    secondLiberoId?: string | null;
  } | null;
  if (!body || (body.team !== "A" && body.team !== "B"))
    return Response.json({ error: "Bad request" }, { status: 400 });

  const session = await validateTabletToken(body.token, id, body.team);
  if (!session)
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  if (!Array.isArray(body.playerIds) || body.playerIds.length === 0)
    return Response.json({ error: "Lineup is required" }, { status: 400 });

  try {
    const { state } = await appendMatchEvent(
      id,
      {
        type: "LINEUP_CONFIRMED",
        team: body.team,
        setNumber: body.setNumber ?? 1,
        playerIds: body.playerIds,
        liberoId: body.liberoId ?? null,
        secondLiberoId: body.secondLiberoId ?? null,
      },
      { actor: body.team === "A" ? "TEAM_A" : "TEAM_B" },
    );
    return Response.json({ ok: true, state });
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof UnsupportedDisciplineError)
      return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof EventRejectedError)
      return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
