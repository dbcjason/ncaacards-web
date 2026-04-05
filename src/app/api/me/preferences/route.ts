import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      ok: true,
      favoriteTeam: user.effective_favorite_team || "",
      favoriteConference: user.effective_favorite_conference || "SEC",
      userFavoriteTeam: user.favorite_team || "",
      organizationFavoriteTeam: user.organization_favorite_team || "",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN_SCOPE" || message === "FORBIDDEN" || message === "ACCOUNT_EXPIRED"
          ? 403
          : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
