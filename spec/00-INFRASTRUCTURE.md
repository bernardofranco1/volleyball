# 00 — Infrastructure Plan

## Design principle

**Supabase is the single external backend service** — it covers database, auth, real-time messaging, and file storage. This eliminates the need for Neon, Clerk, Pusher, and a separate blob store. Everything else is either built into Next.js or uses lightweight add-ons.

---

## Free-tier stack (development + staging)

| Service | Role | Free allowance | Cost |
|---------|------|---------------|------|
| **Vercel** (Hobby) | Hosting, CDN, edge functions | 100 GB bandwidth, unlimited deploys | $0 |
| **Supabase** (Free) | PostgreSQL + Auth + Realtime + Storage | 500 MB DB, 1 GB storage, 50k MAU, 2M Realtime messages/mo | $0 |
| **Resend** (Free) | Transactional email (invites, password reset) | 3,000 emails/month | $0 |
| **Sentry** (Free) | Error monitoring | 5,000 errors/month | $0 |
| **GitHub** | Source control, CI | Unlimited public repos | $0 |

**Total: $0/month**

> Supabase free projects pause after 1 week of inactivity. Acceptable for dev/staging — send a single HTTP request to keep alive if needed. Upgrading to Pro removes the pause.

---

## Production stack (~$91/month)

| Service | Plan | Role | Cost |
|---------|------|------|------|
| **Vercel** | Pro | Hosting + CDN + edge functions | $20/month |
| **Supabase** | Pro | PostgreSQL + Auth + Realtime + Storage | $25/month |
| **Resend** | Pro | Email (invites, password reset) | $20/month |
| **Sentry** | Team | Error monitoring + performance | $26/month |

**Total: ~$91/month**

---

## Scale tier (when needed)

No architecture changes required — same stack, larger plans.

| Bottleneck | Solution | Trigger |
|------------|----------|---------|
| DB compute | Supabase Pro → larger compute add-on | >100 concurrent matches |
| Connection pooling | Supabase Pooler (already in use via PgBouncer) | >100 concurrent DB connections |
| Realtime throughput | Supabase Pro → higher Realtime limits | >100 concurrent live matches |
| Edge latency | Vercel Enterprise or add regions | Global multi-region tenants |
| File storage | Supabase Storage scales with Pro plan | >1 GB logos/PDFs |
| Email volume | Resend scale plan | >50k emails/month |

---

## Architecture decisions

### Why Supabase over alternatives?

| Requirement | Supabase | Alternatives |
|-------------|----------|--------------|
| PostgreSQL (relational, event log) | ✓ Built-in | Neon ($0 free, same DB) |
| Auth (email/password, JWT, invites) | ✓ Built-in | Clerk ($25+/mo), Auth.js (self-manage) |
| Real-time (WebSocket push) | ✓ Built-in (Broadcast) | Pusher ($50+/mo at scale), Ably |
| File storage (logos, PDFs) | ✓ Built-in (S3-compatible) | Cloudflare R2 ($0 free), AWS S3 |
| Single dashboard / billing | ✓ | 4 separate services |

Using Supabase saves ~$100+/month at scale vs the Neon + Clerk + Pusher + R2 combination.

### Vercel vs Alternatives

Vercel is the best match for Next.js App Router (zero-config, Edge Runtime, streaming SSR). Alternatives:

- **Cloudflare Pages**: Free, fast edge, but limited Node.js compatibility (PDFKit export requires `runtime = "nodejs"` — Cloudflare Workers don't support it)
- **Railway / Render**: Good for Node.js but require more DevOps; no Edge Runtime
- **Self-hosted (DigitalOcean, Hetzner)**: $5–20/month, requires manual SSL, CI setup, Docker

Vercel is the right choice until revenue justifies infrastructure ownership.

### Database connection

All Next.js routes (including Vercel Edge Functions) connect to Supabase via the **Supabase Pooler** (PgBouncer in Transaction mode, port 6543). This handles connection bursts from serverless functions without exhausting PostgreSQL connection limits.

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

Direct connection (port 5432) is used only for Drizzle Kit migrations (run from dev machine, not in serverless context).

---

## Environment variables

All variables needed across environments:

```bash
# Supabase (all environments)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...      # safe to expose to browser
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # server-only — DO NOT expose to client
DATABASE_URL=postgresql://...             # Supabase pooler (Transaction mode)

# Email
RESEND_API_KEY=re_...

# Error monitoring
NEXT_PUBLIC_SENTRY_DSN=https://...

# App
NEXT_PUBLIC_APP_URL=https://app.volleyball-platform.com
```

---

## CI/CD pipeline

```
GitHub push → Vercel auto-deploy (preview on PR, production on main merge)
                    │
                    ▼
              vercel build
              (next build + type-check)
                    │
                    ▼
              drizzle-kit generate  ← run locally before PRs touching schema
              (apply to Supabase via migration script in pre-deploy hook)
```

Migrations are never run with `drizzle-kit push` in production. Always `generate` → review SQL → apply.

---

## Monitoring

| Concern | Tool | Dashboard |
|---------|------|-----------|
| Errors + stack traces | Sentry | sentry.io |
| Performance (Core Web Vitals) | Vercel Analytics (built-in) | vercel.com/analytics |
| DB query performance | Supabase Dashboard → Query Performance | supabase.com |
| Uptime | Vercel status / UptimeRobot (free) | uptimerobot.com |
| Realtime usage | Supabase Dashboard → Realtime | supabase.com |
