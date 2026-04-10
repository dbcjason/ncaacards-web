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
  | "onoff_net"
  | "feel_plus"
  | "poss_created_100"
  | "rimfluence"
  | "rimfluence_off"
  | "rimfluence_def";

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
  { key: "feel_plus", label: "Feel+" },
  { key: "poss_created_100", label: "Possessions Created/100" },
  { key: "rimfluence", label: "Rimfluence" },
  { key: "rimfluence_off", label: "Off Rimfluence" },
  { key: "rimfluence_def", label: "Def Rimfluence" },
] as const;

export type LeaderboardFilter = {
  metric:
    | LeaderboardMetricKey
    | "age"
    | "rsci"
    | "draft_pick"
    | "minutes_per_game"
    | "height_inches"
    | "statistical_height_inches"
    | "statistical_height_delta";
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

type JasonStatsRow = {
  season: number;
  team: string;
  player: string;
  class_raw: string;
  position_raw: string;
  listed_height: string;
  statistical_height: string;
  height_delta_inches: number | null;
  draft_pick: number | null;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
};

const JASON_CACHE_TTL_MS = 1000 * 60 * 30;
const jasonStatsCache = new Map<LeaderboardGender, { ts: number; rows: JasonStatsRow[] }>();
const RSCI_CACHE_TTL_MS = 1000 * 60 * 30;
const rsciLookupCache = new Map<string, { ts: number; lookup: Record<string, number> }>();
const LEADERBOARD_QUERY_CACHE_TTL_MS = 1000 * 20;
const LEADERBOARD_QUERY_CACHE_MAX = 40;
const leaderboardQueryCache = new Map<string, { ts: number; value: QueryLeaderboardResult }>();
const leaderboardInflight = new Map<string, Promise<QueryLeaderboardResult>>();

export type WatchlistGrade = {
  label: string;
  value: string;
};

export type WatchlistRow = LeaderboardRow & {
  id: string;
  sort_order: number;
  grades: WatchlistGrade[];
};

type QueryLeaderboardResult = {
  rows: LeaderboardRow[];
  total: number;
  seasons: number[];
  teams: string[];
  positions: string[];
  conferences: string[];
  metrics: ReadonlyArray<{
    key: LeaderboardMetricKey;
    label: string;
  }>;
  minMpg: number;
};

function readQueryCache(key: string): QueryLeaderboardResult | null {
  const hit = leaderboardQueryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > LEADERBOARD_QUERY_CACHE_TTL_MS) {
    leaderboardQueryCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeQueryCache(key: string, value: QueryLeaderboardResult): void {
  leaderboardQueryCache.set(key, { ts: Date.now(), value });
  if (leaderboardQueryCache.size <= LEADERBOARD_QUERY_CACHE_MAX) return;
  const oldest = leaderboardQueryCache.keys().next().value;
  if (oldest) leaderboardQueryCache.delete(oldest);
}

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

function parseHeightToInches(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const feetInches = text.match(/(\d+)\s*'\s*(\d{1,2})/);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = Number(feetInches[2]);
    if (Number.isFinite(feet) && Number.isFinite(inches)) return feet * 12 + inches;
  }
  const dashed = text.match(/(\d+)\s*[- ]\s*(\d{1,2})/);
  if (dashed) {
    const feet = Number(dashed[1]);
    const inches = Number(dashed[2]);
    if (Number.isFinite(feet) && Number.isFinite(inches)) return feet * 12 + inches;
  }
  const numeric = numericOrNull(text.replace(/[^0-9.-]+/g, ""));
  return numeric;
}

function normalizeClassValue(value: unknown): "Freshman" | "Sophomore" | "Junior" | "Senior" | "" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (/fresh|frosh|\bfr\b|\brf\b/.test(raw)) return "Freshman";
  if (/soph|\bso\b/.test(raw)) return "Sophomore";
  if (/junior|\bjr\b/.test(raw)) return "Junior";
  if (/senior|\bsr\b|\bgr\b|graduate|\bgrad\b/.test(raw)) return "Senior";
  return "";
}

function classSortRank(value: unknown): number {
  const normalized = normalizeClassValue(value);
  if (normalized === "Freshman") return 1;
  if (normalized === "Sophomore") return 2;
  if (normalized === "Junior") return 3;
  if (normalized === "Senior") return 4;
  return 0;
}

function parseRankValue(value: unknown): number | null {
  const direct = numericOrNull(value);
  if (direct !== null) return direct;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const m = text.match(/\d+/);
  if (!m) return null;
  const parsed = Number(m[0]);
  return Number.isFinite(parsed) ? parsed : null;
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
  twop_pct: ["2ppct", "2p%", "2ptpct", "2pt%", "twop_pct", "twoppct", "twopper"],
  rim_pct: ["rimpct", "rim%", "rimfgpct", "rimfg%", "rimmaderimmaderimmiss"],
  rim_att_100: ["rimatt100", "rimatt/100", "rimatt", "rimfga100", "rimfga/100", "rimattempts100"],
  dunks_100: ["dunks100", "dunks/100", "dunk100", "dunksmissdunksmade"],
  mid_pct: ["midpct", "mid%", "midfgpct", "midfg%", "midmademidmademidmiss"],
  tp_pct: ["3ppct", "3p%", "tp_per", "3ptpct", "3pt%"],
  tpa_100: ["3pa100", "3pa/100", "3p100", "3p/100"],
  ftr: ["ftr", "ftrate", "ftratio"],
  ast_pct: ["astpct", "ast%", "ast_per"],
  rim_assts_100: ["rimassts100", "rimassts/100", "rimast100", "rimast/100", "rimasst100", "rimasst/100"],
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
  net_points: ["netpoints", "net_pts", "netrating", "netrtg", "net", "netpointsr", "netpointsdiff"],
  onoff_net: ["onoffnet", "onoff", "onoffrating", "onoffrtg", "on_off_net", "onoffnetr"],
  feel_plus: ["feelplus"],
  poss_created_100: ["posscreated100", "possessionscreated100", "poss_created_100"],
  rimfluence: ["rimfluence"],
  rimfluence_off: ["rimfluenceoff"],
  rimfluence_def: ["rimfluencedef"],
};

const FRACTION_TO_PERCENT_METRICS = new Set<LeaderboardMetricKey>([
  "fg_pct",
  "ts_pct",
  "twop_pct",
  "rim_pct",
  "mid_pct",
  "tp_pct",
]);

function normalizeMetricScale(key: LeaderboardMetricKey, value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!FRACTION_TO_PERCENT_METRICS.has(key)) return value;
  if (Math.abs(value) <= 1) return value * 100;
  return value;
}

function metricValueFromBtRow(btRow: Record<string, unknown>, key: LeaderboardMetricKey): number | null {
  const normalizedMap = new Map<string, number>();
  for (const [rawKey, rawValue] of Object.entries(btRow)) {
    const normalized = normalizeStatKey(rawKey);
    if (!normalized) continue;
    const value = numericOrNull(rawValue);
    if (typeof value === "number") normalizedMap.set(normalized, value);
  }
  const aliases = METRIC_BT_ALIASES[key] ?? [];
  for (const alias of aliases) {
    const aliasNorm = normalizeStatKey(alias);
    const found = normalizedMap.get(aliasNorm);
    if (typeof found === "number") return found;
  }

  for (const alias of aliases) {
    const aliasNorm = normalizeStatKey(alias);
    for (const [mapKey, mapVal] of normalizedMap.entries()) {
      if (!aliasNorm || !mapKey) continue;
      if (mapKey.includes(aliasNorm) || aliasNorm.includes(mapKey)) {
        return mapVal;
      }
    }
  }

  const read = (...aliasesToRead: string[]) => {
    for (const alias of aliasesToRead) {
      const aliasNorm = normalizeStatKey(alias);
      const direct = normalizedMap.get(aliasNorm);
      if (typeof direct === "number" && Number.isFinite(direct)) return direct;
      for (const [mapKey, mapVal] of normalizedMap.entries()) {
        if (!mapKey || !aliasNorm) continue;
        if (mapKey.includes(aliasNorm) || aliasNorm.includes(mapKey)) return mapVal;
      }
    }
    return null;
  };
  const normalizePct = (value: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.abs(value) <= 1 ? value * 100 : value;
  };

  if (key === "twop_pct") {
    return normalizePct(read("twop_per", "twopper", "twoP_per", "2p_per"));
  }
  if (key === "rim_pct") {
    const ratio = normalizePct(read("rimmade/(rimmade+rimmiss)", "rimpct"));
    if (typeof ratio === "number") return ratio;
    const rimMade = read("rimmade");
    const rimAtt = read("rimmade+rimmiss", "rimattempts");
    if (typeof rimMade === "number" && typeof rimAtt === "number" && rimAtt > 0) {
      return (rimMade / rimAtt) * 100;
    }
  }
  if (key === "mid_pct") {
    const ratio = normalizePct(read("midmade/(midmade+midmiss)", "midpct"));
    if (typeof ratio === "number") return ratio;
    const midMade = read("midmade");
    const midAtt = read("midmade+midmiss", "midattempts");
    if (typeof midMade === "number" && typeof midAtt === "number" && midAtt > 0) {
      return (midMade / midAtt) * 100;
    }
  }
  if (key === "rim_att_100") {
    const direct = read("rimatt100", "rimfga100");
    if (typeof direct === "number") return direct;
    const rimAtt = read("rimmade+rimmiss", "rimattempts");
    const mp = read("mp", "min_per", "minper");
    if (typeof rimAtt === "number" && typeof mp === "number" && mp > 0) {
      return (rimAtt / mp) * 100;
    }
  }
  if (key === "dunks_100") {
    const direct = read("dunks100");
    if (typeof direct === "number") return direct;
    const dunkAtt = read("dunksmiss+dunksmade", "dunkattempts");
    const mp = read("mp", "min_per", "minper");
    if (typeof dunkAtt === "number" && typeof mp === "number" && mp > 0) {
      return (dunkAtt / mp) * 100;
    }
  }
  if (key === "poss_created_100") {
    const stlPer100 = read("stl100", "stl_per_100", "stlper100");
    const blkPer100 = read("blk100", "blk_per_100", "blkper100");
    const orebPer100 = read("oreb100", "orb100", "oreb_per_100");
    const toPer100 = read("to100", "tov100", "to_per_100");

    if (
      typeof stlPer100 === "number" ||
      typeof blkPer100 === "number" ||
      typeof orebPer100 === "number" ||
      typeof toPer100 === "number"
    ) {
      return (
        (typeof stlPer100 === "number" ? stlPer100 : 0) +
        (typeof blkPer100 === "number" ? blkPer100 * 0.6 : 0) +
        (typeof orebPer100 === "number" ? orebPer100 : 0) -
        (typeof toPer100 === "number" ? toPer100 : 0)
      );
    }

    const spg = read("spg", "stl");
    const bpg = read("bpg", "blk");
    const rpg = read("rpg", "oreb");
    const mpg = read("mpg", "mp", "min_per", "minper");
    const toPg = read("topg", "to", "tov", "to_pg");
    if (typeof mpg === "number" && mpg > 0) {
      const stl100 = typeof spg === "number" ? (spg / mpg) * 100 : 0;
      const blk100 = typeof bpg === "number" ? (bpg / mpg) * 100 : 0;
      const oreb100 = typeof rpg === "number" ? (rpg / mpg) * 100 : 0;
      const to100 = typeof toPg === "number" ? (toPg / mpg) * 100 : 0;
      return stl100 + (blk100 * 0.6) + oreb100 - to100;
    }
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
    netpoints: "net_points",
    netpts: "net_points",
    onoffnet: "onoff_net",
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

function normalizeTextKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTeamName(value: unknown): string {
  return normalizeTextKey(value).replace(/\b(st|state)\b/g, "state");
}

function normalizePlayerName(value: unknown): string {
  return normalizeTextKey(value);
}

function rsciLookupKey(player: string, team: string, season: number | string): string {
  return `${normalizePlayerName(player)}::${normalizeTeamName(team)}::${String(season).trim()}`;
}

function parseRsciSeason(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  const m = text.match(/(20\d{2})\s*[-/]\s*(\d{2})/);
  if (m) return Number(`20${m[2]}`);
  const direct = text.match(/20\d{2}/);
  if (direct) return Number(direct[0]);
  return null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) {
      row[header[c]] = String(cols[c] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function githubCsvCandidates(explicitPath: string | undefined): string[] {
  const defaults = ["player_cards_pipeline/output/jason_created_stats.csv", "jason_created_stats.csv"];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (candidate: string | undefined) => {
    const value = String(candidate || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };
  add(explicitPath);
  if (explicitPath && !explicitPath.includes("/")) add(`player_cards_pipeline/output/${explicitPath}`);
  for (const path of defaults) add(path);
  return out;
}

async function fetchJasonCsvRows(gender: LeaderboardGender): Promise<JasonStatsRow[]> {
  const cached = jasonStatsCache.get(gender);
  const now = Date.now();
  if (cached && now - cached.ts < JASON_CACHE_TTL_MS) return cached.rows;

  const owner =
    gender === "women"
      ? process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason"
      : process.env.GITHUB_DATA_OWNER || "dbcjason";
  const repo =
    gender === "women"
      ? process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards"
      : process.env.GITHUB_DATA_REPO || "NCAACards";
  const ref =
    gender === "women"
      ? process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main"
      : process.env.GITHUB_DATA_REF || "main";
  const explicitPath =
    gender === "women" ? process.env.GITHUB_JASON_STATS_CSV_PATH_WOMEN : process.env.GITHUB_JASON_STATS_CSV_PATH;
  const csvPaths = githubCsvCandidates(explicitPath);
  const headers: HeadersInit = {};
  const token = process.env.GITHUB_TOKEN || "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  let rowsRaw: Array<Record<string, string>> = [];
  let lastError = "";
  for (const csvPath of csvPaths) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${csvPath}`;
    try {
      const res = await fetch(url, { cache: "force-cache", headers, next: { revalidate: 3600 } });
      if (!res.ok) {
        lastError = `status ${res.status} @ ${csvPath}`;
        continue;
      }
      rowsRaw = parseCsv(await res.text());
      if (rowsRaw.length) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!rowsRaw.length) {
    console.warn(`[leaderboard] Jason stats unavailable for ${gender}: ${lastError}`);
    jasonStatsCache.set(gender, { ts: now, rows: [] });
    return [];
  }

  const parsed: JasonStatsRow[] = rowsRaw
    .map((row) => {
      const season = Number(row.season ?? "");
      const team = String(row.team ?? "").trim();
      const player = String(row.player_name ?? row.player ?? "").trim();
      if (!Number.isFinite(season) || !team || !player) return null;
      const values: Record<string, number | null> = {
        feel_plus: numericOrNull(row.feel_plus),
        poss_created_100: numericOrNull(
          row.possessions_created_per_100 ??
            row.possessions_created_per100 ??
            row.possessions_created_per_100_poss ??
          row.possessions_created_100 ??
            row.possessions_created ??
            row.poss_created_per_100 ??
            row.poss_created_per100 ??
            row.poss_created ??
            row.poss_created_100 ??
            row.posscreated100 ??
            row.possessionscreated100,
        ),
        rimfluence: numericOrNull(row.rimfluence),
        rimfluence_off: numericOrNull(row.rimfluence_off),
        rimfluence_def: numericOrNull(row.rimfluence_def),
      };
      const percentiles: Record<string, number | null> = {
        feel_plus: numericOrNull(row.feel_plus_percentile),
        poss_created_100: numericOrNull(
          row.possessions_created_per_100_percentile ??
            row.possessions_created_per100_percentile ??
          row.possessions_created_100_percentile ??
            row.possessions_created_percentile ??
            row.poss_created_per_100_percentile ??
            row.poss_created_per100_percentile ??
            row.poss_created_percentile ??
            row.poss_created_100_percentile ??
            row.posscreated100_percentile ??
            row.possessionscreated100_percentile,
        ),
        rimfluence: numericOrNull(row.rimfluence_percentile),
      };
      return {
        season,
        team,
        player,
        class_raw: String(row.class ?? "").trim(),
        position_raw: String(row.position ?? row.pos ?? "").trim(),
        listed_height: String(row.listed_height ?? row.height ?? "").trim(),
        statistical_height: String(row.statistical_height ?? row.stat_height ?? "").trim(),
        height_delta_inches: numericOrNull(row.height_delta_inches),
        draft_pick: numericOrNull(row.draft_pick),
        values,
        percentiles,
      };
    })
    .filter((row): row is JasonStatsRow => Boolean(row));

  jasonStatsCache.set(gender, { ts: now, rows: parsed });
  return parsed;
}

async function fetchRsciLookup(): Promise<Record<string, number>> {
  const owner = process.env.GITHUB_DATA_OWNER || "dbcjason";
  const repo = process.env.GITHUB_DATA_REPO || "NCAACards";
  const ref = process.env.GITHUB_DATA_REF || "main";
  const cacheKey = `${owner}/${repo}@${ref}:rsci`;
  const cached = rsciLookupCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < RSCI_CACHE_TTL_MS) return cached.lookup;

  const csvPaths = [
    process.env.GITHUB_RSCI_CSV_PATH || "",
    "player_cards_pipeline/data/manual/rsci/rsci_rankings.csv",
    "player_cards_pipeline/data/manual/rsci_rankings.csv",
    "rsci_rankings.csv",
  ].filter(Boolean);
  const headers: HeadersInit = {};
  const token = process.env.GITHUB_TOKEN || "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  const lookup: Record<string, number> = {};
  for (const csvPath of csvPaths) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${csvPath}`;
    try {
      const res = await fetch(url, { cache: "force-cache", headers, next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const rows = parseCsv(await res.text());
      if (!rows.length) continue;
      for (const row of rows) {
        const player = String(row.Player ?? row.player_name ?? row.player ?? "").trim();
        if (!player) continue;
        const rank = parseRankValue(row.Rank ?? row.rsci ?? row.RSCI ?? row.rsci_rank);
        if (typeof rank !== "number" || !Number.isFinite(rank)) continue;
        const rankRounded = Math.round(rank);
        if (rankRounded < 1 || rankRounded > 100) continue;
        const team = String(row.Team ?? row.team ?? row.school ?? "").trim();
        const season = parseRsciSeason(row.Season ?? row.season ?? row.year);
        if (season) {
          lookup[rsciLookupKey(player, team, season)] = rankRounded;
          lookup[rsciLookupKey(player, "", season)] = rankRounded;
        }
        lookup[rsciLookupKey(player, "", "")] = rankRounded;
      }
      if (Object.keys(lookup).length) break;
    } catch {
      continue;
    }
  }

  rsciLookupCache.set(cacheKey, { ts: now, lookup });
  return lookup;
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
  const payload = safeAnyObject(row.payload_json);
  const payloadBio = safeAnyObject(payload.bio);
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
      mergedValues[key] = normalizeMetricScale(key, parsedValue);
    }
    if (hasParsedPercentile && (currentPercentile == null || currentPercentile === 0 || currentValue === 0)) {
      mergedPercentiles[key] = parsedPercentile;
    }

    const nextValue = normalizeMetricScale(key, mergedValues[key] ?? null);
    mergedValues[key] = nextValue;
    const nextLooksPlaceholder = nextValue === 0 && (currentPercentile == null || currentPercentile === 0);
    if (nextValue == null || !Number.isFinite(Number(nextValue)) || nextLooksPlaceholder) {
      const fallback = normalizeMetricScale(key, metricValueFromBtRow(btRow, key));
      if (typeof fallback === "number" && Number.isFinite(fallback)) {
        mergedValues[key] = fallback;
      }
    }

    const finalValue = mergedValues[key];
    const finalPercentile = mergedPercentiles[key];
    const likelyPlaceholderZero =
      finalValue === 0 &&
      (finalPercentile == null || finalPercentile === 0) &&
      !hasParsedValue &&
      !hasParsedPercentile;
    if (likelyPlaceholderZero) {
      mergedValues[key] = null;
      mergedPercentiles[key] = null;
    }
  }

  const payloadStatHeightText = String(
    payloadBio.statistical_height_text ??
      payloadBio.statistical_height ??
      payloadBio.stat_height ??
      payloadBio.statisticalHeight ??
      "",
  ).trim();
  const payloadStatDelta =
    numericOrNull(
      payloadBio.statistical_height_delta ??
        payloadBio.stat_height_delta ??
        payloadBio.statisticalHeightDelta,
    ) ??
    (() => {
      const match = payloadStatHeightText.match(/,\s*([+-]?\d+(?:\.\d+)?)\s*in\s*$/i);
      return match ? numericOrNull(match[1]) : null;
    })();
  const payloadStatBase = payloadStatHeightText
    ? payloadStatHeightText.replace(/,\s*[+-]?\d+(?:\.\d+)?\s*in\s*$/i, "").trim()
    : "";

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
    height: String(payloadBio.height ?? row.height ?? "").trim() || row.height,
    statistical_height: payloadStatBase || row.statistical_height,
    statistical_height_delta:
      payloadStatDelta ??
      numericOrNull(row.statistical_height_delta),
    values: mergedValues,
    percentiles: mergedPercentiles,
    minutes_per_game:
      numericOrNull(btRow.mp) ??
      numericOrNull(btRow.mpg) ??
      numericOrNull(sourceValues.mp) ??
      numericOrNull(sourceValues.mpg),
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
      if (filter.metric === "draft_pick") {
        const value = row.values?.draft_pick;
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
      }
      if (filter.metric === "minutes_per_game") {
        const value = row.minutes_per_game;
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
      }
      if (filter.metric === "height_inches") {
        const value = parseHeightToInches(row.height);
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
      }
      if (filter.metric === "statistical_height_inches") {
        const value = parseHeightToInches(row.statistical_height);
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        return filter.comparator === "<=" ? value <= filter.value : value >= filter.value;
      }
      if (filter.metric === "statistical_height_delta") {
        const value = row.statistical_height_delta;
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
    if (sortBy === "class") {
      const aRank = classSortRank(a.class);
      const bRank = classSortRank(b.class);
      if (aRank !== bRank) return (aRank - bRank) * direction;
      return a.class.localeCompare(b.class) * direction;
    }
    if (sortBy === "pos") return a.pos.localeCompare(b.pos) * direction;
    if (sortBy === "height") {
      const aVal = parseHeightToInches(a.height);
      const bVal = parseHeightToInches(b.height);
      if (typeof aVal === "number" && typeof bVal === "number" && aVal !== bVal) {
        return (aVal - bVal) * direction;
      }
      return a.height.localeCompare(b.height) * direction;
    }
    if (sortBy === "statistical_height") {
      const aVal = parseHeightToInches(a.statistical_height);
      const bVal = parseHeightToInches(b.statistical_height);
      if (typeof aVal === "number" && typeof bVal === "number" && aVal !== bVal) {
        return (aVal - bVal) * direction;
      }
      return a.statistical_height.localeCompare(b.statistical_height) * direction;
    }
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
  draftedPlus2026?: boolean;
}): Promise<QueryLeaderboardResult> {
  const cacheKey = JSON.stringify({
    gender: params.gender,
    season: params.season ?? null,
    team: String(params.team ?? ""),
    player: String(params.player ?? ""),
    position: String(params.position ?? ""),
    conference: String(params.conference ?? ""),
    filters: params.filters ?? [],
    sortBy: String(params.sortBy ?? ""),
    sortDir: params.sortDir === "asc" ? "asc" : "desc",
    sortMode: params.sortMode === "percentile" ? "percentile" : "stat",
    limit: Number.isFinite(Number(params.limit)) ? Number(params.limit) : 500,
    minMpg: Number.isFinite(Number(params.minMpg)) ? Number(params.minMpg) : 10,
    draftedPlus2026: Boolean(params.draftedPlus2026),
  });

  const cached = readQueryCache(cacheKey);
  if (cached) return cached;
  const inflight = leaderboardInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async (): Promise<QueryLeaderboardResult> => {
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

  const includePayloadJoin = Number.isFinite(params.season);
  const fromClause = includePayloadJoin
    ? `from public.leaderboard_player_stats l
      left join public.player_payload_index p
        on p.gender = l.gender
       and p.season = l.season
       and p.team = l.team
       and p.player = l.player`
    : `from public.leaderboard_player_stats l`;
  const payloadSelect = includePayloadJoin
    ? `p.payload_json,
        p.payload_json -> 'sections_html' ->> 'bt_percentiles_html' as bt_percentiles_html,
        p.payload_json -> 'sections_html' ->> 'self_creation_html' as self_creation_html,`
    : `null::jsonb as payload_json,
        null::text as bt_percentiles_html,
        null::text as self_creation_html,`;

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
        ${payloadSelect}
        l.updated_at
      ${fromClause}
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
  const jasonRows =
    params.gender === "all"
      ? [...(await fetchJasonCsvRows("men")), ...(await fetchJasonCsvRows("women"))]
      : await fetchJasonCsvRows(params.gender);
  const rsciLookup = await fetchRsciLookup();
  const jasonLookup = new Map<string, JasonStatsRow>();
  const jasonByPlayerSeason = new Map<string, JasonStatsRow[]>();
  for (const row of jasonRows) {
    jasonLookup.set(
      `${row.season}::${normalizeTeamName(row.team)}::${normalizePlayerName(row.player)}`,
      row,
    );
    const key = `${row.season}::${normalizePlayerName(row.player)}`;
    const bucket = jasonByPlayerSeason.get(key) ?? [];
    bucket.push(row);
    jasonByPlayerSeason.set(key, bucket);
  }

  normalized = normalized.map((row) => {
    const lookupKey = `${row.season}::${normalizeTeamName(row.team)}::${normalizePlayerName(row.player)}`;
    const jason =
      jasonLookup.get(lookupKey) ??
      (() => {
        const bucket = jasonByPlayerSeason.get(`${row.season}::${normalizePlayerName(row.player)}`) ?? [];
        return bucket.length === 1 ? bucket[0] : undefined;
      })();
    const draftPick = (() => {
      const raw = jason?.draft_pick;
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 100000) return raw;
      return 100000;
    })();
    const rsciFromCsv =
      row.gender === "men"
        ? rsciLookup[rsciLookupKey(row.player, row.team, row.season)] ??
          rsciLookup[rsciLookupKey(row.player, "", row.season)] ??
          rsciLookup[rsciLookupKey(row.player, "", "")]
        : null;
    const jasonPos = normalizePositionCode(jason?.position_raw ?? "");
    const jasonListedHeight = String(jason?.listed_height ?? "").trim();
    const jasonStatHeight = String(jason?.statistical_height ?? "").trim();
    const jasonHeightDelta = jason?.height_delta_inches;
    const mergedValues: Record<string, number | null> = {
      ...row.values,
      draft_pick: draftPick,
    };
    for (const [key, value] of Object.entries(jason?.values ?? {})) {
      const current = mergedValues[key];
      const currentValid = typeof current === "number" && Number.isFinite(current);
      const nextValid = typeof value === "number" && Number.isFinite(value);
      if (!currentValid && nextValid) {
        mergedValues[key] = value;
      }
    }
    const mergedPercentiles: Record<string, number | null> = {
      ...row.percentiles,
    };
    for (const [key, value] of Object.entries(jason?.percentiles ?? {})) {
      const current = mergedPercentiles[key];
      const currentValid = typeof current === "number" && Number.isFinite(current);
      const nextValid = typeof value === "number" && Number.isFinite(value);
      if (!currentValid && nextValid) {
        mergedPercentiles[key] = value;
      }
    }
    return {
      ...row,
      pos: jasonPos || row.pos,
      height: jasonListedHeight || row.height,
      statistical_height: jasonStatHeight || row.statistical_height,
      statistical_height_delta:
        typeof jasonHeightDelta === "number" && Number.isFinite(jasonHeightDelta)
          ? jasonHeightDelta
          : row.statistical_height_delta,
      rsci: typeof rsciFromCsv === "number" ? rsciFromCsv : row.rsci,
      values: mergedValues,
      percentiles: mergedPercentiles,
    };
  });

  if (conferenceFilterKey === "high major") {
    normalized = normalized.filter((row) => {
      if (normalizeTeamName(row.team) === "gonzaga") return true;
      return highMajorConferences.has(String(row.conference || "").trim());
    });
  } else if (conferenceFilterKey === "mid/low major") {
    normalized = normalized.filter((row) => {
      const conference = String(row.conference || "").trim();
      if (normalizeTeamName(row.team) === "gonzaga") return false;
      return conference.length > 0 && !highMajorConferences.has(conference);
    });
  }
  if (params.draftedPlus2026) {
    normalized = normalized.filter((row) => {
      const draftPick = numericOrNull(row.values?.draft_pick);
      const isDrafted = typeof draftPick === "number" && Number.isFinite(draftPick) && draftPick > 0 && draftPick < 100000;
      const classRaw = String(
        (jasonLookup.get(`${row.season}::${normalizeTeamName(row.team)}::${normalizePlayerName(row.player)}`)?.class_raw ?? row.class) || "",
      );
      const class2026 = /\b2026\b/.test(classRaw);
      return isDrafted || class2026;
    });
  }
  normalized = applyFilters(normalized, Array.isArray(params.filters) ? params.filters : []);
  normalized = sortRows(normalized, params.sortBy, params.sortDir, params.sortMode);

  const limited = normalized.slice(0, Math.max(1, Math.min(50000, params.limit ?? 500)));
  const seasons = Array.from(new Set(normalized.map((row) => row.season))).sort((a, b) => b - a);
  const teams = Array.from(new Set(normalized.map((row) => row.team))).sort((a, b) => a.localeCompare(b));
  const positions = Array.from(new Set(normalized.map((row) => row.pos).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const conferences = Array.from(new Set(normalized.map((row) => row.conference).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );

  const metrics =
    params.gender === "women"
      ? LEADERBOARD_METRICS.filter((metric) => metric.key !== "uasst_dunks_100")
      : LEADERBOARD_METRICS;

  const result: QueryLeaderboardResult = {
    rows: limited,
    total: normalized.length,
    seasons,
    teams,
    positions,
    conferences,
    metrics,
    minMpg,
  };
  writeQueryCache(cacheKey, result);
  return result;
  })();

  leaderboardInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    leaderboardInflight.delete(cacheKey);
  }
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
