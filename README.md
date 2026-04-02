## NCAAM Web App

Two-tab app:
- `/cards` (Player Profiles)
- `/roster` (Roster Construction)

It uses:
- Vercel for hosting
- Supabase Postgres for job + payload storage
- Upstash Redis for hot cache
- Cloudflare R2 as the planned object-storage target for larger generated assets

## Local Dev

Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required Environment Variables

- `SUPABASE_DB_URL` (preferred Postgres connection string)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `REDIS_URL` (Upstash REST URL)
- `REDIS_TOKEN` (Upstash token)
- `NEXT_PUBLIC_APP_NAME` (display name)

See [`.env.example`](./.env.example) for the full local template, including the planned R2 variables.
If you want a no-local-secrets workflow, keep those values only in Vercel and Supabase/Cloudflare dashboards.

## Database Setup (Supabase)

The source of truth is now the Supabase migration in [supabase/migrations/20260402120000_initial_schema.sql](./supabase/migrations/20260402120000_initial_schema.sql).

Tables created:
- `jobs`
- `card_payloads`
- `roster_payloads`
- `site_telemetry_events`

Legacy reference SQL remains in [sql/schema.sql](./sql/schema.sql).

## Migration Notes

- Supabase MCP is connected to project `tcvbnbhbggplcrkdwlbd`.
- The app accepts `SUPABASE_DB_URL`, `DIRECT_DATABASE_URL`, or legacy `DATABASE_URL`.
- Cloudflare R2 is the planned home for larger generated payload artifacts; Postgres remains the source of truth for metadata and lookup tables in the first cut.
- Large payloads can now be offloaded to R2 automatically when the R2 env vars are present and the JSON exceeds `R2_PAYLOAD_INLINE_LIMIT_BYTES`.
- A dry-run backfill script is available via `npm run backfill:r2`.

Detailed rollout notes live in [docs/migration-plan.md](./docs/migration-plan.md).
Deployment env setup notes live in [docs/deployment-envs.md](./docs/deployment-envs.md).

## API Routes

- `POST /api/jobs/start` starts a job (`card` or `roster`)
- `GET /api/jobs/:id` polls progress/result

The UI polls job status and renders a progress bar until complete.

## Deploy

Push to `main`; Vercel auto-deploys.
