import { NextRequest, NextResponse } from "next/server";
import { loadStaticPayload } from "@/lib/static-payload";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      season: number;
      team: string;
      player: string;
    };
    const payload = await loadStaticPayload(Number(body.season), String(body.team), String(body.player));
    const sections = (payload.sections_html ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      payload: {
        ...payload,
        sections_html: {
          grade_boxes_html: sections.grade_boxes_html ?? "",
          bt_percentiles_html: sections.bt_percentiles_html ?? "",
          self_creation_html: sections.self_creation_html ?? "",
          playstyles_html: sections.playstyles_html ?? "",
          team_impact_html: sections.team_impact_html ?? "",
          shot_diet_html: sections.shot_diet_html ?? "",
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

