import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { buildRosterPayload } from "@/lib/mock";

type RosterRequest = {
  season: number;
  team: string;
  addPlayers: string[];
  removePlayers: string[];
};

function hashArray(arr: string[]) {
  return arr.slice().sort().join("|");
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RosterRequest;
  const key = `roster:${body.season}:${body.team}:in=${hashArray(body.addPlayers)}:out=${hashArray(body.removePlayers)}`;

  const cached = await cacheGet(key);
  if (cached) return NextResponse.json({ ...cached, cache: "hit" });

  const payload = buildRosterPayload(body);
  await cacheSet(key, payload, 60 * 30);
  return NextResponse.json({ ...payload, cache: "miss" });
}

