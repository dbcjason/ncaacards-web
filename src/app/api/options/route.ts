import { NextRequest, NextResponse } from "next/server";
import { assertGenderAccess, requireUser } from "@/lib/auth";
import { getSeasonOptions } from "@/lib/options";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const seasonStr = req.nextUrl.searchParams.get("season") ?? "2026";
    const season = Number(seasonStr);
    const team = req.nextUrl.searchParams.get("team") ?? "";
    const gender = req.nextUrl.searchParams.get("gender") ?? "men";
    assertGenderAccess(user, gender === "women" ? "women" : "men");
    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ ok: false, error: "Invalid season" }, { status: 400 });
    }

    const data = await getSeasonOptions(season, gender);
    if (team) {
      return NextResponse.json({
        ok: true,
        season,
        gender,
        team,
        players: data.playersByTeam[team] ?? [],
      });
    }
    return NextResponse.json({
      ok: true,
      season,
      gender,
      teams: data.teams,
      allPlayers: data.allPlayers,
      playersByTeam: data.playersByTeam,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
