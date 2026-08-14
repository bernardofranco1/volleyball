/**
 * How many migrations the RUNNING BUILD carries (spec/28 §7).
 *
 * Deliberately its own module with no database import: /api/version reports
 * this number and must stay thin enough to poll, while releases.ts needs the
 * same number alongside its queries. Both read it here rather than counting the
 * journal twice.
 *
 * The journal ships in the bundle as JSON, so this needs no filesystem access
 * at runtime (the .sql files are not bundled, and don't need to be — we report
 * a count, and CI lints the contents).
 *
 * Note what this is NOT: it is the count baked into *this* deployment, not the
 * count in the repo, and not the count of whatever build is being promoted. The
 * release console asks a candidate for its own figure over /api/version rather
 * than assuming its own is the same — the console is frequently an older build
 * than the one being shipped, which is exactly when the difference matters.
 */
import journal from "@/db/migrations/meta/_journal.json";

export const MIGRATIONS_IN_REPO = journal.entries.length;
