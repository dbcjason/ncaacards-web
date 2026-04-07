create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  gender text not null check (gender in ('men', 'women')),
  season int not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_watchlists_user_gender
  on public.watchlists (user_id, gender, season, sort_order, created_at);

alter table public.watchlist_items
  add column if not exists watchlist_id uuid;

insert into public.watchlists (user_id, gender, season, name, sort_order, updated_at)
select distinct
  w.user_id,
  w.gender,
  w.season,
  'My Watchlist' as name,
  0 as sort_order,
  now() as updated_at
from public.watchlist_items w
left join public.watchlists wl
  on wl.user_id = w.user_id
 and wl.gender = w.gender
 and wl.season = w.season
where wl.id is null;

update public.watchlist_items wi
set watchlist_id = wl.id
from public.watchlists wl
where wi.watchlist_id is null
  and wl.user_id = wi.user_id
  and wl.gender = wi.gender
  and wl.season = wi.season;

alter table public.watchlist_items
  alter column watchlist_id set not null;

alter table public.watchlist_items
  add constraint watchlist_items_watchlist_id_fkey
  foreign key (watchlist_id)
  references public.watchlists(id)
  on delete cascade;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'watchlist_items_user_id_gender_season_team_player_key'
      and conrelid = 'public.watchlist_items'::regclass
  ) then
    alter table public.watchlist_items
      drop constraint watchlist_items_user_id_gender_season_team_player_key;
  end if;
end $$;

alter table public.watchlist_items
  add constraint watchlist_items_watchlist_player_key
  unique (watchlist_id, team, player);

create index if not exists idx_watchlist_items_watchlist
  on public.watchlist_items (watchlist_id, sort_order, created_at);

revoke all privileges on table public.watchlists from anon, authenticated;
