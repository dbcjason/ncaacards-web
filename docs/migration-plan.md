# Supabase + R2 Migration Plan

This app currently runs against direct Postgres tables plus Upstash Redis.
The first migration pass moves the database baseline to Supabase and prepares
object storage to live in Cloudflare R2.

## Current status

- Supabase MCP connection is active for project `tcvbnbhbggplcrkdwlbd`.
- The initial Supabase schema now lives in `supabase/migrations/20260402120000_initial_schema.sql`.
- The application accepts `SUPABASE_DB_URL` as its preferred Postgres connection string.
- Cloudflare R2 is not wired into runtime code yet; this pass sets the contract and setup path.

## Phase 1: Database cutover

1. Apply the initial schema migration to Supabase.
2. Set `SUPABASE_DB_URL` in local and Vercel environments.
3. Smoke test `/cards`, `/roster`, and telemetry writes against Supabase.
4. Backfill any existing Neon data into matching Supabase tables if needed.

## Phase 2: Storage cutover

Use R2 for large generated assets or exported payload blobs that do not belong in Postgres rows.

Recommended setup:

- Create one Cloudflare R2 bucket for app assets.
- Create an API token with bucket-scoped read/write access.
- Add the R2 environment variables from `.env.example`.
- Keep metadata and lookup records in Supabase tables.
- Store only object keys or public URLs in Postgres, not large binary payloads.

Suggested naming:

- Bucket: `ncaacards-assets`
- Key prefix: `cards/{season}/{team}/{player}.json`
- Key prefix: `rosters/{season}/{team}/{hash}.json`

Current implementation status:

- `src/lib/object-store.ts` will offload large JSON payloads to R2 automatically when R2 env vars are configured.
- Smaller payloads still stay inline in Postgres for simplicity.
- Existing inline rows can be migrated with `npm run backfill:r2` (`DRY_RUN=true` by default).

## Phase 3: Runtime changes

1. Add an R2 client helper for server-side uploads and reads.
2. Move oversized payloads out of `card_payloads.payload` and `roster_payloads.payload` when beneficial.
3. Keep Redis as hot cache in front of the database/object-store path.
4. Add a small backfill script to copy any existing payload rows into R2 and replace them with pointers.

## Open choices

- Whether to keep payload JSON in Postgres for all rows or only for smaller records.
- Whether R2 objects should be private-with-signed-URL or public-read.
- Whether to migrate jobs onto Supabase Auth/RLS now or keep server-only access first.
