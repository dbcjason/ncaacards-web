import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { cacheVersionTag, isSeasonCacheable } from "@/lib/cache-policy";
import { loadStaticPayload } from "@/lib/static-payload";

function transferEndpointForGender(gender: "men" | "women"): string {
  if (gender === "women") {
    return String(process.env.TRANSFER_MODEL_ENDPOINT_WOMEN ?? process.env.TRANSFER_MODEL_ENDPOINT ?? "").trim();
  }
  return String(process.env.TRANSFER_MODEL_ENDPOINT_MEN ?? process.env.TRANSFER_MODEL_ENDPOINT ?? "").trim();
}

function transferTokenForGender(gender: "men" | "women"): string {
  if (gender === "women") {
    return String(process.env.TRANSFER_MODEL_TOKEN_WOMEN ?? process.env.TRANSFER_MODEL_TOKEN ?? "").trim();
  }
  return String(process.env.TRANSFER_MODEL_TOKEN_MEN ?? process.env.TRANSFER_MODEL_TOKEN ?? "").trim();
}

function transferCacheKey(input: {
  gender: "men" | "women";
  season: number;
  team: string;
  player: string;
  destinationConference: string;
}) {
  return `transfer:${input.gender}:${input.season}:${input.team}:${input.player}:${input.destinationConference}:cv=${cacheVersionTag()}`;
}

async function fetchLiveTransferHtml(input: {
  gender: "men" | "women";
  season: number;
  team: string;
  player: string;
  destinationConference: string;
}): Promise<string> {
  const cacheAllowed = isSeasonCacheable(input.season);
  const cacheKey = transferCacheKey(input);
  if (cacheAllowed) {
    const cached = await cacheGet<{ html?: string }>(cacheKey);
    const html = String(cached?.html ?? "").trim();
    if (html) return html;
  }

  const endpoint = transferEndpointForGender(input.gender);
  if (!endpoint) return "";

  const token = transferTokenForGender(input.gender);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { ok?: boolean; html?: string };
  if (!data?.ok) return "";
  const html = String(data.html ?? "").trim();
  if (!html) return "";
  if (cacheAllowed) {
    await cacheSet(cacheKey, { html }, 60 * 60 * 24);
  }
  return html;
}

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
      const transferHtml = await fetchLiveTransferHtml({
        season: Number(body.season),
        team: String(body.team),
        player: String(body.player),
        gender: body.gender === "women" ? "women" : "men",
        destinationConference: String(body.destinationConference ?? ""),
      });
      return NextResponse.json({
        ok: true,
        part,
        html: transferHtml || String(sections.transfer_projection_html ?? ""),
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
