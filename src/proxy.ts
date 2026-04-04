import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "dbcjason_session";

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
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value?.trim());
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = new URLSearchParams({ next: `${pathname}${search}` }).toString();
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
