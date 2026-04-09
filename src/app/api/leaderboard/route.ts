import { NextRequest, NextResponse } from "next/server";
import { canAccessGenderScope, requireUser } from "@/lib/auth";
import {
  isLeaderboardMetric,
  parseLeaderboardGenderFilter,
  queryLeaderboard,
  type LeaderboardFilter,
} from "@/lib/leaderboard";

function parseFilters(raw: unknown): LeaderboardFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: LeaderboardFilter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const metric = String((item as Record<string, unknown>).metric ?? "");
    const isSpecial = metric === "age" || metric === "rsci" || metric === "draft_pick";
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
      draftedPlus2026?: boolean;
    };

    const gender = parseLeaderboardGenderFilter(body.gender);
    if (gender === "all") {
      if (
        !canAccessGenderScope(user.access_scope, "men") &&
        !canAccessGenderScope(user.access_scope, "women")
      ) {
        throw new Error("FORBIDDEN_SCOPE");
      }
      if (
        !canAccessGenderScope(user.organization_access_scope, "men") &&
        !canAccessGenderScope(user.organization_access_scope, "women")
      ) {
        throw new Error("FORBIDDEN_SCOPE");
      }
    } else if (
      !canAccessGenderScope(user.access_scope, gender) ||
      !canAccessGenderScope(user.organization_access_scope, gender)
    ) {
      throw new Error("FORBIDDEN_SCOPE");
    }

    const rawSeason = body.season;
    const parsedSeason =
      rawSeason === null || rawSeason === undefined || String(rawSeason).trim() === ""
        ? null
        : Number.isFinite(Number(rawSeason))
          ? Number(rawSeason)
          : null;

    const result = await queryLeaderboard({
      gender,
      season: parsedSeason,
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
      draftedPlus2026: Boolean(body.draftedPlus2026),
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
