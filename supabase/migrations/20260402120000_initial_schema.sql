create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('card', 'roster')),
  status text not null check (status in ('queued', 'running', 'done', 'error')),
  progress int not null default 0,
  message text not null default '',
  request_json jsonb not null,
  result_json jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_created_at on public.jobs (created_at desc);

create table if not exists public.card_payloads (
  season int not null,
  team text not null,
  player text not null,
  mode text not null default 'draft',
  destination_conference text not null default '',
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (season, team, player, mode, destination_conference)
);

create index if not exists idx_card_payloads_lookup
  on public.card_payloads (season, team, player, mode, destination_conference);

create table if not exists public.roster_payloads (
  season int not null,
  team text not null,
  add_hash text not null,
  remove_hash text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (season, team, add_hash, remove_hash)
);

create index if not exists idx_roster_payloads_lookup
  on public.roster_payloads (season, team, add_hash, remove_hash);

create table if not exists public.site_telemetry_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  path text,
  gender text,
  season int,
  team text,
  player text,
  query_text text,
  source text,
  country text,
  region text,
  city text,
  created_at timestamptz not null default now()
);

create index if not exists idx_site_telemetry_events_created_at
  on public.site_telemetry_events(created_at desc);

create index if not exists idx_site_telemetry_events_type_created
  on public.site_telemetry_events(event_type, created_at desc);
