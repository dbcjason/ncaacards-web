"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  canViewMen: boolean;
  canViewWomen: boolean;
  isAdmin: boolean;
};

export default function HeaderUserNav({ canViewMen, canViewWomen, isAdmin }: Props) {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <div className="flex items-center gap-5 text-sm text-zinc-300">
      {canViewMen && <Link href="/cards?gender=men" className="hover:text-white">Men</Link>}
      {canViewWomen && <Link href="/cards?gender=women" className="hover:text-white">Women</Link>}
      {isAdmin && <Link href="/dashboard" className="hover:text-white">Admin Dashboard</Link>}
      <Link href="/profile" className="hover:text-white">Profile</Link>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="hover:text-white">Sign Out</button>
      </form>
    </div>
  );
}
