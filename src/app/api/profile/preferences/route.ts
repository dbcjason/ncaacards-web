import { NextRequest, NextResponse } from "next/server";
import { requireUser, updateUserFavoriteTeam } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const favoriteTeam = String(form.get("favoriteTeam") || "").trim();
    await updateUserFavoriteTeam(user.id, favoriteTeam);

    const url = req.nextUrl.clone();
    url.pathname = "/profile";
    url.search = "";
    url.searchParams.set("notice", favoriteTeam ? `Favorite team updated to ${favoriteTeam}.` : "Favorite team cleared.");
    return NextResponse.redirect(url);
  } catch (error) {
    const url = req.nextUrl.clone();
    url.pathname = "/profile";
    url.search = "";
    url.searchParams.set("error", error instanceof Error ? error.message : "Could not update favorite team.");
    return NextResponse.redirect(url);
  }
}
