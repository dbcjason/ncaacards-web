import { NextRequest, NextResponse } from "next/server";
import { loadStaticPayload } from "@/lib/static-payload";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      season: number;
      team: string;
      player: string;
      part: "comparisons" | "draft" | "transfer";
      gender?: "men" | "women";
      destinationConference?: string;
    };
    const payload = await loadStaticPayload(
      Number(body.season),
      String(body.team),
      String(body.player),
      String(body.gender ?? "men"),
    );
    const sections = (payload.sections_html ?? {}) as Record<string, unknown>;
    const part =
      body.part === "draft" ? "draft" : body.part === "transfer" ? "transfer" : "comparisons";

    // Brief stagger so UI progress bars have time to animate.
    await new Promise((res) => setTimeout(res, part === "draft" ? 900 : part === "transfer" ? 500 : 700));

    if (part === "comparisons") {
      return NextResponse.json({
        ok: true,
        part,
        html: String(sections.player_comparisons_html ?? ""),
      });
    }
    if (part === "transfer") {
      return NextResponse.json({
        ok: true,
        part,
        html: String(sections.transfer_projection_html ?? ""),
      });
    }
    return NextResponse.json({
      ok: true,
      part,
      html: String(sections.draft_projection_html ?? ""),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
