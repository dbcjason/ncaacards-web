alter table public.player_payload_index
  drop constraint if exists player_payload_index_storage_provider_check;

alter table public.player_payload_index
  add constraint player_payload_index_storage_provider_check
  check (storage_provider in ('github', 'r2', 'supabase'));

alter table public.player_payload_index
  add column if not exists payload_json jsonb;
