import { dbQuery, dbQueryOne } from "@/lib/db";
import {
  getFallbackLineupOptionByKey,
  getFallbackLineupOptions,
} from "@/lib/lineup-analysis-fallback";
import type {
  LineupGender,
  LineupOptionPayload,
  LineupOptionSummary,
  LineupRow,
} from "@/lib/lineup-analysis-types";

type OptionSummaryRow = {
  option_key: string;
  option_label: string;
  season: number;
  team: string;
  lineup_count: number;
};

type OptionDataRow = {
  option_key: string;
  option_label: string;
  season: number;
  team: string;
  players: unknown;
  lineups: unknown;
};

function safeLineups(value: unknown): LineupRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object") as LineupRow[];
}

function safePlayers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function safeSeason(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : 2026;
}

export function parseLineupGender(raw: unknown): LineupGender {
  return String(raw ?? "").toLowerCase() === "women" ? "women" : "men";
}

export async function queryLineupOptions(params: {
  gender?: unknown;
  season?: unknown;
}): Promise<LineupOptionSummary[]> {
  const gender = parseLineupGender(params.gender);
  const season = safeSeason(params.season);
  try {
    const rows = await dbQuery<OptionSummaryRow>(
      `select option_key, option_label, season, team, lineup_count
         from lineup_team_options
        where gender = $1 and season = $2
        order by option_label asc`,
      [gender, season],
    );

    if (!rows.length) {
      return await getFallbackLineupOptions(gender, season);
    }
    return rows.map((row) => ({
      key: String(row.option_key ?? ""),
      label: String(row.option_label ?? ""),
      season: String(row.season ?? season),
      team: String(row.team ?? ""),
      lineupCount: Number(row.lineup_count ?? 0) || 0,
    }));
  } catch {
    return await getFallbackLineupOptions(gender, season);
  }
}

export async function queryLineupOptionData(params: {
  gender?: unknown;
  season?: unknown;
  key?: unknown;
}): Promise<LineupOptionPayload | null> {
  const gender = parseLineupGender(params.gender);
  const season = safeSeason(params.season);
  const key = String(params.key ?? "").trim();
  if (!key) return null;

  try {
    const row = await dbQueryOne<OptionDataRow>(
      `select option_key, option_label, season, team, players, lineups
         from lineup_team_options
        where gender = $1 and season = $2 and option_key = $3
        limit 1`,
      [gender, season, key],
    );
    if (!row) {
      return await getFallbackLineupOptionByKey(gender, season, key);
    }

    return {
      key: String(row.option_key ?? ""),
      label: String(row.option_label ?? ""),
      season: String(row.season ?? season),
      team: String(row.team ?? ""),
      players: safePlayers(row.players),
      lineups: safeLineups(row.lineups),
    };
  } catch {
    return await getFallbackLineupOptionByKey(gender, season, key);
  }
}
