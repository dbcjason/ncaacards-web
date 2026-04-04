import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/?error=Please log in again.");
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="site-panel rounded-xl p-6">
          <div className="text-lg font-semibold text-zinc-100">Account Profile</div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ProfileItem label="Email" value={user.email} />
            <ProfileItem label="Role" value={user.role} />
            <ProfileItem label="Organization" value={user.organization_name} />
            <ProfileItem label="Access Scope" value={user.access_scope} />
            <ProfileItem label="Organization Access" value={user.organization_access_scope} />
            <ProfileItem label="Organization Type" value={user.organization_account_type} />
            <ProfileItem label="Account Status" value={user.status} />
            <ProfileItem label="Expiration Date" value={user.expires_at ? new Date(user.expires_at).toLocaleDateString("en-US") : "No expiration set"} />
          </div>
        </section>

        <section className="site-panel rounded-xl p-6">
          <div className="text-lg font-semibold text-zinc-100">Quick Links</div>
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
