import { NextRequest, NextResponse } from "next/server";
import { resolveTeamPlayerForSeason } from "@/lib/options";
import { loadStaticPayload } from "@/lib/static-payload";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { season: number; team: string; player: string; gender?: "men" | "women" };
    const season = Number(body.season);
    const resolved = await resolveTeamPlayerForSeason(
      season,
      String(body.team ?? ""),
      String(body.player ?? ""),
      String(body.gender ?? "men"),
    );

    const payload = await loadStaticPayload(season, resolved.team, resolved.player, String(body.gender ?? "men"));
    return NextResponse.json({ ok: true, payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
