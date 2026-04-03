create table if not exists public.player_payload_index (
  gender text not null check (gender in ('men', 'women')),
  season int not null,
  team text not null,
  player text not null,
  cache_key text not null,
  source_hash text not null default '',
  storage_provider text not null check (storage_provider in ('github', 'r2')),
  storage_key text not null,
  public_url text,
  payload_size_bytes int,
  data_version text not null default '',
  updated_at timestamptz not null default now(),
  primary key (gender, season, team, player)
);

create index if not exists idx_player_payload_index_lookup
  on public.player_payload_index (gender, season, team, player);

create index if not exists idx_player_payload_index_cache_key
  on public.player_payload_index (gender, season, cache_key);

create table if not exists public.build_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  gender_scope text not null default 'both',
  season_scope text not null default '',
  status text not null check (status in ('queued', 'running', 'done', 'error')),
  notes text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_build_runs_started_at
  on public.build_runs (started_at desc);

create table if not exists public.build_run_items (
  id bigint generated always as identity primary key,
  build_run_id uuid not null references public.build_runs(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  status text not null check (status in ('queued', 'running', 'done', 'error', 'skipped')),
  duration_ms int,
  error_text text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_build_run_items_run
  on public.build_run_items (build_run_id, status);

alter table public.player_payload_index enable row level security;
alter table public.build_runs enable row level security;
alter table public.build_run_items enable row level security;

revoke all privileges on table public.player_payload_index from anon, authenticated;
revoke all privileges on table public.build_runs from anon, authenticated;
revoke all privileges on table public.build_run_items from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

drop policy if exists "player_payload_index_service_role_select" on public.player_payload_index;
drop policy if exists "player_payload_index_service_role_insert" on public.player_payload_index;
drop policy if exists "player_payload_index_service_role_update" on public.player_payload_index;
drop policy if exists "player_payload_index_service_role_delete" on public.player_payload_index;

create policy "player_payload_index_service_role_select"
on public.player_payload_index
for select
to service_role
using (true);

create policy "player_payload_index_service_role_insert"
on public.player_payload_index
for insert
to service_role
with check (true);

create policy "player_payload_index_service_role_update"
on public.player_payload_index
for update
to service_role
using (true)
with check (true);

create policy "player_payload_index_service_role_delete"
on public.player_payload_index
for delete
to service_role
using (true);

drop policy if exists "build_runs_service_role_select" on public.build_runs;
drop policy if exists "build_runs_service_role_insert" on public.build_runs;
drop policy if exists "build_runs_service_role_update" on public.build_runs;
drop policy if exists "build_runs_service_role_delete" on public.build_runs;

create policy "build_runs_service_role_select"
on public.build_runs
for select
to service_role
using (true);

create policy "build_runs_service_role_insert"
on public.build_runs
for insert
to service_role
with check (true);

create policy "build_runs_service_role_update"
on public.build_runs
for update
to service_role
using (true)
with check (true);

create policy "build_runs_service_role_delete"
on public.build_runs
for delete
to service_role
using (true);

drop policy if exists "build_run_items_service_role_select" on public.build_run_items;
drop policy if exists "build_run_items_service_role_insert" on public.build_run_items;
drop policy if exists "build_run_items_service_role_update" on public.build_run_items;
drop policy if exists "build_run_items_service_role_delete" on public.build_run_items;

create policy "build_run_items_service_role_select"
on public.build_run_items
for select
to service_role
using (true);

create policy "build_run_items_service_role_insert"
on public.build_run_items
for insert
to service_role
with check (true);

create policy "build_run_items_service_role_update"
on public.build_run_items
for update
to service_role
using (true)
with check (true);

create policy "build_run_items_service_role_delete"
on public.build_run_items
for delete
to service_role
using (true);
