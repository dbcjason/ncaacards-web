import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

type HomePageProps = {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    next?: string;
    tab?: string;
    code?: string;
    email?: string;
    cancelled?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);

  if (user) {
    redirect(user.role === "admin" ? "/dashboard" : "/cards");
  }

  const activeTab = params.tab === "create-account" ? "create-account" : "sign-in";
  const nextPath = params.next || "";
  const email = params.email || "";
  const accessCode = params.code || "";

  return (
    <div className="auth-page min-h-screen px-6 py-10 text-[color:var(--foreground)]">
      <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[32px] border border-[color:var(--border)] bg-[color:var(--surface)] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.18)] lg:p-12">
          <div className="text-xs font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-soft)]">DBCJASON.COM</div>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-[color:var(--foreground)]">
            Secure player intelligence for programs that need access controlled at the organization level.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[color:var(--muted)]">
            Sign in to reach the player-card tools, transfer portal grades, roster construction, and the rest of the locked site.
            New accounts require a one-time six-digit access code generated from your admin dashboard.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <InfoTile title="Organization Lock" copy="Every user belongs to an organization with its own expiration date, payment status, and access scope." />
            <InfoTile title="Segmented Access" copy="Grant men-only, women-only, or full-site access without creating separate products." />
            <InfoTile title="One-Time Codes" copy="Every invite code is single-use, so you keep full control over who can sign up." />
          </div>
        </section>

        <section className="rounded-[32px] border border-[color:var(--border)] bg-[color:var(--panel)] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.16)] lg:p-10">
          <div className="mb-6 flex gap-2 rounded-full bg-black/10 p-1">
            <a href="#sign-in" className={`auth-tab ${activeTab === "sign-in" ? "auth-tab-active" : ""}`}>Sign In</a>
            <a href="#create-account" className={`auth-tab ${activeTab === "create-account" ? "auth-tab-active" : ""}`}>Create Account</a>
          </div>

          {params.notice && <Banner tone="success">{params.notice}</Banner>}
          {params.error && <Banner tone="error">{params.error}</Banner>}
          {params.cancelled === "1" && <Banner tone="error">Payment was cancelled before signup completed.</Banner>}

          <div className="space-y-10">
            <form id="sign-in" action="/api/auth/login" method="post" className="space-y-4">
              <div>
                <div className="text-sm font-medium text-[color:var(--foreground)]">Member Sign In</div>
                <div className="mt-1 text-sm text-[color:var(--muted)]">Use the email and password tied to your organization account.</div>
              </div>
              <input type="hidden" name="next" value={nextPath} />
              <Field label="Email">
                <input name="email" type="email" required className="auth-input" placeholder="you@organization.com" defaultValue={email} />
              </Field>
              <Field label="Password">
                <input name="password" type="password" required className="auth-input" placeholder="Enter password" />
              </Field>
              <button type="submit" className="primary-button w-full">Sign In</button>
            </form>

            <form id="create-account" action="/api/auth/signup" method="post" className="space-y-4 border-t border-[color:var(--border)] pt-8">
              <div>
                <div className="text-sm font-medium text-[color:var(--foreground)]">Create Account With Access Code</div>
                <div className="mt-1 text-sm text-[color:var(--muted)]">
                  Your organization administrator needs to give you a one-time six-digit code before you can sign up.
                </div>
              </div>
              <Field label="Organization Email">
                <input name="email" type="email" required className="auth-input" placeholder="you@organization.com" defaultValue={email} />
              </Field>
              <Field label="Create Password">
                <input name="password" type="password" required className="auth-input" placeholder="Choose a password" />
              </Field>
              <Field label="One-Time Access Code">
                <input
                  name="accessCode"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  className="auth-input tracking-[0.35em]"
                  placeholder="123456"
                  defaultValue={accessCode}
                />
              </Field>
              <button type="submit" className="primary-button w-full">Create Account</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoTile({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <div className="text-sm font-semibold text-[color:var(--foreground)]">{title}</div>
      <div className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{copy}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[color:var(--foreground)]">{label}</span>
      {children}
    </label>
  );
}

function Banner({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return (
    <div className={`mb-4 rounded-2xl px-4 py-3 text-sm ${tone === "success" ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>
      {children}
    </div>
  );
}
