import { requireAdminUser } from "@/lib/auth";
import { listAccessCodes, listBillingRecords, listOrganizations, listUsageEvents, listUsageSummary, listUsers } from "@/lib/admin";

type DashboardPageProps = {
  searchParams: Promise<{
    tab?: string;
    notice?: string;
    error?: string;
    org?: string;
  }>;
};

const TABS = ["accounts", "payments", "usage", "activity"] as const;

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const tab = TABS.includes((params.tab || "accounts") as (typeof TABS)[number])
    ? (params.tab as (typeof TABS)[number])
    : "accounts";

  const [organizations, users, accessCodes, billing, usageSummary, usageEvents] = await Promise.all([
    listOrganizations(),
    listUsers(),
    listAccessCodes(),
    listBillingRecords(),
    listUsageSummary(),
    listUsageEvents(params.org || null),
  ]);

  return (
    <div className="min-h-screen px-6 py-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[color:var(--accent-soft)]">Admin Dashboard</div>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">Organizations, access, payments, and usage</h1>
            <p className="mt-2 max-w-3xl text-[color:var(--muted)]">
              Create organizations, generate one-time six-digit codes, comp users, watch contract dates, and audit how every account is using the site.
            </p>
          </div>
        </div>

        {params.notice && <Banner tone="success">{params.notice}</Banner>}
        {params.error && <Banner tone="error">{params.error}</Banner>}

        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <a key={item} href={`/dashboard?tab=${item}`} className={`dashboard-pill ${tab === item ? "dashboard-pill-active" : ""}`}>
              {labelForTab(item)}
            </a>
          ))}
        </div>

        {tab === "accounts" && (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="dashboard-card space-y-6">
              <div>
                <div className="dashboard-section-title">Create Organization</div>
                <div className="dashboard-section-copy">This is your source-of-truth account record: access scope, contract dates, notes, and payment expectation.</div>
              </div>
              <form action="/api/admin/organizations" method="post" className="grid gap-4 md:grid-cols-2">
                <Field label="Organization Name"><input className="auth-input" name="organizationName" required /></Field>
                <Field label="Account Type">
                  <select className="auth-input" name="accountType" defaultValue="paid">
                    <option value="paid">Paid</option>
                    <option value="free">Free</option>
                    <option value="trial">Trial</option>
                    <option value="expired">Expired</option>
                  </select>
                </Field>
                <Field label="Access Scope">
                  <select className="auth-input" name="accessScope" defaultValue="both">
                    <option value="both">Both</option>
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                  </select>
                </Field>
                <label className="flex items-center gap-3 pt-8 text-sm text-[color:var(--foreground)]">
                  <input type="checkbox" name="requiresPayment" defaultChecked className="h-4 w-4" />
                  Requires payment
                </label>
                <Field label="Contract Start"><input className="auth-input" type="date" name="contractStartsAt" /></Field>
                <Field label="Contract End"><input className="auth-input" type="date" name="contractEndsAt" /></Field>
                <Field label="Expiration Date"><input className="auth-input" type="date" name="expiresAt" /></Field>
                <Field label="Notes"><textarea className="auth-input min-h-28" name="notes" /></Field>
                <div className="md:col-span-2"><button className="primary-button" type="submit">Create Organization</button></div>
              </form>
            </section>

            <section className="dashboard-card space-y-6">
              <div>
                <div className="dashboard-section-title">Generate One-Time Access Code</div>
                <div className="dashboard-section-copy">
                  Every generated code is six digits and single-use only. You can attach a recipient email and send the invite with one click.
                </div>
              </div>
              <form action="/api/admin/access-codes" method="post" className="grid gap-4">
                <Field label="Organization">
                  <select className="auth-input" name="organizationId" required defaultValue="">
                    <option value="" disabled>Select organization</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Access Scope">
                  <select className="auth-input" name="accessScope" defaultValue="both">
                    <option value="both">Both</option>
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                  </select>
                </Field>
                <Field label="Account Type">
                  <select className="auth-input" name="accountType" defaultValue="paid">
                    <option value="paid">Paid</option>
                    <option value="free">Free</option>
                    <option value="trial">Trial</option>
                  </select>
                </Field>
                <Field label="Recipient Email (optional unless sending invite)">
                  <input className="auth-input" name="recipientEmail" type="email" placeholder="coach@program.com" />
                </Field>
                <Field label="Code Expiration"><input className="auth-input" type="date" name="expiresAt" /></Field>
                <label className="flex items-center gap-3 text-sm text-[color:var(--foreground)]">
                  <input type="checkbox" name="requiresPayment" defaultChecked className="h-4 w-4" />
                  Require payment before signup completes
                </label>
                <label className="flex items-center gap-3 text-sm text-[color:var(--foreground)]">
                  <input type="checkbox" name="sendInvite" className="h-4 w-4" />
                  Send invite email with signup link
                </label>
                <button className="primary-button" type="submit">Generate Access Code</button>
              </form>
            </section>

            <section className="dashboard-card space-y-6 lg:col-span-2">
              <div>
                <div className="dashboard-section-title">Create Free User Directly</div>
                <div className="dashboard-section-copy">Use this for comped analysts or trusted internal users who should skip the code + payment flow entirely.</div>
              </div>
              <form action="/api/admin/free-users" method="post" className="grid gap-4 md:grid-cols-4">
                <Field label="Organization">
                  <select className="auth-input" name="organizationId" required defaultValue="">
                    <option value="" disabled>Select organization</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Email"><input className="auth-input" name="email" type="email" required /></Field>
                <Field label="Temporary Password"><input className="auth-input" name="password" type="text" required /></Field>
                <Field label="Access Scope">
                  <select className="auth-input" name="accessScope" defaultValue="both">
                    <option value="both">Both</option>
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                  </select>
                </Field>
                <Field label="Expiration Date"><input className="auth-input" type="date" name="expiresAt" /></Field>
                <div className="md:col-span-4"><button className="primary-button" type="submit">Create Free Account</button></div>
              </form>
            </section>

            <section className="dashboard-card lg:col-span-2">
              <div className="dashboard-section-title">Organizations</div>
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

            <section className="dashboard-card lg:col-span-2">
              <div className="dashboard-section-title">Users + Codes</div>
              <div className="mt-4 grid gap-6 xl:grid-cols-2">
                <div className="overflow-x-auto">
                  <table className="dashboard-table">
                    <thead><tr><th>User</th><th>Org</th><th>Role</th><th>Scope</th><th>Expires</th><th>Last Login</th></tr></thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>{user.email}</td>
                          <td>{user.organization_name}</td>
                          <td>{user.role}</td>
                          <td>{user.access_scope}</td>
                          <td>{formatDate(user.expires_at)}</td>
                          <td>{formatDateTime(user.last_login_at)}</td>
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
          </div>
        )}

        {tab === "payments" && (
          <section className="dashboard-card">
            <div className="dashboard-section-title">Payments + Contract Timeline</div>
            <div className="dashboard-section-copy mt-1">This is where you can see who is free, who is paid, and how long each organization has left.</div>
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
          <section className="dashboard-card">
            <div className="dashboard-section-title">Usage By Organization</div>
            <div className="dashboard-section-copy mt-1">High-level usage counts so you can see who is actually using the product.</div>
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
          <section className="dashboard-card">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="dashboard-section-title">Specific Usage</div>
                <div className="dashboard-section-copy mt-1">Every login, card build, and transfer search, filterable by organization.</div>
              </div>
              <form action="/dashboard" method="get" className="flex gap-2">
                <input type="hidden" name="tab" value="activity" />
                <select className="auth-input min-w-72" name="org" defaultValue={params.org || ""}>
                  <option value="">All organizations</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
                <button type="submit" className="primary-button">Apply Filter</button>
              </form>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="dashboard-table">
                <thead><tr><th>When</th><th>Organization</th><th>Email</th><th>Event</th><th>Gender</th><th>Player</th><th>Team</th><th>Query</th><th>Location</th></tr></thead>
                <tbody>
                  {usageEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDateTime(event.created_at)}</td>
                      <td>{event.organization_name}</td>
                      <td>{event.email || "—"}</td>
                      <td>{event.event_type}</td>
                      <td>{event.gender || "—"}</td>
                      <td>{event.player || "—"}</td>
                      <td>{event.team || "—"}</td>
                      <td>{event.query_text || "—"}</td>
                      <td>{[event.city, event.region, event.country].filter(Boolean).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function labelForTab(tab: string) {
  if (tab === "accounts") return "Accounts";
  if (tab === "payments") return "Payments";
  if (tab === "usage") return "Usage Overview";
  return "Specific Usage";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <div className="text-sm font-medium text-[color:var(--foreground)]">{label}</div>
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
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US");
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function daysLeft(value: string | null) {
  if (!value) return "—";
  const diff = Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? `${diff}` : "—";
}
