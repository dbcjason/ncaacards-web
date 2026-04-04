import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAccessCodes, listAccessRequests, listBillingRecords, listOrganizations, listUsageEvents, listUsageSummary, listUsers } from "@/lib/admin";
import { CreateOrganizationForm } from "@/components/admin/create-organization-form";
import { AccessRequestItem } from "@/components/admin/access-request-item";

type DashboardPageProps = {
  searchParams: Promise<{
    tab?: string;
    requestStatus?: string;
    notice?: string;
    error?: string;
    org?: string;
    eventType?: string;
  }>;
};

const TABS = ["accounts", "requests", "payments", "usage", "activity"] as const;
const REQUEST_TABS = ["pending", "accepted", "declined"] as const;

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  if (!user) {
    redirect("/?error=Please log in again.");
  }
  if (user.role !== "admin") {
    redirect("/cards");
  }
  try {
    const tab = TABS.includes((params.tab || "accounts") as (typeof TABS)[number])
      ? (params.tab as (typeof TABS)[number])
      : "accounts";
    const requestStatus = REQUEST_TABS.includes((params.requestStatus || "pending") as (typeof REQUEST_TABS)[number])
      ? (params.requestStatus as (typeof REQUEST_TABS)[number])
      : "pending";

    const [
      organizationsResult,
      usersResult,
      accessCodesResult,
      accessRequestsResult,
      billingResult,
      usageSummaryResult,
      usageEventsResult,
    ] = await Promise.allSettled([
      listOrganizations(),
      listUsers(),
      listAccessCodes(),
      listAccessRequests(),
      listBillingRecords(),
      listUsageSummary(),
      listUsageEvents(params.org || null, normalizeEventType(params.eventType)),
    ]);

    const organizations = unwrapSettled(organizationsResult);
    const users = unwrapSettled(usersResult);
    const accessCodes = unwrapSettled(accessCodesResult);
    const accessRequests = unwrapSettled(accessRequestsResult);
    const billing = unwrapSettled(billingResult);
    const usageSummary = unwrapSettled(usageSummaryResult);
    const usageEvents = unwrapSettled(usageEventsResult);
    const filteredAccessRequests = accessRequests.filter((request) => matchesRequestStatus(request.status, requestStatus));
    const hasDataError = [
      organizationsResult,
      usersResult,
      accessCodesResult,
      accessRequestsResult,
      billingResult,
      usageSummaryResult,
      usageEventsResult,
    ].some((result) => result.status === "rejected");
    const accountSections = [
      renderSafeSection("Create Organization", () => (
        <section className="site-panel space-y-6 rounded-xl p-6">
          <div>
            <div className="text-lg font-semibold text-zinc-100">Create Organization</div>
          </div>
          <CreateOrganizationForm />
        </section>
      )),
      renderSafeSection("Create Free User Directly", () => (
        <section className="site-panel space-y-6 rounded-xl p-6">
          <div>
            <div className="text-lg font-semibold text-zinc-100">Create Free User Directly</div>
          </div>
          <form action="/api/admin/free-users" method="post" className="grid gap-4 md:grid-cols-4">
            <Field label="Organization">
              <select className="site-input" name="organizationId" required defaultValue="">
                <option value="" disabled>Select organization</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Email"><input className="site-input" name="email" type="email" required /></Field>
            <Field label="Temporary Password"><input className="site-input" name="password" type="text" required /></Field>
            <Field label="Access Scope">
              <select className="site-input" name="accessScope" defaultValue="both">
                <option value="both">Both</option>
                <option value="men">Men</option>
                <option value="women">Women</option>
              </select>
            </Field>
            <Field label="Expiration Date"><input className="site-input" type="date" name="expiresAt" /></Field>
            <div className="md:col-span-4"><button className="site-button" type="submit">Create Free Account</button></div>
          </form>
        </section>
      )),
      renderSafeSection("Organizations", () => (
        <section className="site-panel rounded-xl p-6">
          <div className="text-lg font-semibold text-zinc-100">Organizations</div>
          <div className="mt-4 overflow-x-auto">
            <table className="dashboard-table">
              <thead><tr><th>Organization</th><th>Type</th><th>Scope</th><th>Users</th><th>Active Codes</th><th>Contract End</th><th>Expires</th></tr></thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id}>
                    <td>{org.name}</td>
                    <td>{org.account_type}</td>
                    <td>{org.access_scope}</td>
                    <td>{org.user_count}</td>
                    <td>{org.active_code_count}</td>
                    <td>{formatDate(org.contract_ends_at)}</td>
                    <td>{formatDate(org.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )),
      renderSafeSection("Users + Codes", () => (
        <section className="site-panel rounded-xl p-6">
          <div className="text-lg font-semibold text-zinc-100">Users + Codes</div>
          <div className="mt-4 grid gap-6 xl:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="dashboard-table">
                <thead><tr><th>User</th><th>Org</th><th>Role</th><th>Scope</th><th>Expires</th><th>Last Login</th><th>Actions</th></tr></thead>
                <tbody>
                  {users.map((account) => (
                    <tr key={account.id}>
                      <td>{account.email}</td>
                      <td>{account.organization_name}</td>
                      <td>{account.role}</td>
                      <td>{account.access_scope}</td>
                      <td>{formatDate(account.expires_at)}</td>
                      <td>{formatDateTime(account.last_login_at)}</td>
                      <td>
                        {account.id === user.id ? (
                          <span className="text-xs text-zinc-500">Current admin</span>
                        ) : (
                          <form action="/api/admin/users/delete" method="post">
                            <input type="hidden" name="userId" value={account.id} />
                            <input type="hidden" name="email" value={account.email} />
                            <button
                              type="submit"
                              className="site-button-secondary border-rose-800 text-rose-200 hover:bg-rose-950/40"
                            >
                              Delete
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="dashboard-table">
                <thead><tr><th>Code</th><th>Org</th><th>Scope</th><th>Status</th><th>Uses</th><th>Expires</th></tr></thead>
                <tbody>
                  {accessCodes.map((code) => (
                    <tr key={code.id}>
                      <td className="font-semibold tracking-[0.18em]">{code.code}</td>
                      <td>{code.organization_name}</td>
                      <td>{code.access_scope}</td>
                      <td>{code.status}</td>
                      <td>{code.used_count}/{code.max_uses}</td>
                      <td>{formatDate(code.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )),
    ];

    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
        <div className="mx-auto w-full max-w-7xl space-y-6">
          <div className="text-2xl font-semibold text-zinc-100">Admin Dashboard</div>

          {params.notice && <Banner tone="success">{params.notice}</Banner>}
          {params.error && <Banner tone="error">{params.error}</Banner>}
          {hasDataError && (
            <Banner tone="error">
              Some dashboard data could not be loaded, but your account is fine. The page is using partial results until I finish cleaning up the failing query.
            </Banner>
          )}

          <div className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <a key={item} href={`/dashboard?tab=${item}`} className={`site-button-secondary ${tab === item ? "!border-zinc-500 !bg-zinc-800 !text-white" : ""}`}>
                {labelForTab(item)}
              </a>
            ))}
          </div>

          {tab === "accounts" && (
            <div className="grid gap-6">
              {accountSections}
            </div>
          )}

          {tab === "requests" && (
            <section className="space-y-4">
              <div className="text-lg font-semibold text-zinc-100">Access Code Requests</div>
              <div className="flex flex-wrap gap-2">
                {REQUEST_TABS.map((item) => (
                  <a
                    key={item}
                    href={`/dashboard?tab=requests&requestStatus=${item}`}
                    className={`site-button-secondary ${requestStatus === item ? "!border-zinc-500 !bg-zinc-800 !text-white" : ""}`}
                  >
                    {labelForRequestTab(item)}
                  </a>
                ))}
              </div>
              <div className="grid gap-4">
                {filteredAccessRequests.map((request) => (
                  <AccessRequestItem key={request.id} request={request} />
                ))}
                {!filteredAccessRequests.length && (
                  <div className="site-panel rounded-xl p-6 text-zinc-400">No {labelForRequestTab(requestStatus).toLowerCase()} right now.</div>
                )}
              </div>
            </section>
          )}

          {tab === "payments" && (
            <section className="site-panel rounded-xl p-6">
              <div className="text-lg font-semibold text-zinc-100">Payments + Contract Timeline</div>
              <div className="mt-4 overflow-x-auto">
                <table className="dashboard-table">
                  <thead><tr><th>Organization</th><th>Provider</th><th>Status</th><th>Amount</th><th>Billing</th><th>Period End</th><th>Contract End</th><th>Expiration</th><th>Days Left</th></tr></thead>
                  <tbody>
                    {billing.map((row) => (
                      <tr key={row.id}>
                        <td>{row.organization_name}</td>
                        <td>{row.provider}</td>
                        <td>{row.status}</td>
                        <td>{row.amount_cents == null ? "—" : `$${(row.amount_cents / 100).toFixed(2)}`}</td>
                        <td>{row.billing_interval || "—"}</td>
                        <td>{formatDate(row.current_period_end)}</td>
                        <td>{formatDate(row.contract_ends_at)}</td>
                        <td>{formatDate(row.expires_at)}</td>
                        <td>{daysLeft(row.current_period_end || row.contract_ends_at || row.expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "usage" && (
            <section className="site-panel rounded-xl p-6">
              <div className="text-lg font-semibold text-zinc-100">Usage By Organization</div>
              <div className="mt-4 overflow-x-auto">
                <table className="dashboard-table">
                  <thead><tr><th>Organization</th><th>Logins</th><th>Card Builds</th><th>Transfer Searches</th><th>Last Activity</th><th></th></tr></thead>
                  <tbody>
                    {usageSummary.map((row) => (
                      <tr key={row.organization_id}>
                        <td>{row.organization_name}</td>
                        <td>{row.login_count}</td>
                        <td>{row.card_build_count}</td>
                        <td>{row.transfer_search_count}</td>
                        <td>{formatDateTime(row.last_activity_at)}</td>
                        <td><a className="dashboard-link" href={`/dashboard?tab=activity&org=${row.organization_id}`}>Filter Activity</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "activity" && (
            <section className="site-panel rounded-xl p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-lg font-semibold text-zinc-100">Specific Usage</div>
                </div>
                <form action="/dashboard" method="get" className="flex flex-col gap-2 md:flex-row">
                  <input type="hidden" name="tab" value="activity" />
                  <select className="site-input min-w-72" name="org" defaultValue={params.org || ""}>
                    <option value="">All organizations</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                  <select className="site-input min-w-56" name="eventType" defaultValue={params.eventType || ""}>
                    <option value="">All activity</option>
                    <option value="login">Log-ins</option>
                    <option value="logout">Log-outs</option>
                    <option value="card_build">Profile Builds</option>
                    <option value="transfer_search">Transfer Portal Searches</option>
                  </select>
                  <button type="submit" className="site-button">Apply Filter</button>
                </form>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="dashboard-table">
                  <thead><tr><th>When</th><th>Organization</th><th>Email</th><th>Event</th><th>Details</th><th>Gender</th><th>Location</th></tr></thead>
                  <tbody>
                    {usageEvents.map((event) => (
                      <tr key={event.id}>
                        <td>{formatDateTime(event.created_at)}</td>
                        <td>{event.organization_name}</td>
                        <td>{event.email || "—"}</td>
                        <td>{labelForEvent(event.event_type)}</td>
                        <td>{detailForEvent(event)}</td>
                        <td>{event.gender || "—"}</td>
                        <td>{[event.city, event.region, event.country].filter(Boolean).join(", ") || "—"}</td>
                      </tr>
                    ))}
                    {!usageEvents.length && (
                      <tr><td colSpan={7}>No matching activity yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin dashboard error.";
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
        <div className="mx-auto w-full max-w-7xl space-y-6">
          <div className="text-2xl font-semibold text-zinc-100">Admin Dashboard</div>
          <Banner tone="error">
            The dashboard hit a live admin-only error, so I’m showing a safe fallback instead of a full crash. {message}
          </Banner>
          <div className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <a key={item} href={`/dashboard?tab=${item}`} className="site-button-secondary">
                {labelForTab(item)}
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  }
}

function labelForTab(tab: string) {
  if (tab === "accounts") return "Accounts";
  if (tab === "requests") return "Requests";
  if (tab === "payments") return "Payments";
  if (tab === "usage") return "Usage Overview";
  return "Specific Usage";
}

function labelForRequestTab(tab: "pending" | "accepted" | "declined") {
  if (tab === "accepted") return "Accepted Requests";
  if (tab === "declined") return "Declined Requests";
  return "Pending Requests";
}

function normalizeEventType(value?: string | null) {
  if (value === "login" || value === "logout" || value === "card_build" || value === "transfer_search") {
    return value;
  }
  return null;
}

function matchesRequestStatus(status: string, tab: "pending" | "accepted" | "declined") {
  if (tab === "accepted") return status === "disabled";
  if (tab === "declined") return status === "expired";
  return status === "pending";
}

function labelForEvent(value: "login" | "logout" | "card_build" | "transfer_search") {
  if (value === "card_build") return "Profile Build";
  if (value === "transfer_search") return "Transfer Search";
  if (value === "login") return "Log-In";
  return "Log-Out";
}

function detailForEvent(event: {
  event_type: "login" | "logout" | "card_build" | "transfer_search";
  player: string | null;
  team: string | null;
  season: number | null;
  source: string | null;
  query_text: string | null;
}) {
  if (event.event_type === "card_build") {
    const parts = [
      event.player || null,
      event.team || null,
      event.season ? String(event.season) : null,
      event.source ? `mode=${event.source}` : null,
    ].filter(Boolean);
    return parts.join(" | ") || "—";
  }
  if (event.event_type === "transfer_search") {
    const parts = [
      event.query_text || null,
      event.season ? String(event.season) : null,
      event.source ? `source=${event.source}` : null,
    ].filter(Boolean);
    return parts.join(" | ") || "—";
  }
  return event.source || "—";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <div className="text-sm font-medium text-zinc-100">{label}</div>
      {children}
    </label>
  );
}

function Banner({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl px-4 py-3 text-sm ${tone === "success" ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>
      {children}
    </div>
  );
}

function formatDate(value: string | null) {
  const parsed = parseDateValue(value);
  if (!parsed) return "—";
  return parsed.toLocaleDateString("en-US");
}

function formatDateTime(value: string | null) {
  const parsed = parseDateValue(value);
  if (!parsed) return "—";
  return parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function daysLeft(value: string | null) {
  const parsed = parseDateValue(value);
  if (!parsed) return "—";
  const diff = Math.ceil((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? `${diff}` : "—";
}

function unwrapSettled<T>(result: PromiseSettledResult<T>): T extends Array<infer U> ? U[] : T | [] {
  return (result.status === "fulfilled" ? result.value : []) as T extends Array<infer U> ? U[] : T | [];
}

function parseDateValue(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function renderSafeSection(label: string, render: () => React.ReactNode) {
  try {
    return render();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected section error.";
    return (
      <section key={label} className="site-panel rounded-xl p-6">
        <div className="text-lg font-semibold text-zinc-100">{label}</div>
        <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          This section could not be rendered yet. {message}
        </div>
      </section>
    );
  }
}
