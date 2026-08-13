# Which tables am I about to write to?

`.env.local` points at **`DB_SCHEMA=homolog`** — the homologation clone, not
production. That is deliberate (spec/28): dev and production share one Supabase
database, and this is what keeps local experiments off the production tables.

**Therefore: any script that is meant to touch PRODUCTION must say so.**

```bash
DB_SCHEMA=public npx tsx --env-file=.env.local scripts/<script>.ts
```

Forgetting the prefix writes to the clone — annoying, never dangerous, and
undone by `npm run db:clone:homolog -- --execute`. The reverse mistake is the
one that hurts, which is why the default is the safe direction.

Migrations refuse to guess: `npm run db:migrate:homolog` or
`npm run db:migrate:prod`, never a bare `db:migrate`.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
