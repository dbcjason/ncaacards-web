import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { buildCardPayload } from "@/lib/mock";

type CardRequest = {
  season: number;
  team: string;
  player: string;
  mode: "draft" | "transfer";
  destinationConference?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CardRequest;
  const key = `card:${body.season}:${body.team}:${body.player}:${body.mode}:${body.destinationConference ?? ""}`;

  const cached = await cacheGet(key);
  if (cached) return NextResponse.json({ ...cached, cache: "hit" });

  const payload = buildCardPayload(body);
  await cacheSet(key, payload, 60 * 60 * 24);
  return NextResponse.json({ ...payload, cache: "miss" });
}

