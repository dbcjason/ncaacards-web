import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "DBCJASON",
  description: "Player Profiles and Roster Construction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const userPromise = getCurrentUser().catch(() => null);
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-950 text-zinc-100">
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
      <header className="border-b border-zinc-900 bg-black">
        <div className="mx-auto flex w-full max-w-[1900px] items-center justify-between px-6 py-5">
          <div className="space-y-1">
            <Link href={user ? "/cards" : "/"} className="text-[15px] font-semibold tracking-[0.28em] text-white uppercase">
              DBCJASON
            </Link>
          </div>
          {user ? (
            <div className="flex items-center gap-5 text-sm text-zinc-300">
              {user.access_scope !== "women" && <Link href="/cards?gender=men" className="hover:text-white">Men</Link>}
              {user.access_scope !== "men" && <Link href="/cards?gender=women" className="hover:text-white">Women</Link>}
              {user.role === "admin" && <Link href="/dashboard" className="hover:text-white">Admin Dashboard</Link>}
              <Link href="/profile" className="hover:text-white">Profile</Link>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="hover:text-white">Sign Out</button>
              </form>
            </div>
          ) : null}
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
