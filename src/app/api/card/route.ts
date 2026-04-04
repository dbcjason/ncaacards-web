import { NextRequest, NextResponse } from "next/server";
import { assertGenderAccess, logUsageEvent, requireUser } from "@/lib/auth";
import { cacheGet, cacheSet } from "@/lib/cache";
import { buildCardPayload } from "@/lib/mock";

type CardRequest = {
  gender?: "men" | "women";
  season: number;
  team: string;
  player: string;
  mode: "draft" | "transfer";
  destinationConference?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CardRequest;
  const user = await requireUser();
  const gender = body.gender === "women" ? "women" : "men";
  assertGenderAccess(user, gender);
  const key = `card:${body.season}:${body.team}:${body.player}:${body.mode}:${body.destinationConference ?? ""}`;

  const cached = await cacheGet(key);
  if (cached) return NextResponse.json({ ...cached, cache: "hit" });

  const payload = buildCardPayload(body);
  await cacheSet(key, payload, 60 * 60 * 24);
  await logUsageEvent({
    organizationId: user.organization_id,
    userId: user.id,
    eventType: "card_build",
    email: user.email,
    gender,
    season: body.season,
    team: body.team,
    player: body.player,
    path: "/api/card",
    source: body.mode,
  });
  return NextResponse.json({ ...payload, cache: "miss" });
}
