import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CANONICAL_HOST = "www.dbcjason.com";

const PUBLIC_PATHS = new Set([
  "/",
  "/favicon.ico",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/auth/complete-signup")) return true;
  if (pathname.startsWith("/api/access-requests")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/internal/bootstrap-admin")) return true;
  if (pathname.startsWith("/api/internal/payload-sync")) return true;
  if (pathname.startsWith("/api/internal/payload-phase-backup")) return true;
  if (pathname.startsWith("/api/internal/payload-phase-promote")) return true;
  if (pathname.startsWith("/api/health/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

export function proxy(req: NextRequest) {
  const host = String(req.headers.get("host") ?? "").trim().toLowerCase();
  if (host.endsWith(".vercel.app")) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    return NextResponse.redirect(url, 307);
  }
  if (host === "dbcjason.com") {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    return NextResponse.redirect(url, 307);
  }

  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
