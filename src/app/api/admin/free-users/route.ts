import { NextRequest, NextResponse } from "next/server";
import { createFreeUser, normalizeAccessScope, requireAdminUser, resolveFavoriteConference } from "@/lib/auth";

function redirectDashboard(req: NextRequest, tab: string, kind: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  url.searchParams.set("tab", tab);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  await requireAdminUser();
  const form = await req.formData();
  try {
    const organizationId = String(form.get("organizationId") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const favoriteTeam = String(form.get("favoriteTeam") || "").trim();
    if (!organizationId || !email || !password) {
      throw new Error("Organization, email, and password are required.");
    }

    await createFreeUser({
      organizationId,
      email,
      password,
      accessScope: normalizeAccessScope(String(form.get("accessScope") || "both")),
      favoriteTeam,
      favoriteConference: favoriteTeam ? await resolveFavoriteConference(favoriteTeam) : null,
      expiresAt: String(form.get("expiresAt") || "").trim() || null,
    });

    return redirectDashboard(req, "accounts", "notice", `Free account created for ${email}.`);
  } catch (error) {
    return redirectDashboard(req, "accounts", "error", error instanceof Error ? error.message : "Could not create free account.");
  }
}
