/**
 * Product-level switches for capabilities the code supports but the product
 * does not currently offer. Distinct from `tournament_config`, which an
 * organiser sets per competition — these are decided here, for everyone.
 */

/**
 * Video Challenge System request buttons (indoor scorer console, team tablets)
 * and the per-competition VCS settings. The engines implement VCS and the
 * event log, official scoresheets and VSR feed all read it, but the operating
 * flow around it was never finished — no review screen, no referee protocol —
 * and no competition uses it. Set to true to bring every surface back; nothing
 * else has to change.
 *
 * This hides the way IN, not the engine: a set already parked in VCS_ACTIVE
 * (an older log, or a tablet request approved before this switch) must still be
 * resolvable, so the scorer's upheld/rejected banner stays visible regardless.
 */
export const VCS_UI_ENABLED: boolean = false;
