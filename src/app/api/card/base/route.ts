import { NextRequest, NextResponse } from "next/server";
import { loadStaticPayload } from "@/lib/static-payload";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { season: number; team: string; player: string };
    const season = Number(body.season);
    const team = String(body.team ?? "");
    const player = String(body.player ?? "");

    const payload = await loadStaticPayload(season, team, player);
    const sections = (payload.sections_html ?? {}) as Record<string, unknown>;

    // Return instant/base payload now; heavy sections are requested separately.
    const basePayload = {
      ...payload,
      sections_html: {
        ...sections,
        player_comparisons_html:
          '<div class="panel"><h3>Player Comparisons</h3><div class="shot-meta">Loading comparisons…</div></div>',
        draft_projection_html:
          '<div class="panel draft-proj-panel"><h3>Statistical NBA Draft Projection</h3><div class="shot-meta">Loading projection…</div></div>',
      },
    };

    return NextResponse.json({ ok: true, payload: basePayload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

