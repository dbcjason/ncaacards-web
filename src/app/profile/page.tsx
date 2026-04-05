import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/?error=Please log in again.");
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {params.notice ? <Banner tone="success">{params.notice}</Banner> : null}
        {params.error ? <Banner tone="error">{params.error}</Banner> : null}
        <section className="site-panel rounded-xl p-6">
          <div className="text-lg font-semibold text-zinc-100">Account Profile</div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ProfileItem label="Email" value={user.email} />
            <ProfileItem label="Role" value={formatDisplayValue(user.role)} />
            <ProfileItem label="Organization" value={user.organization_name} />
            <ProfileItem label="Access Scope" value={formatDisplayValue(user.access_scope)} />
            <ProfileItem label="Organization Access" value={formatDisplayValue(user.organization_access_scope)} />
            <ProfileItem label="Organization Type" value={formatDisplayValue(user.organization_account_type)} />
            <ProfileItem label="Account Status" value={formatDisplayValue(user.status)} />
            <ProfileItem label="Expiration Date" value={user.expires_at ? new Date(user.expires_at).toLocaleDateString("en-US") : "No expiration set"} />
            <ProfileItem label="Favorite Team" value={user.effective_favorite_team || "Not set"} />
            <ProfileItem label="Favorite Conference" value={user.effective_favorite_conference || "SEC"} />
          </div>
        </section>

        <section className="site-panel rounded-xl p-6">
          <div className="text-lg font-semibold text-zinc-100">Favorite Team</div>
          <form action="/api/profile/preferences" method="post" className="mt-4 space-y-4">
            <label className="block space-y-2">
              <div className="text-sm text-zinc-300">Favorite Team</div>
              <input
                className="site-input"
                name="favoriteTeam"
                defaultValue={user.favorite_team || user.organization_favorite_team || ""}
                placeholder="Optional team"
              />
            </label>
            <div className="text-xs text-zinc-500">
              This controls the default team for player profiles, roster construction, and the default conference for transfer views and watchlist previews.
            </div>
            <button className="site-button" type="submit">Save Favorite Team</button>
          </form>

          <div className="mt-8 text-lg font-semibold text-zinc-100">Quick Links</div>
          <div className="mt-4 space-y-3 text-sm">
            {user.access_scope !== "women" && <a className="dashboard-link block" href="/cards?gender=men">Open Men Player Profiles</a>}
            {user.access_scope !== "men" && <a className="dashboard-link block" href="/cards?gender=women">Open Women Player Profiles</a>}
            <a className="dashboard-link block" href={`/transfer-grades?gender=${user.access_scope === "women" ? "women" : "men"}&season=2026`}>Open Transfer Grades</a>
            {user.role === "admin" && <a className="dashboard-link block" href="/dashboard">Open Admin Dashboard</a>}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfileItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">{label}</div>
      <div className="mt-2 text-base text-zinc-100">{value}</div>
    </div>
  );
}

function formatDisplayValue(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Banner({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  const classes =
    tone === "success"
      ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
      : "border-rose-800 bg-rose-950/40 text-rose-200";
  return <div className={`lg:col-span-2 rounded-xl border px-4 py-3 text-sm ${classes}`}>{children}</div>;
}
