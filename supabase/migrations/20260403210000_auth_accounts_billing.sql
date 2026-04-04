create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type_enum') then
    create type public.account_type_enum as enum ('paid', 'free', 'trial', 'expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'access_scope_enum') then
    create type public.access_scope_enum as enum ('men', 'women', 'both');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role_enum') then
    create type public.user_role_enum as enum ('admin', 'member');
  end if;
  if not exists (select 1 from pg_type where typname = 'record_status_enum') then
    create type public.record_status_enum as enum ('active', 'disabled', 'expired', 'pending');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_provider_enum') then
    create type public.payment_provider_enum as enum ('stripe', 'manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_status_enum') then
    create type public.payment_status_enum as enum ('not_required', 'pending', 'paid', 'past_due', 'cancelled', 'refunded');
  end if;
  if not exists (select 1 from pg_type where typname = 'usage_event_type_enum') then
    create type public.usage_event_type_enum as enum ('login', 'logout', 'card_build', 'transfer_search');
  end if;
end
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_type public.account_type_enum not null default 'paid',
  access_scope public.access_scope_enum not null default 'both',
  status public.record_status_enum not null default 'active',
  requires_payment boolean not null default true,
  contract_starts_at timestamptz,
  contract_ends_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organizations_status on public.organizations(status, expires_at);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null unique,
  account_type public.account_type_enum not null default 'paid',
  access_scope public.access_scope_enum not null default 'both',
  status public.record_status_enum not null default 'active',
  requires_payment boolean not null default true,
  max_uses integer not null default 1,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'access_codes_code_six_digits'
  ) then
    alter table public.access_codes
      add constraint access_codes_code_six_digits
      check (code ~ '^[0-9]{6}$');
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'access_codes_single_use_only'
  ) then
    alter table public.access_codes
      add constraint access_codes_single_use_only
      check (max_uses = 1);
  end if;
end
$$;

create index if not exists idx_access_codes_org on public.access_codes(organization_id, status);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  role public.user_role_enum not null default 'member',
  access_scope public.access_scope_enum not null default 'both',
  status public.record_status_enum not null default 'active',
  expires_at timestamptz,
  created_via_access_code_id uuid references public.access_codes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists idx_app_users_org on public.app_users(organization_id, status);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip_address text,
  country text,
  region text,
  city text,
  user_agent text
);

create index if not exists idx_user_sessions_user on public.user_sessions(user_id, expires_at desc);

create table if not exists public.billing_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.payment_provider_enum not null default 'manual',
  status public.payment_status_enum not null default 'pending',
  amount_cents integer,
  currency text not null default 'usd',
  billing_interval text,
  external_customer_id text,
  external_subscription_id text,
  external_checkout_session_id text,
  paid_at timestamptz,
  current_period_end timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_records_org on public.billing_records(organization_id, created_at desc);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  event_type public.usage_event_type_enum not null,
  email text,
  gender text,
  season int,
  team text,
  player text,
  query_text text,
  path text,
  source text,
  ip_address text,
  country text,
  region text,
  city text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_org_created on public.usage_events(organization_id, created_at desc);
create index if not exists idx_usage_events_type_created on public.usage_events(event_type, created_at desc);

revoke all privileges on table public.organizations from anon, authenticated;
revoke all privileges on table public.access_codes from anon, authenticated;
revoke all privileges on table public.app_users from anon, authenticated;
revoke all privileges on table public.user_sessions from anon, authenticated;
revoke all privileges on table public.billing_records from anon, authenticated;
revoke all privileges on table public.usage_events from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
