create table if not exists public.lineup_team_options (
  gender text not null check (gender in ('men', 'women')),
  season int not null,
  option_key text not null,
  option_label text not null,
  team text not null,
  players jsonb not null default '[]'::jsonb,
  lineups jsonb not null default '[]'::jsonb,
  lineup_count int not null default 0,
  source text not null default '',
  updated_at timestamptz not null default now(),
  primary key (gender, season, option_key)
);

create unique index if not exists idx_lineup_team_options_gender_season_team
  on public.lineup_team_options (gender, season, team);

create index if not exists idx_lineup_team_options_lookup
  on public.lineup_team_options (gender, season, option_label);

alter table public.lineup_team_options enable row level security;

revoke all privileges on table public.lineup_team_options from anon, authenticated;

drop policy if exists "lineup_team_options_service_role_select" on public.lineup_team_options;
drop policy if exists "lineup_team_options_service_role_insert" on public.lineup_team_options;
drop policy if exists "lineup_team_options_service_role_update" on public.lineup_team_options;
drop policy if exists "lineup_team_options_service_role_delete" on public.lineup_team_options;

create policy "lineup_team_options_service_role_select"
on public.lineup_team_options
for select
to service_role
using (true);

create policy "lineup_team_options_service_role_insert"
on public.lineup_team_options
for insert
to service_role
with check (true);

create policy "lineup_team_options_service_role_update"
on public.lineup_team_options
for update
to service_role
using (true)
with check (true);

create policy "lineup_team_options_service_role_delete"
on public.lineup_team_options
for delete
to service_role
using (true);
