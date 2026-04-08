import "server-only";

import { dbQuery } from "@/lib/db";

export type LeaderboardGender = "men" | "women";
export type LeaderboardGenderFilter = LeaderboardGender | "all";

export type LeaderboardMetricKey =
  | "ppg"
  | "rpg"
  | "apg"
  | "spg"
  | "bpg"
  | "usg"
  | "fg_pct"
  | "ts_pct"
  | "twop_pct"
  | "rim_pct"
  | "rim_att_100"
  | "dunks_100"
  | "mid_pct"
  | "tp_pct"
  | "tpa_100"
  | "ftr"
  | "ast_pct"
  | "rim_assts_100"
  | "ato"
  | "to_pct"
  | "uasst_dunks_100"
  | "uasst_rim_fgm_100"
  | "uasst_mid_fgm_100"
  | "uasst_3pm_100"
  | "unassisted_pts_100"
  | "stl_pct"
  | "blk_pct"
  | "oreb_pct"
  | "dreb_pct"
  | "bpm"
  | "rapm"
  | "obpm"
  | "dbpm"
  | "net_points"
  | "onoff_net";

export const LEADERBOARD_METRICS: ReadonlyArray<{
  key: LeaderboardMetricKey;
  label: string;
}> = [
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "spg", label: "SPG" },
  { key: "bpg", label: "BPG" },
  { key: "usg", label: "Usage" },
  { key: "fg_pct", label: "FG%" },
  { key: "ts_pct", label: "TS%" },
  { key: "twop_pct", label: "2P%" },
  { key: "rim_pct", label: "Rim%" },
  { key: "rim_att_100", label: "Rim Att/100" },
  { key: "dunks_100", label: "Dunks/100" },
  { key: "mid_pct", label: "Mid%" },
  { key: "tp_pct", label: "3P%" },
  { key: "tpa_100", label: "3PA/100" },
  { key: "ftr", label: "FTr" },
  { key: "ast_pct", label: "AST%" },
  { key: "rim_assts_100", label: "Rim Assts/100" },
  { key: "ato", label: "A/TO" },
  { key: "to_pct", label: "TO%" },
  { key: "uasst_dunks_100", label: "UAsst'd Dunks/100" },
  { key: "uasst_rim_fgm_100", label: "UAsst'd Rim FGM/100" },
  { key: "uasst_mid_fgm_100", label: "UAsst'd Mid FGM/100" },
  { key: "uasst_3pm_100", label: "UAsst'd 3PM/100" },
  { key: "unassisted_pts_100", label: "Unassisted Pts/100" },
  { key: "stl_pct", label: "STL%" },
  { key: "blk_pct", label: "BLK%" },
  { key: "oreb_pct", label: "OREB%" },
  { key: "dreb_pct", label: "DREB%" },
  { key: "bpm", label: "BPM" },
  { key: "rapm", label: "RAPM" },
  { key: "obpm", label: "OBPM" },
  { key: "dbpm", label: "DBPM" },
  { key: "net_points", label: "Net Points" },
  { key: "onoff_net", label: "On/Off Net" },
] as const;

export type LeaderboardFilter = {
  metric: LeaderboardMetricKey | "age" | "rsci";
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
  minutes_per_game: number | null;
  updated_at: string;
};

type RawLeaderboardRow = Omit<LeaderboardRow, "values" | "percentiles"> & {
  values: unknown;
  percentiles: unknown;
  payload_json?: unknown;
  grade_boxes_html?: string | null;
  bt_row?: unknown;
  bt_percentiles_html?: string | null;
  self_creation_html?: string | null;
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
    if (typeof raw === "string" && raw.trim() === "") {
      out[key] = null;
      continue;
    }
    const num = Number(raw);
    out[key] = Number.isFinite(num) ? num : null;
  }
  return out;
}

function numericOrNull(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeAnyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStatKey(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function decodeHtmlEntities(text: string): string {
  return String(text || "")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

const METRIC_BT_ALIASES: Record<LeaderboardMetricKey, string[]> = {
  ppg: ["ppg", "pts"],
  rpg: ["rpg", "treb", "reb"],
  apg: ["apg", "ast"],
  spg: ["spg", "stl"],
  bpg: ["bpg", "blk"],
  usg: ["usg", "usage", "usagepct", "usg_pct", "usgper"],
  fg_pct: ["fgpct", "fg%", "efg", "efg_pct", "efg%"],
  ts_pct: ["tspct", "ts%", "ts_per", "tsp"],
  twop_pct: ["2ppct", "2p%", "2ptpct", "2pt%", "twop_pct", "twoppct"],
  rim_pct: ["rimpct", "rim%", "rimfgpct", "rimfg%"],
  rim_att_100: ["rimatt100", "rimatt/100", "rimatt", "rimfga100", "rimfga/100"],
  dunks_100: ["dunks100", "dunks/100", "dunk100"],
  mid_pct: ["midpct", "mid%", "midfgpct", "midfg%"],
  tp_pct: ["3ppct", "3p%", "tp_per", "3ptpct", "3pt%"],
  tpa_100: ["3pa100", "3pa/100", "3p100", "3p/100"],
  ftr: ["ftr", "ftrate", "ftratio"],
  ast_pct: ["astpct", "ast%", "ast_per"],
  rim_assts_100: ["rimassts100", "rimassts/100", "rimast100", "rimast/100"],
  ato: ["asttov", "a/to", "ato"],
  to_pct: ["topct", "to%", "to_per"],
  uasst_dunks_100: ["uasstdunks100", "uasstdunks/100", "unassisteddunks100"],
  uasst_rim_fgm_100: ["uasstrimfgm100", "uasstrimfgm/100", "unassistedrimfgm100"],
  uasst_mid_fgm_100: ["uasstmidfgm100", "uasstmidfgm/100", "unassistedmidfgm100"],
  uasst_3pm_100: ["uasst3pm100", "uasst3pm/100", "unassisted3pm100"],
  unassisted_pts_100: ["unassistedpts100", "unassistedpts/100"],
  stl_pct: ["stlpct", "stl%", "stl_per"],
  blk_pct: ["blkpct", "blk%", "blk_per"],
  oreb_pct: ["orebpct", "oreb%", "orb_per"],
  dreb_pct: ["drebpct", "dreb%", "drb_per"],
  bpm: ["bpm", "gbpm"],
  rapm: ["rapm", "epm", "rpm"],
  obpm: ["obpm", "ogbpm"],
  dbpm: ["dbpm", "dgbpm"],
  net_points: ["netpoints", "net_pts", "netrating", "netrtg", "net"],
  onoff_net: ["onoffnet", "onoff", "onoffrating", "onoffrtg", "on_off_net"],
};

function metricValueFromBtRow(btRow: Record<string, unknown>, key: LeaderboardMetricKey): number | null {
  const normalizedMap = new Map<string, number>();
  for (const [rawKey, rawValue] of Object.entries(btRow)) {
    const normalized = normalizeStatKey(rawKey);
    if (!normalized) continue;
    const value = numericOrNull(rawValue);
    if (typeof value === "number") normalizedMap.set(normalized, value);
  }
  for (const alias of METRIC_BT_ALIASES[key] ?? []) {
    const found = normalizedMap.get(normalizeStatKey(alias));
    if (typeof found === "number") return found;
  }
  return null;
}

function mapHtmlMetricLabelToKey(rawLabel: string): LeaderboardMetricKey | null {
  const label = decodeHtmlEntities(rawLabel).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const map: Record<string, LeaderboardMetricKey> = {
    usage: "usg",
    ts: "ts_pct",
    tspercent: "ts_pct",
    "2p": "twop_pct",
    "2ppercent": "twop_pct",
    rim: "rim_pct",
    rimpercent: "rim_pct",
    rimatt100: "rim_att_100",
    dunks100: "dunks_100",
    mid: "mid_pct",
    midpercent: "mid_pct",
    "3p": "tp_pct",
    "3ppercent": "tp_pct",
    "3pa100": "tpa_100",
    ftr: "ftr",
    ast: "ast_pct",
    astpercent: "ast_pct",
    rimast100: "rim_assts_100",
    rimassts100: "rim_assts_100",
    ato: "ato",
    to: "to_pct",
    topercent: "to_pct",
    stl: "stl_pct",
    stlpercent: "stl_pct",
    blk: "blk_pct",
    blkpercent: "blk_pct",
    oreb: "oreb_pct",
    orebpercent: "oreb_pct",
    dreb: "dreb_pct",
    drebpercent: "dreb_pct",
    bpm: "bpm",
    rapm: "rapm",
    netpts: "net_points",
    onoffnetr: "onoff_net",
    uasstdunks100: "uasst_dunks_100",
    uasstddunks100: "uasst_dunks_100",
    uasstrimfgm100: "uasst_rim_fgm_100",
    uasstdrimfgm100: "uasst_rim_fgm_100",
    uasstmidfgm100: "uasst_mid_fgm_100",
    uasstdmidfgm100: "uasst_mid_fgm_100",
    uasst3pm100: "uasst_3pm_100",
    uasstd3pm100: "uasst_3pm_100",
    unassistedpts100: "unassisted_pts_100",
  };
  return map[label] ?? null;
}

function parseSectionMetricRows(html: string | null | undefined): {
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
} {
  const values: Record<string, number | null> = {};
  const percentiles: Record<string, number | null> = {};
  const source = String(html || "");
  if (!source) return { values, percentiles };
  const rowRegex =
    /<div class="metric-row">[\s\S]*?<div class="metric-label">([^<]+)<\/div>[\s\S]*?<div class="metric-val">([^<]+)<\/div>[\s\S]*?<div class="metric-pct">([^<]+)<\/div>[\s\S]*?<\/div>/g;
  for (const match of source.matchAll(rowRegex)) {
    const key = mapHtmlMetricLabelToKey(String(match[1] || ""));
    if (!key) continue;
    const value = numericOrNull(String(match[2] || "").replace(/%/g, "").trim());
    const pct = numericOrNull(String(match[3] || "").replace(/[^0-9.\-]/g, "").trim());
    if (typeof value === "number") values[key] = value;
    if (typeof pct === "number") percentiles[key] = pct;
  }
  return { values, percentiles };
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

function normalizePositionCode(raw: unknown): string {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return "";
  if (text.includes("PG") || text.includes("POINT GUARD")) return "PG";
  if (text.includes("SG") || text.includes("WING G") || text.includes("GUARD")) return "SG";
  if (text.includes("SF") || text.includes("WING F") || text.includes("FORWARD")) return "SF";
  if (text.includes("PF") || text.includes("BIG F") || text.includes("POWER")) return "PF";
  if (text.includes(" C") || text === "C" || text.includes("CENTER")) return "C";
  return "";
}

export function parseLeaderboardGender(raw?: string): LeaderboardGender {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
}

export function parseLeaderboardGenderFilter(raw?: string): LeaderboardGenderFilter {
  const value = String(raw || "").toLowerCase();
  if (value === "all") return "all";
  return value === "women" ? "women" : "men";
}

export function isLeaderboardMetric(raw?: string): raw is LeaderboardMetricKey {
  return LEADERBOARD_METRICS.some((metric) => metric.key === raw);
}

function normalizeRow(row: RawLeaderboardRow): LeaderboardRow {
  const btRow = safeAnyObject(row.bt_row);
  const sourceValues = safeObject(row.values);
  const sourcePercentiles = safeObject(row.percentiles);
  const parsedBtPercentiles = parseSectionMetricRows(row.bt_percentiles_html);
  const parsedSelfCreation = parseSectionMetricRows(row.self_creation_html);
  const parsedValues = { ...parsedBtPercentiles.values, ...parsedSelfCreation.values };
  const parsedPercentiles = { ...parsedBtPercentiles.percentiles, ...parsedSelfCreation.percentiles };

  const mergedValues: Record<string, number | null> = { ...sourceValues };
  const mergedPercentiles: Record<string, number | null> = { ...sourcePercentiles };

  for (const metric of LEADERBOARD_METRICS) {
    const key = metric.key;
    const parsedValue = parsedValues[key];
    const parsedPercentile = parsedPercentiles[key];
    const currentValue = mergedValues[key];
    const currentPercentile = mergedPercentiles[key];

    const hasParsedValue = typeof parsedValue === "number" && Number.isFinite(parsedValue);
    const hasParsedPercentile = typeof parsedPercentile === "number" && Number.isFinite(parsedPercentile);
    const currentLooksPlaceholder = currentValue == null || currentValue === 0;

    if (hasParsedValue && currentLooksPlaceholder) {
      mergedValues[key] = parsedValue;
    }
    if (hasParsedPercentile && (currentPercentile == null || currentPercentile === 0 || currentValue === 0)) {
      mergedPercentiles[key] = parsedPercentile;
    }

    const nextValue = mergedValues[key];
    if (nextValue == null || !Number.isFinite(Number(nextValue))) {
      const fallback = metricValueFromBtRow(btRow, key);
      if (typeof fallback === "number" && Number.isFinite(fallback)) {
        mergedValues[key] = fallback;
      }
    }
  }

  return {
    ...row,
    pos: normalizePositionCode(row.pos),
    age: numericOrNull(row.age),
    rsci: (() => {
      const value = numericOrNull(row.rsci);
      if (value == null || !Number.isFinite(value)) return null;
      const rounded = Math.round(value);
      return rounded >= 1 && rounded <= 100 ? rounded : null;
    })(),
    statistical_height_delta: numericOrNull(row.statistical_height_delta),
    values: mergedValues,
    percentiles: mergedPercentiles,
    minutes_per_game: numericOrNull(btRow.mp),
  };
}

function applyFilters(rows: LeaderboardRow[], filters: LeaderboardFilter[]): LeaderboardRow[] {
  let next = rows;
  for (const filter of filters) {
    next = next.filter((row) => {
      if (filter.metric === "age") {
        const value = row.age;
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
      }
      if (filter.metric === "rsci") {
        const value = row.rsci;
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
      }
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
    if (sortBy === "player") return a.player.localeCompare(b.player) * direction;
    if (sortBy === "team") return a.team.localeCompare(b.team) * direction;
    if (sortBy === "pos") return a.pos.localeCompare(b.pos) * direction;
    if (sortBy === "height") return a.height.localeCompare(b.height) * direction;
    if (sortBy === "statistical_height") return a.statistical_height.localeCompare(b.statistical_height) * direction;
    if (sortBy === "age") {
      const aVal = a.age ?? Number.NEGATIVE_INFINITY;
      const bVal = b.age ?? Number.NEGATIVE_INFINITY;
      if (aVal !== bVal) return (aVal - bVal) * direction;
    }
    if (sortBy === "rsci") {
      const aVal = a.rsci ?? Number.NEGATIVE_INFINITY;
      const bVal = b.rsci ?? Number.NEGATIVE_INFINITY;
      if (aVal !== bVal) return (aVal - bVal) * direction;
    }
    const teamCmp = a.team.localeCompare(b.team);
    if (teamCmp) return teamCmp;
    return a.player.localeCompare(b.player);
  });
  return out;
}

export async function queryLeaderboard(params: {
  gender: LeaderboardGenderFilter;
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
  minMpg?: number | null;
}) {
  const sqlParams: unknown[] = [];
  const where: string[] = [];
  const rawConferenceFilter = String(params.conference ?? "").trim();
  const conferenceFilterKey = rawConferenceFilter.toLowerCase();
  const highMajorConferences = new Set(["ACC", "Big 12", "Big East", "Big Ten", "SEC"]);

  if (params.gender !== "all") {
    sqlParams.push(params.gender);
    where.push(`l.gender = $${sqlParams.length}`);
  }

  if (Number.isFinite(params.season)) {
    sqlParams.push(params.season);
    where.push(`l.season = $${sqlParams.length}`);
  }
  if (params.team?.trim()) {
    sqlParams.push(`%${params.team.trim()}%`);
    where.push(`l.team ilike $${sqlParams.length}`);
  }
  if (params.player?.trim()) {
    sqlParams.push(`%${params.player.trim()}%`);
    where.push(`l.player ilike $${sqlParams.length}`);
  }
  if (params.position?.trim()) {
    sqlParams.push(`%${params.position.trim()}%`);
    where.push(`l.pos ilike $${sqlParams.length}`);
  }
  if (
    rawConferenceFilter &&
    conferenceFilterKey !== "all" &&
    conferenceFilterKey !== "high major" &&
    conferenceFilterKey !== "mid/low major"
  ) {
    sqlParams.push(`%${rawConferenceFilter}%`);
    where.push(`l.conference ilike $${sqlParams.length}`);
  }

  const rows = await dbQuery<RawLeaderboardRow>(
    `select
        l.gender,
        l.season,
        l.team,
        l.player,
        l.conference,
        l.class,
        l.pos,
        l.age,
        l.height,
        l.statistical_height,
        l.statistical_height_delta,
        l.rsci,
        l.values,
        l.percentiles,
        l.bt_row,
        p.payload_json -> 'sections_html' ->> 'bt_percentiles_html' as bt_percentiles_html,
        p.payload_json -> 'sections_html' ->> 'self_creation_html' as self_creation_html,
        l.updated_at
      from public.leaderboard_player_stats l
      left join public.player_payload_index p
        on p.gender = l.gender
       and p.season = l.season
       and p.team = l.team
       and p.player = l.player
      where ${where.length ? where.join(" and ") : "true"}
      order by l.season desc, l.team asc, l.player asc`,
    sqlParams,
  );

  let normalized = rows.map(normalizeRow);
  const minMpg = Number.isFinite(Number(params.minMpg)) ? Number(params.minMpg) : 10;
  normalized = normalized.filter((row) => {
    if (!Number.isFinite(minMpg) || minMpg <= 0) return true;
    return typeof row.minutes_per_game === "number" && row.minutes_per_game >= minMpg;
  });
  if (conferenceFilterKey === "high major") {
    normalized = normalized.filter((row) => highMajorConferences.has(String(row.conference || "").trim()));
  } else if (conferenceFilterKey === "mid/low major") {
    normalized = normalized.filter((row) => {
      const conference = String(row.conference || "").trim();
      return conference.length > 0 && !highMajorConferences.has(conference);
    });
  }
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
    minMpg,
  };
}

export async function fetchWatchlistStats(params: {
  userId: string;
  gender: LeaderboardGender;
  season: number;
  listId?: string;
}) {
  const hasListId = Boolean(String(params.listId ?? "").trim());
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
        ${hasListId ? "and w.watchlist_id = $4" : ""}
      order by w.sort_order asc, w.created_at asc`,
    hasListId
      ? [params.userId, params.gender, params.season, params.listId]
      : [params.userId, params.gender, params.season],
  );

  return rows.map((row): WatchlistRow => {
    const normalized = normalizeRow(row);
    const { pos: _ignoredPos, ...normalizedRest } = normalized;
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
      ...normalizedRest,
      height: normalized.height || String(payloadBio.height ?? ""),
      values: mergeValueMaps(normalized.values, payloadValues),
      percentiles: mergeValueMaps(normalized.percentiles, payloadPercentiles),
      pos: normalizePositionCode(normalized.pos || payloadBio.position),
      grades: parseGradeBoxesHtml(row.grade_boxes_html),
    };
  });
}
