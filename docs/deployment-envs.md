# Deployment Environment Setup

This app is now set up to avoid storing runtime secrets in local `.env.local`.
Use Vercel environment variables as the source of truth.

## Required in Vercel

Add these in the Vercel project settings for `Production`, `Preview`, and `Development` as needed:

- `SUPABASE_DB_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Optional but recommended

- `REDIS_URL`
- `REDIS_TOKEN`

## Required for R2 payload offload

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Optional:

- `R2_PUBLIC_BASE_URL`
- `R2_PAYLOAD_INLINE_LIMIT_BYTES`

## Verify runtime config

After deployment, verify the app sees the expected config at:

- `/api/health/runtime`

This endpoint only returns booleans and safe metadata such as the configured bucket name and inline threshold.
It does not expose connection strings, passwords, or access keys.

## Expected healthy response

- `databaseConfigured: true`
- `supabaseUrlConfigured: true`
- `supabasePublishableKeyConfigured: true`

If Redis is configured:

- `redisConfigured: true`

If R2 is configured:

- `r2Configured: true`

## Local development

If you want to keep secrets off your laptop, do not recreate `.env.local`.
Use deployed environments for real secret-backed verification.
