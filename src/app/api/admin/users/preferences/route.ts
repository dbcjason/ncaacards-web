import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser, updateUserFavoriteTeam } from "@/lib/auth";

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
    const userId = String(form.get("userId") || "").trim();
    const email = String(form.get("email") || "").trim();
    const favoriteTeam = String(form.get("favoriteTeam") || "").trim();
    if (!userId) {
      throw new Error("User id is required.");
    }
    await updateUserFavoriteTeam(userId, favoriteTeam);
    return redirectDashboard(
      req,
      "notice",
      favoriteTeam
        ? `Favorite team for ${email || "user"} updated to ${favoriteTeam}.`
        : `Favorite team cleared for ${email || "user"}.`,
    );
  } catch (error) {
    return redirectDashboard(req, "error", error instanceof Error ? error.message : "Could not update user favorite team.");
  }
}
