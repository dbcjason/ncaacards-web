import "server-only";

import { dbQuery } from "@/lib/db";

export type LeaderboardGender = "men" | "women";

export type LeaderboardMetricKey =
  | "ppg"
  | "rpg"
  | "apg"
  | "spg"
  | "bpg"
  | "fg_pct"
  | "ts_pct"
  | "tp_pct"
  | "tpa_100"
  | "ftr"
  | "ast_pct"
  | "ato"
  | "to_pct"
  | "stl_pct"
  | "blk_pct"
  | "oreb_pct"
  | "dreb_pct"
  | "bpm"
  | "rapm"
  | "obpm"
  | "dbpm";

export const LEADERBOARD_METRICS: ReadonlyArray<{
  key: LeaderboardMetricKey;
  label: string;
}> = [
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "spg", label: "SPG" },
  { key: "bpg", label: "BPG" },
  { key: "fg_pct", label: "FG%" },
  { key: "ts_pct", label: "TS%" },
  { key: "tp_pct", label: "3P%" },
  { key: "tpa_100", label: "3PA/100" },
  { key: "ftr", label: "FTr" },
  { key: "ast_pct", label: "AST%" },
  { key: "ato", label: "A/TO" },
  { key: "to_pct", label: "TO%" },
  { key: "stl_pct", label: "STL%" },
  { key: "blk_pct", label: "BLK%" },
  { key: "oreb_pct", label: "OREB%" },
  { key: "dreb_pct", label: "DREB%" },
  { key: "bpm", label: "BPM" },
  { key: "rapm", label: "RAPM" },
  { key: "obpm", label: "OBPM" },
  { key: "dbpm", label: "DBPM" },
] as const;

export type LeaderboardFilter = {
  metric: LeaderboardMetricKey;
  comparator: ">=" | "<=";
  value: number;
  mode: "stat" | "percentile";
};

export type LeaderboardRow = {
  gender: LeaderboardGender;
  season: number;
  team: string;
  player: string;
  conference: string;
  class: string;
  pos: string;
  age: number | null;
  height: string;
  statistical_height: string;
  statistical_height_delta: number | null;
  rsci: number | null;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
  updated_at: string;
};

type RawLeaderboardRow = Omit<LeaderboardRow, "values" | "percentiles"> & {
  values: unknown;
  percentiles: unknown;
  payload_json?: unknown;
  grade_boxes_html?: string | null;
};

export type WatchlistGrade = {
  label: string;
  value: string;
};

export type WatchlistRow = LeaderboardRow & {
  id: string;
  sort_order: number;
  grades: WatchlistGrade[];
};

function safeObject(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = Number(raw);
    out[key] = Number.isFinite(num) ? num : null;
  }
  return out;
}

function numericOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeAnyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseGradeBoxesHtml(raw: string | null | undefined): WatchlistGrade[] {
  const html = String(raw ?? "");
  if (!html) return [];
  const matches = [...html.matchAll(/<div class="grade-k">([^<]+)<\/div><div class="grade-v">([^<]+)<\/div>/g)];
  return matches.map((match) => ({
    label: String(match[1] ?? "").trim(),
    value: String(match[2] ?? "").trim(),
  }));
}

function mergeValueMaps(primary: Record<string, number | null>, fallback: Record<string, number | null>) {
  return { ...fallback, ...primary };
}

export function parseLeaderboardGender(raw?: string): LeaderboardGender {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
}

export function isLeaderboardMetric(raw?: string): raw is LeaderboardMetricKey {
  return LEADERBOARD_METRICS.some((metric) => metric.key === raw);
}

function normalizeRow(row: RawLeaderboardRow): LeaderboardRow {
  return {
    ...row,
    age: numericOrNull(row.age),
    rsci: numericOrNull(row.rsci),
    statistical_height_delta: numericOrNull(row.statistical_height_delta),
    values: safeObject(row.values),
    percentiles: safeObject(row.percentiles),
  };
}

function applyFilters(rows: LeaderboardRow[], filters: LeaderboardFilter[]): LeaderboardRow[] {
  let next = rows;
  for (const filter of filters) {
    next = next.filter((row) => {
      const bucket = filter.mode === "percentile" ? row.percentiles : row.values;
      const value = bucket[filter.metric];
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
    });
  }
  return next;
}

function sortRows(
  rows: LeaderboardRow[],
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  sortMode: "stat" | "percentile" = "stat",
): LeaderboardRow[] {
  const out = [...rows];
  const direction = sortDir === "asc" ? 1 : -1;
  out.sort((a, b) => {
    if (sortBy && isLeaderboardMetric(sortBy)) {
      const bucketA = sortMode === "percentile" ? a.percentiles : a.values;
      const bucketB = sortMode === "percentile" ? b.percentiles : b.values;
      const aVal = bucketA[sortBy];
      const bVal = bucketB[sortBy];
      if (typeof aVal === "number" && typeof bVal === "number" && aVal !== bVal) {
        return (aVal - bVal) * direction;
      }
    }
    const teamCmp = a.team.localeCompare(b.team);
    if (teamCmp) return teamCmp;
    return a.player.localeCompare(b.player);
  });
  return out;
}

export async function queryLeaderboard(params: {
  gender: LeaderboardGender;
  season?: number | null;
  team?: string;
  player?: string;
  position?: string;
  conference?: string;
  filters?: LeaderboardFilter[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  sortMode?: "stat" | "percentile";
  limit?: number;
}) {
  const sqlParams: unknown[] = [params.gender];
  const where: string[] = ["gender = $1"];

  if (Number.isFinite(params.season)) {
    sqlParams.push(params.season);
    where.push(`season = $${sqlParams.length}`);
  }
  if (params.team?.trim()) {
    sqlParams.push(`%${params.team.trim()}%`);
    where.push(`team ilike $${sqlParams.length}`);
  }
  if (params.player?.trim()) {
    sqlParams.push(`%${params.player.trim()}%`);
    where.push(`player ilike $${sqlParams.length}`);
  }
  if (params.position?.trim()) {
    sqlParams.push(`%${params.position.trim()}%`);
    where.push(`pos ilike $${sqlParams.length}`);
  }
  if (params.conference?.trim()) {
    sqlParams.push(`%${params.conference.trim()}%`);
    where.push(`conference ilike $${sqlParams.length}`);
  }

  const rows = await dbQuery<RawLeaderboardRow>(
    `select
        gender,
        season,
        team,
        player,
        conference,
        class,
        pos,
        age,
        height,
        statistical_height,
        statistical_height_delta,
        rsci,
        values,
        percentiles,
        updated_at
      from public.leaderboard_player_stats
      where ${where.join(" and ")}
      order by season desc, team asc, player asc`,
    sqlParams,
  );

  let normalized = rows.map(normalizeRow);
  normalized = applyFilters(normalized, Array.isArray(params.filters) ? params.filters : []);
  normalized = sortRows(normalized, params.sortBy, params.sortDir, params.sortMode);

  const limited = normalized.slice(0, Math.max(1, Math.min(2000, params.limit ?? 500)));
  const seasons = Array.from(new Set(normalized.map((row) => row.season))).sort((a, b) => b - a);
  const teams = Array.from(new Set(normalized.map((row) => row.team))).sort((a, b) => a.localeCompare(b));
  const positions = Array.from(new Set(normalized.map((row) => row.pos).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const conferences = Array.from(new Set(normalized.map((row) => row.conference).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    rows: limited,
    total: normalized.length,
    seasons,
    teams,
    positions,
    conferences,
    metrics: LEADERBOARD_METRICS,
  };
}

export async function fetchWatchlistStats(params: {
  userId: string;
  gender: LeaderboardGender;
  season: number;
}) {
  const rows = await dbQuery<
    RawLeaderboardRow & {
      id: string;
      sort_order: number;
    }
  >(
    `select
        w.id,
        w.sort_order,
        coalesce(l.gender, w.gender) as gender,
        coalesce(l.season, w.season) as season,
        coalesce(l.team, w.team) as team,
        coalesce(l.player, w.player) as player,
        coalesce(l.conference, '') as conference,
        coalesce(l.class, '') as class,
        coalesce(l.pos, '') as pos,
        l.age,
        coalesce(l.height, '') as height,
        coalesce(l.statistical_height, '') as statistical_height,
        l.statistical_height_delta,
        l.rsci,
        coalesce(l.values, '{}'::jsonb) as values,
        coalesce(l.percentiles, '{}'::jsonb) as percentiles,
        p.payload_json,
        p.payload_json -> 'sections_html' ->> 'grade_boxes_html' as grade_boxes_html,
        coalesce(l.updated_at, w.updated_at) as updated_at
      from public.watchlist_items w
      left join public.leaderboard_player_stats l
        on l.gender = w.gender
       and l.season = w.season
       and l.team = w.team
       and l.player = w.player
      left join public.player_payload_index p
        on p.gender = w.gender
       and p.season = w.season
       and p.team = w.team
       and p.player = w.player
      where w.user_id = $1
        and w.gender = $2
        and w.season = $3
      order by w.sort_order asc, w.created_at asc`,
    [params.userId, params.gender, params.season],
  );

  return rows.map((row): WatchlistRow => {
    const normalized = normalizeRow(row);
    const payload = safeAnyObject(row.payload_json);
    const payloadBio = safeAnyObject(payload.bio);
    const payloadPerGame = safeAnyObject(payload.per_game);
    const payloadPercentiles = safeObject(payloadPerGame.percentiles);
    const payloadValues = safeObject({
      mpg: payloadPerGame.mpg,
      ppg: payloadPerGame.ppg,
      rpg: payloadPerGame.rpg,
      apg: payloadPerGame.apg,
      spg: payloadPerGame.spg,
      bpg: payloadPerGame.bpg,
      fg_pct: payloadPerGame.fg_pct,
      tp_pct: payloadPerGame.tp_pct,
      ft_pct: payloadPerGame.ft_pct,
    });

    return {
      id: row.id,
      sort_order: row.sort_order,
      ...normalized,
      pos: normalized.pos || String(payloadBio.position ?? ""),
      height: normalized.height || String(payloadBio.height ?? ""),
      values: mergeValueMaps(normalized.values, payloadValues),
      percentiles: mergeValueMaps(normalized.percentiles, payloadPercentiles),
      grades: parseGradeBoxesHtml(row.grade_boxes_html),
    };
  });
}
