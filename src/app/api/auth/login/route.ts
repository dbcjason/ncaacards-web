import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, createSessionForUser, logUsageEvent, SESSION_COOKIE_NAME } from "@/lib/auth";

function redirectWithMessage(req: NextRequest, kind: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const nextPath = String(form.get("next") || "").trim();

    if (!email || !password) {
      return redirectWithMessage(req, "error", "Enter your email and password.");
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return redirectWithMessage(req, "error", "That email/password combination was not recognized.");
    }

    const session = await createSessionForUser(user.id);
    await logUsageEvent({
      organizationId: user.organization_id,
      userId: user.id,
      eventType: "login",
      email: user.email,
      path: nextPath || "/cards",
      source: "password_login",
    });

    const url = req.nextUrl.clone();
    url.pathname = nextPath || (user.role === "admin" ? "/dashboard" : "/cards");
    url.search = nextPath ? url.search : "";
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("[auth] login failed", error);
    return redirectWithMessage(req, "error", "Login hit a temporary server issue. Please try again.");
  }
}
