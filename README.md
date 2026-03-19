## NCAAM Web App

Two-tab app:
- `/cards` (Player Profiles)
- `/roster` (Roster Construction)

It uses:
- Vercel for hosting
- Neon Postgres for job + payload storage
- Upstash Redis for hot cache

## Local Dev

Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required Environment Variables

- `DATABASE_URL` (Neon connection string)
- `REDIS_URL` (Upstash REST URL)
- `REDIS_TOKEN` (Upstash token)
- `NEXT_PUBLIC_APP_NAME` (display name)

## Database Setup (Neon)

Run SQL in [sql/schema.sql](./sql/schema.sql).

Tables created:
- `jobs`
- `card_payloads`
- `roster_payloads`

## API Routes

- `POST /api/jobs/start` starts a job (`card` or `roster`)
- `GET /api/jobs/:id` polls progress/result

The UI polls job status and renders a progress bar until complete.

## Deploy

Push to `main`; Vercel auto-deploys.
