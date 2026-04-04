create table if not exists public.player_payload_phase_backup (
  gender text not null check (gender in ('men', 'women')),
  season integer not null,
  phase text not null,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_count integer not null check (chunk_count >= 1),
  row_count integer not null default 0 check (row_count >= 0),
  payload_gzip_base64 text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (gender, season, phase, chunk_index)
);

create index if not exists idx_player_payload_phase_backup_lookup
  on public.player_payload_phase_backup (gender, season, phase);

alter table public.player_payload_phase_backup enable row level security;

revoke all privileges on table public.player_payload_phase_backup from anon, authenticated;
grant all privileges on table public.player_payload_phase_backup to service_role;

drop policy if exists "player_payload_phase_backup_service_role_select" on public.player_payload_phase_backup;
drop policy if exists "player_payload_phase_backup_service_role_insert" on public.player_payload_phase_backup;
drop policy if exists "player_payload_phase_backup_service_role_update" on public.player_payload_phase_backup;
drop policy if exists "player_payload_phase_backup_service_role_delete" on public.player_payload_phase_backup;

create policy "player_payload_phase_backup_service_role_select"
on public.player_payload_phase_backup
for select
to service_role
using (true);

create policy "player_payload_phase_backup_service_role_insert"
on public.player_payload_phase_backup
for insert
to service_role
with check (true);

create policy "player_payload_phase_backup_service_role_update"
on public.player_payload_phase_backup
for update
to service_role
using (true)
with check (true);

create policy "player_payload_phase_backup_service_role_delete"
on public.player_payload_phase_backup
for delete
to service_role
using (true);
