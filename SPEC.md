# Volleyball Scoring Platform — Master Spec

White-label multi-discipline volleyball scoring SaaS. Four disciplines supported: **Beach**, **Indoor**, **Grass**, **Light Volleyball**. Multi-tenant, full officiating, real-time multi-device, Vercel deployment.

## Spec index

| File | Contents |
|------|----------|
| [spec/00-INFRASTRUCTURE.md](spec/00-INFRASTRUCTURE.md) | Hosting, DB, auth, real-time — free tier vs production vs scale |
| [spec/01-OVERVIEW.md](spec/01-OVERVIEW.md) | Vision, disciplines at a glance, deployment model |
| [spec/02-ARCHITECTURE.md](spec/02-ARCHITECTURE.md) | Tech stack, event-sourcing pattern, folder structure |
| [spec/03-DATABASE.md](spec/03-DATABASE.md) | Full Drizzle + Supabase PostgreSQL schema |
| [spec/04-ENGINE-BEACH.md](spec/04-ENGINE-BEACH.md) | Beach volleyball engine (events, state, rules) |
| [spec/05-ENGINE-INDOOR.md](spec/05-ENGINE-INDOOR.md) | Indoor volleyball engine (libero, rotation, VCS) |
| [spec/06-ENGINE-GRASS.md](spec/06-ENGINE-GRASS.md) | Grass volleyball engine |
| [spec/07-ENGINE-LIGHT.md](spec/07-ENGINE-LIGHT.md) | Light volleyball engine (4-player and 5-player) |
| [spec/08-UI.md](spec/08-UI.md) | UI system, court art, scoreboard, white-label |
| [spec/09-REALTIME.md](spec/09-REALTIME.md) | Multi-device sync, team tablets, serve clock |
| [spec/10-COMPETITION.md](spec/10-COMPETITION.md) | Tournament management (brackets, standings) |
| [spec/11-CONFIG.md](spec/11-CONFIG.md) | Complete per-discipline configuration reference |
| [spec/12-BUILD-ORDER.md](spec/12-BUILD-ORDER.md) | Phased implementation plan |
| [spec/13-SEED-DATA.md](spec/13-SEED-DATA.md) | First-deployment seed data (4 competitions, 8 matches) |

## Quick discipline reference

| | Beach | Indoor | Grass | Light VB |
|---|---|---|---|---|
| Players/side | 2 | 6 | 3–4 | 4–5 |
| Sets | Best of 3 | Best of 5 | Best of 3 | Best of 3 |
| Set score | 21/15 | 25/15 | 21/15 | 21/15 |
| Service time | 5 s | 8 s | 5 s | 8 s |
| Timeouts/set | 1 | 2 | 2 | 2 |
| TTO | Yes (FIVB) | No | No | No |
| Subs/set | 0 | 6 | 4 | 4–5 |
| Libero | No | Yes (1–2) | No | No |
| Block = team hit | Yes | No | Yes | No |
| Rotation | No | Yes | Yes | Yes |
| Court (m) | 16×8 | 18×9 | 16×8 | 12×6 |
| VCS | Optional | Optional | No | No |
| Team name style | Player names | Club/country | Custom | Custom |

## Key decisions (answers from product owner)

- **Scoring depth**: Full officiating for all disciplines. Rotation, lineup, substitutions, libero tracking all enforced. Each feature can be turned off per competition via config.
- **Multi-device**: Scorer tablet (main), team tablets (indoor + optionally others), public scoreboard display (read-only).
- **Team tablets (indoor)**: Each team has a tablet. Can submit starting lineup, designate libero, request timeout/substitution/challenge. Scorer screen can do the same.
- **VCS**: Supported, on/off per competition.
- **Stats**: None (beyond score, rotation, sub counts, TTO, serve clock).
- **Tournament**: Full (pools + knockout + standings).
- **Branding**: White-label. Each discipline has a court-art identifier (sand, grass, hardwood, indoor-light). Each competition/tenant can set logo and colors.
- **Deployment**: Multi-tenant SaaS on Vercel + Supabase (PostgreSQL + Auth + Realtime + Storage). See spec/00-INFRASTRUCTURE.md.
- **i18n**: en, fr, de, es, pt.
- **Migration**: No migration from old app. Fresh seed data on first deploy.
