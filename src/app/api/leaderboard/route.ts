import { NextRequest, NextResponse } from "next/server";
import { assertGenderAccess, requireUser } from "@/lib/auth";
import {
  isLeaderboardMetric,
  parseLeaderboardGender,
  queryLeaderboard,
  type LeaderboardFilter,
} from "@/lib/leaderboard";

function parseFilters(raw: unknown): LeaderboardFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: LeaderboardFilter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const metric = String((item as Record<string, unknown>).metric ?? "");
    const isSpecial = metric === "age" || metric === "rsci";
    if (!isSpecial && !isLeaderboardMetric(metric)) continue;
    const value = Number((item as Record<string, unknown>).value ?? "");
    if (!Number.isFinite(value)) continue;
    out.push({
      metric,
      comparator: String((item as Record<string, unknown>).comparator ?? "") === "<=" ? "<=" : ">=",
      value,
      mode:
        !isSpecial && String((item as Record<string, unknown>).mode ?? "") === "percentile"
          ? "percentile"
          : "stat",
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      gender?: string;
      season?: number | string;
      team?: string;
      player?: string;
      position?: string;
      conference?: string;
      filters?: unknown;
      sortBy?: string;
      sortDir?: "asc" | "desc";
      sortMode?: "stat" | "percentile";
      limit?: number;
      minMpg?: number;
    };

    const gender = parseLeaderboardGender(body.gender);
    assertGenderAccess(user, gender);

    const result = await queryLeaderboard({
      gender,
      season: Number.isFinite(Number(body.season)) ? Number(body.season) : null,
      team: String(body.team ?? ""),
      player: String(body.player ?? ""),
      position: String(body.position ?? ""),
      conference: String(body.conference ?? ""),
      filters: parseFilters(body.filters),
      sortBy: String(body.sortBy ?? ""),
      sortDir: body.sortDir === "asc" ? "asc" : "desc",
      sortMode: body.sortMode === "percentile" ? "percentile" : "stat",
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : 500,
      minMpg: Number.isFinite(Number(body.minMpg)) ? Number(body.minMpg) : 10,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN_SCOPE" || message === "FORBIDDEN"
          ? 403
          : message === "ACCOUNT_EXPIRED"
            ? 403
            : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
