import "server-only";

import { dbQuery } from "@/lib/db";
import { ensureAccessRequestSchema } from "@/lib/access-requests";

export type DashboardOrganization = {
  id: string;
  name: string;
  account_type: "paid" | "free" | "trial" | "expired";
  access_scope: "men" | "women" | "both";
  status: string;
  requires_payment: boolean;
  contract_starts_at: string | null;
  contract_ends_at: string | null;
  expires_at: string | null;
  notes: string | null;
  user_count: number;
  active_code_count: number;
};

export async function listOrganizations(): Promise<DashboardOrganization[]> {
  return dbQuery<DashboardOrganization>(
    `select
        o.*,
        coalesce(u.user_count, 0)::int as user_count,
        coalesce(c.code_count, 0)::int as active_code_count
      from public.organizations o
      left join (
        select organization_id, count(*) as user_count
        from public.app_users
        group by organization_id
      ) u on u.organization_id = o.id
      left join (
        select organization_id, count(*) as code_count
        from public.access_codes
        where status = 'active'
        group by organization_id
      ) c on c.organization_id = o.id
      order by lower(o.name) asc`,
  );
}

export type DashboardUser = {
  id: string;
  email: string;
  role: "admin" | "member";
  access_scope: "men" | "women" | "both";
  status: string;
  expires_at: string | null;
  created_at: string;
  last_login_at: string | null;
  organization_id: string;
  organization_name: string;
};

export async function listUsers(): Promise<DashboardUser[]> {
  return dbQuery<DashboardUser>(
    `select
        u.id,
        u.email,
        u.role,
        u.access_scope,
        u.status,
        u.expires_at,
        u.created_at,
        u.last_login_at,
        u.organization_id,
        o.name as organization_name
      from public.app_users u
      join public.organizations o on o.id = u.organization_id
      order by u.created_at desc`,
  );
}

export type DashboardAccessCode = {
  id: string;
  organization_id: string;
  organization_name: string;
  code: string;
  account_type: "paid" | "free" | "trial" | "expired";
  access_scope: "men" | "women" | "both";
  status: string;
  requires_payment: boolean;
  used_count: number;
  max_uses: number;
  expires_at: string | null;
  created_at: string;
};

export async function listAccessCodes(): Promise<DashboardAccessCode[]> {
  return dbQuery<DashboardAccessCode>(
    `select
        ac.id,
        ac.organization_id,
        o.name as organization_name,
        ac.code,
        ac.account_type,
        ac.access_scope,
        ac.status,
        ac.requires_payment,
        ac.used_count,
        ac.max_uses,
        ac.expires_at,
        ac.created_at
      from public.access_codes ac
      join public.organizations o on o.id = ac.organization_id
      order by ac.created_at desc
      limit 200`,
  );
}

export type DashboardBillingRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  provider: "stripe" | "manual";
  status: string;
  amount_cents: number | null;
  currency: string;
  billing_interval: string | null;
  paid_at: string | null;
  current_period_end: string | null;
  notes: string | null;
  expires_at: string | null;
  contract_ends_at: string | null;
};

export async function listBillingRecords(): Promise<DashboardBillingRow[]> {
  return dbQuery<DashboardBillingRow>(
    `select
        b.id,
        b.organization_id,
        o.name as organization_name,
        b.provider,
        b.status,
        b.amount_cents,
        b.currency,
        b.billing_interval,
        b.paid_at,
        b.current_period_end,
        b.notes,
        o.expires_at,
        o.contract_ends_at
      from public.billing_records b
      join public.organizations o on o.id = b.organization_id
      order by coalesce(b.current_period_end, o.contract_ends_at, o.expires_at) asc nulls last, o.name asc`,
  );
}

export type DashboardUsageSummary = {
  organization_id: string;
  organization_name: string;
  login_count: number;
  card_build_count: number;
  transfer_search_count: number;
  last_activity_at: string | null;
};

export async function listUsageSummary(): Promise<DashboardUsageSummary[]> {
  return dbQuery<DashboardUsageSummary>(
    `select
        o.id as organization_id,
        o.name as organization_name,
        coalesce(sum(case when ue.event_type = 'login' then 1 else 0 end), 0)::int as login_count,
        coalesce(sum(case when ue.event_type = 'card_build' then 1 else 0 end), 0)::int as card_build_count,
        coalesce(sum(case when ue.event_type = 'transfer_search' then 1 else 0 end), 0)::int as transfer_search_count,
        max(ue.created_at) as last_activity_at
      from public.organizations o
      left join public.usage_events ue on ue.organization_id = o.id
      group by o.id, o.name
      order by lower(o.name) asc`,
  );
}

export type DashboardUsageEvent = {
  id: number;
  organization_id: string;
  organization_name: string;
  email: string | null;
  event_type: "login" | "logout" | "card_build" | "transfer_search";
  gender: string | null;
  season: number | null;
  team: string | null;
  player: string | null;
  query_text: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  source: string | null;
  created_at: string;
};

export async function listUsageEvents(
  organizationId?: string | null,
  eventType?: "login" | "logout" | "card_build" | "transfer_search" | null,
): Promise<DashboardUsageEvent[]> {
  const clauses: string[] = [];
  const params: string[] = [];

  if (organizationId) {
    params.push(organizationId);
    clauses.push(`ue.organization_id = $${params.length}`);
  }

  if (eventType) {
    params.push(eventType);
    clauses.push(`ue.event_type = $${params.length}`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  return dbQuery<DashboardUsageEvent>(
    `select
        ue.id,
        ue.organization_id,
        o.name as organization_name,
        ue.email,
        ue.event_type,
        ue.gender,
        ue.season,
        ue.team,
        ue.player,
        ue.query_text,
        ue.country,
        ue.region,
        ue.city,
        ue.source,
        ue.created_at
      from public.usage_events ue
      join public.organizations o on o.id = ue.organization_id
      ${where}
      order by ue.created_at desc
      limit 250`,
    params,
  );
}

export type DashboardAccessRequest = {
  id: string;
  email: string;
  organization: string;
  requester_name: string;
  notes: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  fulfilled_organization_id: string | null;
  fulfilled_access_code: string | null;
};

export async function listAccessRequests(): Promise<DashboardAccessRequest[]> {
  await ensureAccessRequestSchema();
  return dbQuery<DashboardAccessRequest>(
    `select
        id,
        email,
        organization,
        requester_name,
        notes,
        status,
        created_at,
        reviewed_at,
        reviewed_by_email,
        fulfilled_organization_id,
        fulfilled_access_code
      from public.access_requests
      order by created_at desc
      limit 250`,
  );
}
