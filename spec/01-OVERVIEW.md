# 01 — Overview

## Vision

A white-label volleyball scoring SaaS that any federation, club, or event organizer can deploy as their own branded product. Supports all four FIVB-family disciplines with a shared architecture but discipline-specific rule engines, UIs, and court art.

## Disciplines

### Beach Volleyball
- FIVB Official Beach Volleyball Rules 2025-2028
- 2v2, sand court 16×8 m, best of 3 sets (21/21/15)
- No rotation (service order alternates on side-out)
- No substitutions
- Technical Time-Out at sum=21 in sets 1&2 (FIVB/official competitions only — configurable)
- 1 timeout/set, 30 s
- Serve within 5 s
- Block counts as team hit (2 remaining hits)
- Attack: no overhand open-hand spike; no attack hit on opponent's service if ball entirely above net
- Court switches every 7 pts (sets 1&2), every 5 pts (set 3)
- Team names: "First1 Last1 / First2 Last2"
- VCS optional

### Indoor Volleyball
- FIVB Official Volleyball Rules 2025-2028
- 6v6, hardcourt 18×9 m, best of 5 sets (25/25/25/25/15)
- Full rotation, positional faults enforced
- Libero: 1–2 per team; unlimited replacements (1 rally between); can't serve/block/attack above net
- 6 substitutions/set
- 2 timeouts/set, 30 s
- Serve within 8 s (serve clock shown on screen — important for official matches)
- Block does NOT count as team hit (3 hits still available)
- Back-row attack restrictions; front-zone Libero pass restriction
- Court change after each full set; deciding 5th set at 8 pts
- VCS optional (2 challenges/set per team; successful challenge = keep; unsuccessful = lose)
- Team names: club name or country name (e.g., "Brazil", "Luzern VC")
- Team tablets: submit lineup + libero, request interruptions

### Grass Volleyball
- FIVB Beach Volleyball Rules base (adapted)
- 3v3 (default) or 4v4 — configurable
- Sand-like side switches (every 7 pts / every 5 pts in set 3)
- Full rotation, lineup confirmation per set
- 2 timeouts/set, 4 subs/set
- No Libero, no TTO
- Block counts as team hit (same as beach)
- Serve within 5 s
- Team names: custom name (e.g., "Lausanne A")

### Light Volleyball
- Official Light Volleyball Competition Rules 2022-2025
- 4v4 or 5v5 — configurable; court 12×6 m
- Full rotation (4-player: positions 1–4; 5-player: positions 1–5)
- Best of 3 sets (21/21/15)
- 2 timeouts/set, 30 s
- 4 subs/set (4-player) or 5 subs/set (5-player)
- No Libero, no TTO
- Block does NOT count as team hit (3 hits available)
- Serve within 8 s; jump-serve restriction line 1 m behind end line
- Front-zone attack: ball path must be higher than hit point (upward arc required)
- Attack line 2 m from center (vs 3 m indoor)
- Court changes: after set 1 only; deciding set side-change at 8 pts
- Set intervals: 2 min after set 1, 3 min before deciding set
- Team names: custom name (e.g., "Vevey Masters")

## Deployment model

**Multi-tenant SaaS** on Vercel + Neon PostgreSQL.

Each **tenant** is an organization (federation, club, event organizer). Tenants are fully isolated at the database level via `tenantId` foreign keys on all tables. Row-level access is enforced in API routes and server actions.

Tenant admin sets up competitions, invites scorers, and configures branding (logo, primary color). The app renders each tenant's branding dynamically — no per-tenant deployment needed.

### URL structure
```
app.volleyball-platform.com          — marketing/login
app.volleyball-platform.com/t/[slug] — tenant dashboard
app.volleyball-platform.com/t/[slug]/competitions/[id]/matches/[id]/live
app.volleyball-platform.com/t/[slug]/scoreboard/[matchId] — public display
```

Or custom domain per tenant (Vercel subdomain routing):
```
scores.fivb.com → mapped to tenant "fivb"
```

## User roles

| Role | Scope | Permissions |
|------|-------|-------------|
| `PLATFORM_ADMIN` | Global | Manage tenants, billing |
| `TENANT_ADMIN` | Tenant | Manage competitions, users, branding |
| `COMPETITION_ADMIN` | Competition | Create/edit teams, matches, schedule |
| `SCORER` | Match | Score the match, confirm events |
| `TEAM_SCORER` | Match + team | Submit lineup, request TO/sub/challenge (team tablet) |
| `VIEWER` | Match | Read-only (used for scoreboard display) |

## Branding (white-label)

Per-tenant configuration stored in `tenant_branding`:
- `logoUrl` — shown in header, PDF export
- `primaryColor` — button accent, score highlights
- `secondaryColor`
- `fontFamily` — optional custom Google Font
- `courtColorOverrides` — JSON: override court art colors per discipline

Court art is discipline-specific SVG that reacts to the tenant's `primaryColor` and `courtColorOverrides`:
- Beach: sand/wave texture
- Grass: grass gradient
- Indoor: hardwood floor lines
- Light VB: lighter indoor court
