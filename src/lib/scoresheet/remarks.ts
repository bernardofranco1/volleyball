/**
 * Standardized REMARKS lines for the official scoresheets (spec/29 Phase 4).
 *
 * The sheet's REMARKS block is where everything the pre-printed grid has no
 * cell for gets written down: an exceptional substitution, a recovery, a libero
 * re-designation, a defaulted set, a fault correction, a protest. On paper the
 * scorer writes those by hand; here they are COMPOSED FROM THE LOG, which keeps
 * the rule the whole scoresheet layer rests on — the sheet is a deterministic
 * rendering of the event log, never a second place where facts are entered.
 *
 * Every line follows one shape so a referee can scan the block:
 *
 *     Set {n} — {what}, {score}[ — {detail}]
 *
 * Free-text NOTE events keep their own voice and are passed through untouched;
 * they are the scorer's remarks, not ours.
 *
 * Pure and dependency-free so both renderers and the tests can use it.
 */
import type { TeamId } from "@/engine/types";
import { forfeitReasonLabel } from "@/lib/domain";

export interface RemarkContext {
  setNumber: number;
  score: { a: number; b: number };
  /** Team the remark is about, when it is about one. */
  team?: TeamId;
  /** Jersey number or bench-official function letter, when about a person. */
  member?: string | null;
  /** Person's name, when known and worth printing. */
  name?: string | null;
}

/** `12 Smith`, `C1 Rossi`, `Smith`, or "" — whatever we actually know. */
function who(ctx: RemarkContext): string {
  return [ctx.member, ctx.name].filter(Boolean).join(" ");
}

function line(ctx: RemarkContext, what: string, detail?: string): string {
  const head = `Set ${ctx.setNumber} — ${what}, ${ctx.score.a}:${ctx.score.b}`;
  const bits = [detail, ctx.team ? `team ${ctx.team}` : null].filter(Boolean);
  return bits.length > 0 ? `${head} (${bits.join("; ")})` : head;
}

export const remark = {
  /** Rule 15.7: injury replacement with no legal substitution left. */
  exceptionalSubstitution(ctx: RemarkContext, incoming?: string | null): string {
    return line(
      ctx,
      "exceptional substitution",
      [who(ctx) ? `out ${who(ctx)}` : null, incoming ? `in ${incoming}` : null]
        .filter(Boolean)
        .join(", ") || undefined,
    );
  },

  /** A substitution forced by an expulsion — recorded as its own fact. */
  forcedSubstitution(ctx: RemarkContext): string {
    return line(ctx, "substitution forced by expulsion", who(ctx) || undefined);
  },

  /** Medical recovery, with the player when identified (F11). */
  recovery(ctx: RemarkContext, nth?: number): string {
    return line(
      ctx,
      "medical recovery",
      [who(ctx) || null, nth && nth > 1 ? `#${nth} for this player` : null]
        .filter(Boolean)
        .join("; ") || undefined,
    );
  },

  /** Rule 19.4.2: a new libero designated for the rest of the match (F10). */
  liberoRedesignation(ctx: RemarkContext, newLibero?: string | null): string {
    return line(
      ctx,
      "libero re-designated",
      newLibero ? `new libero ${newLibero}` : undefined,
    );
  },

  /** The libero declared unable to play (F10). */
  liberoUnableToPlay(ctx: RemarkContext): string {
    return line(ctx, "libero unable to play", who(ctx) || undefined);
  },

  /** One set awarded for an incomplete team (F14). */
  setDefault(ctx: RemarkContext): string {
    const to = ctx.team === "A" ? "B" : "A";
    return line(ctx, "team incomplete — set awarded", `to team ${to}`);
  },

  /** Rotation / service-order fault (F13). */
  positionalFault(ctx: RemarkContext, kind: "ROTATION" | "SERVICE_ORDER"): string {
    return line(
      ctx,
      kind === "ROTATION" ? "rotation fault" : "service order fault",
      who(ctx) || undefined,
    );
  },

  /** Points cancelled after a late-discovered fault (F13). */
  faultCorrection(ctx: RemarkContext, cancelled: number, reason?: string | null): string {
    return line(
      ctx,
      "fault correction",
      [`${cancelled} point(s) cancelled`, reason?.trim() || null]
        .filter(Boolean)
        .join("; "),
    );
  },

  /** In-match protest lodged (F12) — distinct from the result-stage PROTEST. */
  protest(ctx: RemarkContext, text?: string | null): string {
    return line(
      ctx,
      "protest lodged",
      [who(ctx) || null, text?.trim() || null].filter(Boolean).join("; ") ||
        undefined,
    );
  },

  /** Forfeit / retirement (F8) — the match-level version. */
  forfeit(ctx: RemarkContext, reason: string): string {
    return line(
      ctx,
      forfeitReasonLabel(reason).toLowerCase(),
      undefined,
    );
  },
};
