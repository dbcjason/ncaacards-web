import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "DBCJASON-NCAAM",
  description: "Player Profiles and Roster Construction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const userPromise = getCurrentUser();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="app-shell min-h-full flex flex-col">
        <AppChrome userPromise={userPromise}>{children}</AppChrome>
      </body>
    </html>
  );
}

async function AppChrome({
  userPromise,
  children,
}: {
  userPromise: ReturnType<typeof getCurrentUser>;
  children: React.ReactNode;
}) {
  const user = await userPromise;

  return (
    <>
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <Link href={user ? "/cards" : "/"} className="text-sm font-semibold tracking-[0.22em] text-[color:var(--accent-soft)] uppercase">
              DBCJASON
            </Link>
            <div className="text-xs text-[color:var(--muted)]">Player intelligence, roster construction, and portal evals</div>
          </div>
          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <nav className="hidden items-center gap-3 md:flex">
                {user.access_scope !== "women" && <Link className="app-nav-link" href="/cards?gender=men">Men</Link>}
                {user.access_scope !== "men" && <Link className="app-nav-link" href="/cards?gender=women">Women</Link>}
                <Link className="app-nav-link" href={`/transfer-grades?gender=${user.access_scope === "women" ? "women" : "men"}&season=2026`}>Portal</Link>
                {user.role === "admin" && <Link className="app-nav-link" href="/dashboard">Admin Dashboard</Link>}
              </nav>
              <Link href="/profile" className="rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-[color:var(--foreground)]">
                Profile
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="rounded-full border border-[color:var(--border)] px-4 py-2 text-[color:var(--muted)] hover:text-[color:var(--foreground)]" type="submit">
                  Sign Out
                </button>
              </form>
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted)]">Members-only access</div>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </>
  );
}
