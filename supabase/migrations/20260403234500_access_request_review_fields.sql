create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  organization text not null,
  requester_name text not null,
  notes text,
  status public.record_status_enum not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.access_requests
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_email text,
  add column if not exists fulfilled_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists fulfilled_access_code text;

create index if not exists idx_access_requests_status_created on public.access_requests(status, created_at desc);

revoke all privileges on table public.access_requests from anon, authenticated;
