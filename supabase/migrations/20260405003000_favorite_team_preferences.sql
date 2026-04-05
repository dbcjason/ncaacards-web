alter table public.organizations
  add column if not exists favorite_team text,
  add column if not exists favorite_conference text;

alter table public.app_users
  add column if not exists favorite_team text,
  add column if not exists favorite_conference text;
