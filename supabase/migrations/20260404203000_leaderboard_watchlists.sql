create table if not exists public.leaderboard_player_stats (
  gender text not null check (gender in ('men', 'women')),
  season int not null,
  team text not null,
  player text not null,
  conference text not null default '',
  class text not null default '',
  pos text not null default '',
  age numeric,
  height text not null default '',
  statistical_height text not null default '',
  statistical_height_delta numeric,
  rsci numeric,
  values jsonb not null default '{}'::jsonb,
  percentiles jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (gender, season, team, player)
);

create index if not exists idx_leaderboard_player_stats_lookup
  on public.leaderboard_player_stats (gender, season, team, player);

create index if not exists idx_leaderboard_player_stats_updated
  on public.leaderboard_player_stats (gender, season, updated_at desc);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  gender text not null check (gender in ('men', 'women')),
  season int not null,
  team text not null,
  player text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, gender, season, team, player)
);

create index if not exists idx_watchlist_items_user_gender
  on public.watchlist_items (user_id, gender, season, sort_order, created_at);

revoke all privileges on table public.leaderboard_player_stats from anon, authenticated;
revoke all privileges on table public.watchlist_items from anon, authenticated;

