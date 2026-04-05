import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser, updateOrganizationFavoriteTeam } from "@/lib/auth";

function redirectDashboard(req: NextRequest, messageType: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  url.searchParams.set("tab", "accounts");
  url.searchParams.set(messageType, message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  await requireAdminUser();
  const form = await req.formData();
  try {
    const organizationId = String(form.get("organizationId") || "").trim();
    const organizationName = String(form.get("organizationName") || "").trim();
    const favoriteTeam = String(form.get("favoriteTeam") || "").trim();
    if (!organizationId) {
      throw new Error("Organization id is required.");
    }
    await updateOrganizationFavoriteTeam(organizationId, favoriteTeam);
    return redirectDashboard(
      req,
      "notice",
      favoriteTeam
        ? `Favorite team for ${organizationName || "organization"} updated to ${favoriteTeam}.`
        : `Favorite team cleared for ${organizationName || "organization"}.`,
    );
  } catch (error) {
    return redirectDashboard(req, "error", error instanceof Error ? error.message : "Could not update organization favorite team.");
  }
}
