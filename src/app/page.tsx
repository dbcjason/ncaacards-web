import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { HomeNoticePopup } from "@/components/home-notice-popup";

type HomePageProps = {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    next?: string;
    tab?: string;
    code?: string;
    email?: string;
    popup?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);

  if (user) {
    redirect(user.role === "admin" ? "/dashboard" : "/cards");
  }

  const activeTab =
    params.tab === "create-account" || params.tab === "request-access"
      ? params.tab
      : "sign-in";

  return (
    <div className="flex min-h-[calc(100vh-77px)] items-center justify-center px-6 py-12">
      <HomeNoticePopup notice={String(params.notice || "")} popup={String(params.popup || "") === "1"} />
      <div className="site-panel w-full max-w-md rounded-xl p-6">
        {(params.notice || params.error) && (
          <div className={`mb-4 rounded-md px-4 py-3 text-sm ${params.error ? "bg-rose-950 text-rose-200" : "bg-emerald-950 text-emerald-200"}`}>
            {params.error || params.notice}
          </div>
        )}

        <div className="mb-4 flex gap-2">
          <Link href="/?tab=create-account" className="site-button-secondary">Create Your Account</Link>
          <Link href="/?tab=request-access" className="site-button-secondary">Request An Access Code</Link>
        </div>

        {activeTab === "sign-in" && (
          <form action="/api/auth/login" method="post" className="space-y-4">
            <input type="hidden" name="next" value={params.next || ""} />
            <input className="site-input" name="email" type="email" placeholder="Email" defaultValue={params.email || ""} required />
            <input className="site-input" name="password" type="password" placeholder="Password" required />
            <button type="submit" className="site-button w-full">Log In</button>
          </form>
        )}

        {activeTab === "create-account" && (
          <div className="space-y-4">
            <form action="/api/auth/signup" method="post" className="space-y-4">
              <input className="site-input" name="email" type="email" placeholder="Email" defaultValue={params.email || ""} required />
              <input className="site-input" name="password" type="password" placeholder="Create Password" required />
              <input
                className="site-input"
                name="accessCode"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="6-digit access code"
                defaultValue={params.code || ""}
                required
              />
              <button type="submit" className="site-button w-full">Create Account</button>
            </form>
            <Link href="/" className="site-button-secondary block text-center">Back to Log-In</Link>
          </div>
        )}

        {activeTab === "request-access" && (
          <div className="space-y-4">
            <form action="/api/access-requests" method="post" className="space-y-4">
              <input className="site-input" name="email" type="email" placeholder="Email" required />
              <input className="site-input" name="organization" type="text" placeholder="Organization" required />
              <input className="site-input" name="requesterName" type="text" placeholder="Who are you?" required />
              <textarea className="site-input min-h-28" name="notes" placeholder="Anything else we should know?" />
              <button type="submit" className="site-button w-full">Request Access Code</button>
            </form>
            <Link href="/" className="site-button-secondary block text-center">Back to Log-In</Link>
          </div>
        )}
      </div>
    </div>
  );
}
