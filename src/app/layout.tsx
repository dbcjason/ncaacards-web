import type { Metadata } from "next";
import Link from "next/link";
import { canAccessGenderScope, getCurrentUser } from "@/lib/auth";
import HeaderUserNav from "@/components/header-user-nav";
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
  const canViewMen = user
    ? canAccessGenderScope(user.access_scope, "men") &&
      canAccessGenderScope(user.organization_access_scope, "men")
    : false;
  const canViewWomen = user
    ? canAccessGenderScope(user.access_scope, "women") &&
      canAccessGenderScope(user.organization_access_scope, "women")
    : false;

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
            <HeaderUserNav canViewMen={canViewMen} canViewWomen={canViewWomen} isAdmin={user.role === "admin"} />
          ) : null}
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
