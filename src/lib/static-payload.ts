import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type CardSections = Record<string, unknown>;

export type CardPayload = {
  schema_version?: string;
  player: string;
  team: string;
  season: string;
  bio?: Record<string, unknown>;
  per_game?: Record<string, unknown>;
  shot_chart?: Record<string, unknown>;
  sections_html?: CardSections;
  section_bundles?: {
    core?: CardSections;
    heavy?: CardSections;
  };
};

type Gender = "men" | "women";

type SourceCfg = {
  dataOwner: string;
  dataRepo: string;
  dataRef: string;
  dataToken: string;
  staticRoot: string;
  btCsvPath: string;
};

type BundledBioLookupRow = {
  player?: string;
  team?: string;
  enriched_position?: string;
  enriched_height?: string;
  jason_position?: string;
  listed_height?: string;
  statistical_height?: string;
  statistical_height_delta?: string;
  bt_height?: string;
};

type WorkflowSectionPayload = {
  rows?: Record<string, string | { html?: string; value?: string; content?: string }>;
};

const bundledBioLookupMemo = new Map<string, Promise<Record<string, BundledBioLookupRow>>>();
type TransferProjectionStatRow = Record<string, number>;
type TransferProjectionEntry = {
  conference?: string;
  transfer_grade?: string;
  weighted_comp_count?: number;
  projected_stats?: TransferProjectionStatRow;
};
type TransferProjectionCacheRow = {
  season?: string | number;
  player?: string;
  team?: string;
  projections?: Record<string, TransferProjectionEntry>;
};
type TransferProjectionCacheFile = {
  rows?: TransferProjectionCacheRow[];
};
type TransferProjectionRenderData = {
  destConfRaw: string;
  predicted: TransferProjectionStatRow;
  transferGrade: string;
  weightedCount: number;
};
const transferProjectionLookupMemo = new Map<string, Promise<Record<string, TransferProjectionCacheRow>>>();

function parseGender(raw?: string): Gender {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
}

function getSourceCfg(gender: Gender): SourceCfg {
  if (gender === "women") {
    return {
      dataOwner: process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason",
      dataRepo: process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards",
      dataRef: process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main",
      dataToken: (process.env.GITHUB_TOKEN_WOMEN || process.env.GITHUB_TOKEN || "").trim(),
      staticRoot:
        process.env.GITHUB_STATIC_PAYLOAD_ROOT_WOMEN ||
        process.env.GITHUB_STATIC_PAYLOAD_ROOT ||
        "player_cards_pipeline/data/cache/section_payloads",
      btCsvPath:
        process.env.GITHUB_BT_CSV_PATH_WOMEN ||
        process.env.GITHUB_BT_CSV_PATH ||
        "player_cards_pipeline/data/bt/bt_advstats_2019_2026.csv",
    };
  }
  return {
    dataOwner: process.env.GITHUB_DATA_OWNER || "dbcjason",
    dataRepo: process.env.GITHUB_DATA_REPO || "NCAACards",
    dataRef: process.env.GITHUB_DATA_REF || "main",
    dataToken: (process.env.GITHUB_TOKEN || "").trim(),
    staticRoot:
      process.env.GITHUB_STATIC_PAYLOAD_ROOT || "player_cards_pipeline/data/cache/section_payloads",
    btCsvPath:
      process.env.GITHUB_BT_CSV_PATH ||
      "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv",
  };
}

function normTeam(v: string): string {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normPlayer(v: string): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[.'`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v|vi)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normText(v: string): string {
  return String(v || "").toLowerCase().trim();
}

function normSeason(v: string | number): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const slash = raw.match(/^\s*(20\d{2})\s*[/\-]\s*(\d{2})\s*$/);
  if (slash) return `20${slash[2]}`;
  const year = raw.match(/20\d{2}/);
  return year ? year[0] : raw;
}

function transferCacheKey(player: string, team: string, season: string | number): string {
  return `${normPlayer(player)}|${normTeam(team)}|${normSeason(season)}`;
}

function conferenceKey(raw: string): string {
  const s = normText(raw)
    .replaceAll("&", "and")
    .replace(/\bconference\b|\bconf\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  const aliases: Record<string, string> = {
    acc: "acc",
    atlanticcoast: "acc",
    bigeast: "bigeast",
    bigten: "bigten",
    big12: "big12",
    bigtwelve: "big12",
    sec: "sec",
    southeastern: "sec",
    pac12: "pac12",
    pacten: "pac12",
    mwc: "mountainwest",
    mountainwest: "mountainwest",
    wcc: "wcc",
    a10: "a10",
    atlant10: "a10",
    american: "aac",
    aac: "aac",
    missourivalley: "mvc",
    mvc: "mvc",
    mac: "mac",
    conferenceusa: "cusa",
    cusa: "cusa",
    sunbelt: "sunbelt",
    bigwest: "bigwest",
    wac: "wac",
    horizon: "horizon",
    horizonleague: "horizon",
    caa: "caa",
    colonial: "caa",
    summit: "sum",
    summitleague: "sum",
    asun: "asun",
    atlanticsun: "asun",
    southland: "slnd",
    sland: "slnd",
    sb: "sunbelt",
    sunbeltconference: "sunbelt",
  };
  return aliases[s] ?? s;
}

function renderTransferProjectionPanel(input: TransferProjectionRenderData): string {
  const rows = [
    ["AST%", "ast_per"],
    ["OREB%", "orb_per"],
    ["DREB%", "drb_per"],
    ["STL%", "stl_per"],
    ["BLK%", "blk_per"],
    ["FG%", "fg_pct"],
    ["3P%", "tp_pct"],
    ["FT%", "ft_pct"],
  ];

  const rowHtml = rows
    .map(([label, key]) => {
      const value = input.predicted[key];
      if (!Number.isFinite(value)) {
        return `<div class="draft-odd-row"><div class="draft-odd-k">${label}</div><div class="draft-odd-v">-</div></div>`;
      }
      return `<div class="draft-odd-row"><div class="draft-odd-k">${label}</div><div class="draft-odd-v">${value.toFixed(1)}</div></div>`;
    })
    .join("");

  return `
      <div class="panel draft-proj-panel">
        <h3>Transfer Projection</h3>
        <div class="draft-proj-main">${input.destConfRaw} Transfer Grade: ${input.transferGrade || "N/A"}</div>
        <div class="draft-proj-sub">Projected next-season statline vs historical transfer comps (${input.weightedCount} comps weighted)</div>
        <div class="draft-proj-sub" style="font-weight:700;margin-top:6px;">Projected Rates</div>
        <div class="draft-odds-grid transfer-two-col">
          ${rowHtml}
        </div>
        <div class="draft-proj-sub" style="margin-top:8px;">The model examines historical cross-conference transfers, weighting similar pre-transfer profiles more heavily. Using those weighted historical stat translations, it projects statistical outcomes for the new player in the selected conference.</div>
        <div class="draft-proj-sub">Transfer Grade compares the player’s projected impact to historical transfer-up outcomes into the selected conference.</div>
      </div>
`;
}

type BtRow = Record<string, string>;

type PlayerGameStat = {
  player: string;
  team: string;
  season: string;
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
};

const SECTION_JSON_KEYS = [
  "grade_boxes_html",
  "bt_percentiles_html",
  "self_creation_html",
  "playstyles_html",
  "team_impact_html",
  "shot_diet_html",
  "player_comparisons_html",
] as const;

const sectionPayloadMemo = new Map<string, Promise<Record<string, string>>>();
const btRowsMemo = new Map<string, Promise<BtRow[]>>();
const enrichedLookupMemo = new Map<string, Promise<Record<string, Record<string, unknown>>>>();
const heightProfileDeltaMemo = new Map<string, Promise<{ byKey: Record<string, number>; byName: Record<string, number>; byPid: Record<string, number> }>>();

function cardCacheKey(player: string, team: string, season: string | number): string {
  return `${normPlayer(player)}|${normTeam(team)}|${normSeason(season)}`;
}

function percentile(value: number, cohort: number[]): number {
  if (!cohort.length) return 0;
  let less = 0;
  let equal = 0;
  for (const x of cohort) {
    if (!Number.isFinite(x)) continue;
    if (x < value) less += 1;
    else if (x === value) equal += 1;
  }
  const total = cohort.filter((x) => Number.isFinite(x)).length || 0;
  if (!total) return 0;
  return (100 * (less + 0.5 * equal)) / total;
}

function percentileSafe(value: number | null, cohort: number[]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const vals = cohort.filter((x) => Number.isFinite(x));
  if (!vals.length) return null;
  return percentile(value, vals);
}

function btGet(row: BtRow, names: string[]): string {
  const keys = Object.keys(row);
  for (const name of names) {
    const hit = keys.find((key) => normText(key) === normText(name));
    if (hit) return String(row[hit] ?? "");
  }
  return "";
}

function toNumber(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function heightToInches(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const compact = s.replace(/\s+/g, "");
  const m = compact.match(/^(\d+)[-'](\d{1,2})(?:\"|”)?$/);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  const dash = compact.match(/^(\d+)-(\d{1,2})$/);
  if (dash) return Number(dash[1]) * 12 + Number(dash[2]);
  const inches = Number(s);
  return Number.isFinite(inches) ? inches : null;
}

function inchesToHeightStr(inches: number): string {
  if (!Number.isFinite(inches)) return "N/A";
  const rounded = Math.round(inches * 10) / 10;
  const feet = Math.floor(rounded / 12);
  const rem = Math.round((rounded - feet * 12) * 10) / 10;
  const inchPart = Math.round(rem);
  return `${feet}'${inchPart}"`;
}

function btCsvCandidates(cfg: SourceCfg): string[] {
  return [
    cfg.btCsvPath,
    "player_cards_pipeline/data/bt/bt_advstats_2019_2026.csv",
    "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv",
    "player_cards_pipeline/data/bt/bt_advstats_2019_2025.csv",
    "player_cards_pipeline/data/bt/bt_advstats_2010_2025.csv",
    "player_cards_pipeline/data/bt/bt_advstats_2026.csv",
  ];
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

function findCol(header: string[], names: string[]): number {
  const normalized = header.map((h) => normText(h).replace(/[^a-z0-9]+/g, ""));
  const targets = names.map((n) => normText(n).replace(/[^a-z0-9]+/g, ""));
  for (const target of targets) {
    const idx = normalized.findIndex((h) => h === target);
    if (idx >= 0) return idx;
  }
  return -1;
}

function normalizedSectionKey(player: string, team: string, season: string | number): string {
  return cardCacheKey(player, team, season);
}

async function loadSectionPayloadRows(
  section: string,
  season: string | number,
  cfg: SourceCfg,
): Promise<Record<string, unknown>> {
  const key = `${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}:${section}:${normSeason(season)}`;
  const cached = sectionPayloadMemo.get(key);
  if (cached) return cached as Promise<Record<string, unknown>>;

  const promise = (async () => {
    const roots = Array.from(
      new Set([
        String(cfg.staticRoot || "").trim(),
        "player_cards_pipeline/data/cache/section_payloads",
        "player_cards_pipeline/public/cards/cache/section_payloads",
        "player_cards_pipeline/public/cards",
      ]),
    ).filter(Boolean);

    const canonicalRepo = /women|ncaaw/i.test(cfg.dataRepo) ? "NCAAWCards" : "NCAACards";
    const sources: SourceCfg[] = [];
    const seenSources = new Set<string>();
    const pushSource = (source: SourceCfg) => {
      const id = `${source.dataOwner}/${source.dataRepo}@${source.dataRef}`;
      if (seenSources.has(id)) return;
      seenSources.add(id);
      sources.push(source);
    };

    pushSource(cfg);
    if (cfg.dataRef !== "main") {
      pushSource({ ...cfg, dataRef: "main" });
    }
    pushSource({
      ...cfg,
      dataOwner: "dbcjason",
      dataRepo: canonicalRepo,
      dataRef: "main",
    });

    for (const source of sources) {
      for (const root of roots) {
        try {
          const payload = await fetchRepoJson<WorkflowSectionPayload>(
            `${root}/${section}/${normSeason(season)}.json`,
            source,
          );
          if (payload && typeof payload.rows === "object" && payload.rows) {
            return payload.rows;
          }
        } catch {
          continue;
        }
      }
    }
    return {};
  })();

  sectionPayloadMemo.set(key, promise as Promise<Record<string, string>>);
  return promise;
}

function parseWorkflowRowKey(key: string): { player: string; team: string; season: string } | null {
  const parts = String(key || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  return {
    player: parts[0] ?? "",
    team: parts[1] ?? "",
    season: parts[2] ?? "",
  };
}

function workflowRowMatches(key: string, player: string, team: string, season: number): boolean {
  const parsed = parseWorkflowRowKey(key);
  if (!parsed) return false;
  return (
    normPlayer(parsed.player) === normPlayer(player) &&
    normTeam(parsed.team) === normTeam(team) &&
    String(parsed.season).trim() === String(season)
  );
}

function workflowHtmlFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  for (const key of ["html", "value", "content", "body"]) {
    const candidate = obj[key];
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

async function loadHeightProfileDeltaMaps(
  season: number,
  cfg: SourceCfg,
): Promise<{ byKey: Record<string, number>; byName: Record<string, number>; byPid: Record<string, number> }> {
  const key = `${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}:height:${normSeason(season)}`;
  const cached = heightProfileDeltaMemo.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const byKey: Record<string, number> = {};
    const byName: Record<string, number> = {};
    const byPid: Record<string, number> = {};
    const paths = [
      `player_cards_pipeline/output/height_profile_big_only_scores_${normSeason(season)}.csv`,
      "player_cards_pipeline/output/height_profile_big_only_scores_2019_2025.csv",
      `player_cards_pipeline/output/height_profile_scores_big_${normSeason(season)}.csv`,
    ];
    for (const path of paths) {
      try {
        const text = await fetchRepoText(path, cfg);
        const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
        if (lines.length < 2) continue;
        const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
        const pIdx = findCol(header, ["player_name", "player", "name"]);
        const tIdx = findCol(header, ["team", "school"]);
        const pidIdx = findCol(header, ["pid"]);
        const deltaIdx = findCol(header, ["big_height_delta_inches", "height_delta_inches"]);
        const seasonIdx = findCol(header, ["season", "year"]);
        if (pIdx < 0 || deltaIdx < 0) continue;
        for (let i = 1; i < lines.length; i += 1) {
          const cols = parseCsvLine(lines[i]);
          const rowSeason = seasonIdx >= 0 ? normSeason(cols[seasonIdx] ?? "") : normSeason(season);
          if (rowSeason && rowSeason !== normSeason(season)) continue;
          const delta = toNumber(cols[deltaIdx]);
          if (delta === null) continue;
          const playerName = String(cols[pIdx] ?? "").trim();
          const teamName = tIdx >= 0 ? String(cols[tIdx] ?? "").trim() : "";
          const pid = pidIdx >= 0 ? String(cols[pidIdx] ?? "").trim() : "";
          if (playerName) {
            byName[normPlayer(playerName)] = delta;
            if (teamName) byKey[`${normPlayer(playerName)}|${normTeam(teamName)}`] = delta;
          }
          if (pid) byPid[pid] = delta;
        }
        if (Object.keys(byName).length) break;
      } catch {
        continue;
      }
    }
    return { byKey, byName, byPid };
  })();

  heightProfileDeltaMemo.set(key, promise);
  return promise;
}

function computeStatisticalHeightDelta(
  player: string,
  team: string,
  targetRow: BtRow | null,
  listedHeight: string,
  maps: { byKey: Record<string, number>; byName: Record<string, number>; byPid: Record<string, number> },
): number | null {
  const pid = targetRow ? String(btGet(targetRow, ["pid"])).trim() : "";
  if (pid && maps.byPid[pid] !== undefined) return maps.byPid[pid];
  const key = `${normPlayer(player)}|${normTeam(team)}`;
  if (maps.byKey[key] !== undefined) return maps.byKey[key];
  const name = normPlayer(player);
  if (maps.byName[name] !== undefined) return maps.byName[name];
  const listedInches = heightToInches(listedHeight);
  if (listedInches === null) return null;
  return null;
}

function nestedValue(obj: Record<string, unknown> | undefined, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

async function loadWorkflowSectionsHtml(
  season: number,
  team: string,
  player: string,
  cfg: SourceCfg,
): Promise<Record<string, string>> {
  const key = normalizedSectionKey(player, team, season);
  const entries = await Promise.all(
    SECTION_JSON_KEYS.map(async (section) => {
      const rows = await loadSectionPayloadRows(section, season, cfg);
      const direct = (rows as Record<string, unknown>)[key];
      const directHtml = workflowHtmlFromValue(direct).trim();
      if (directHtml) return [section, directHtml] as const;
      const fallback = Object.entries(rows as Record<string, unknown>).find(([k]) =>
        workflowRowMatches(k, player, team, season),
      );
      return [section, fallback ? workflowHtmlFromValue(fallback[1]).trim() : ""] as const;
    }),
  );
  const out: Record<string, string> = {};
  for (const [section, html] of entries) {
    if (html) out[section] = html;
  }
  return out;
}

async function loadBtRowsForSeason(season: number, cfg: SourceCfg): Promise<BtRow[]> {
  const key = `${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}:bt:${season}`;
  const cached = btRowsMemo.get(key);
  if (cached) return cached;

  const promise = (async () => {
    for (const path of btCsvCandidates(cfg)) {
      try {
        const text = await fetchRepoText(path, cfg);
        const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
        if (lines.length < 2) continue;
        const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
        const pIdx = findCol(header, ["player_name", "player", "name", "plyr"]);
        const tIdx = findCol(header, ["team", "school", "tm", "team_name", "school_name"]);
        const yIdx = findCol(header, ["year", "season", "yr"]);
        if (pIdx < 0 || tIdx < 0 || yIdx < 0) continue;
        const out: BtRow[] = [];
        for (let i = 1; i < lines.length; i += 1) {
          const cols = parseCsvLine(lines[i]);
          const year = normSeason(cols[yIdx] ?? "");
          if (year !== normSeason(season)) continue;
          const playerName = String(cols[pIdx] ?? "").trim();
          const teamName = String(cols[tIdx] ?? "").trim();
          if (!playerName || !teamName) continue;
          const row: BtRow = {};
          header.forEach((h, idx) => {
            row[h] = String(cols[idx] ?? "");
          });
          out.push(row);
        }
        if (out.length) return out;
      } catch {
        continue;
      }
    }
    return [];
  })();

  btRowsMemo.set(key, promise);
  return promise;
}

function btRowPositionBucket(row: BtRow): string | null {
  const rp = normText(btGet(row, ["roster.pos"]));
  if (rp === "g" || rp === "f" || rp === "c") return rp.toUpperCase();
  const raw = `${btGet(row, ["roster.pos"])} ${btGet(row, ["role"])} ${btGet(row, ["posClass"])}`.toUpperCase();
  if (!raw.trim()) return null;
  const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (["PG", "SG", "CG", "WG", "G", "GUARD"].includes(token)) return "G";
    if (["SF", "PF", "WF", "F", "FORWARD"].includes(token)) return "F";
    if (["C", "CENTER"].includes(token)) return "C";
  }
  const compact = raw.replace(/[^A-Z0-9]+/g, "");
  if (compact.includes("PG") || compact.includes("SG") || compact.includes("CG") || compact.endsWith("G")) return "G";
  if (compact.includes("SF") || compact.includes("PF") || compact.includes("WF") || compact.endsWith("F")) return "F";
  if (compact.includes("C")) return "C";
  return null;
}

function buildPlayerGameStat(row: BtRow): PlayerGameStat | null {
  const season = normSeason(btGet(row, ["year", "season", "yr"]));
  const player = btGet(row, ["player_name", "player", "name"]);
  const team = btGet(row, ["team", "school"]);
  if (!season || !player || !team) return null;

  const gp = Math.max(1, Math.round(toNumber(btGet(row, ["GP", "gp"])) ?? 1));
  const ppg = toNumber(btGet(row, ["pts", "PTS", "ppg"])) ?? 0;
  const oreb = toNumber(btGet(row, ["oreb", "OREB"])) ?? 0;
  const dreb = toNumber(btGet(row, ["dreb", "DREB"])) ?? 0;
  const apg = toNumber(btGet(row, ["ast", "AST", "apg"])) ?? 0;
  const spg = toNumber(btGet(row, ["stl", "STL", "spg"])) ?? 0;
  const bpg = toNumber(btGet(row, ["blk", "BLK", "bpg"])) ?? 0;
  const twoM = toNumber(btGet(row, ["twoPM", "2PM"])) ?? 0;
  const twoA = toNumber(btGet(row, ["twoPA", "2PA"])) ?? 0;
  const threeM = toNumber(btGet(row, ["TPM", "3PM"])) ?? 0;
  const threeA = toNumber(btGet(row, ["TPA", "3PA"])) ?? 0;
  const ftM = toNumber(btGet(row, ["FTM"])) ?? 0;
  const ftA = toNumber(btGet(row, ["FTA"])) ?? 0;
  const fgm = twoM + threeM;
  const fga = twoA + threeA;

  return {
    player,
    team,
    season,
    games: gp,
    points: Math.max(0, Math.round(ppg * gp)),
    rebounds: Math.max(0, Math.round((oreb + dreb) * gp)),
    assists: Math.max(0, Math.round(apg * gp)),
    steals: Math.max(0, Math.round(spg * gp)),
    blocks: Math.max(0, Math.round(bpg * gp)),
    fgm: Math.max(0, Math.round(fgm * gp)),
    fga: Math.max(0, Math.round(fga * gp)),
    tpm: Math.max(0, Math.round(threeM * gp)),
    tpa: Math.max(0, Math.round(threeA * gp)),
    ftm: Math.max(0, Math.round(ftM * gp)),
    fta: Math.max(0, Math.round(ftA * gp)),
  };
}

function buildPerGamePercentiles(
  players: PlayerGameStat[],
  target: PlayerGameStat,
  minGames: number,
  btRows: BtRow[],
): Record<string, number | null> {
  const targetSeason = normSeason(target.season);
  let cohort = players.filter((row) => normSeason(row.season) === targetSeason && row.games >= minGames);
  const targetRow =
    btRows.find(
      (row) =>
        normPlayer(row.player_name || row.player || row.name || "") === normPlayer(target.player) &&
        normTeam(row.team || row.school || "") === normTeam(target.team) &&
        normSeason(row.year || row.season || row.yr || "") === targetSeason,
    ) ?? null;
  const targetBucket = targetRow ? btRowPositionBucket(targetRow) : null;
  if (targetBucket) {
    const bucketed = cohort.filter((row) => {
      const candidate = btRows.find(
        (btRow) =>
          normPlayer(btRow.player_name || btRow.player || btRow.name || "") === normPlayer(row.player) &&
          normTeam(btRow.team || btRow.school || "") === normTeam(row.team) &&
          normSeason(btRow.year || btRow.season || btRow.yr || "") === normSeason(row.season),
      );
      return candidate ? btRowPositionBucket(candidate) === targetBucket : false;
    });
    if (bucketed.length) cohort = bucketed;
  }
  if (!cohort.length) {
    cohort = players.filter((row) => row.games >= minGames);
  }
  return {
    ppg: percentileSafe(target.points / target.games, cohort.map((row) => row.points / row.games)),
    rpg: percentileSafe(target.rebounds / target.games, cohort.map((row) => row.rebounds / row.games)),
    apg: percentileSafe(target.assists / target.games, cohort.map((row) => row.assists / row.games)),
    spg: percentileSafe(target.steals / target.games, cohort.map((row) => row.steals / row.games)),
    bpg: percentileSafe(target.blocks / target.games, cohort.map((row) => row.blocks / row.games)),
    fg_pct: percentileSafe(
      target.fga > 0 ? (100 * target.fgm) / target.fga : null,
      cohort.map((row) => (row.fga > 0 ? (100 * row.fgm) / row.fga : Number.NaN)),
    ),
    tp_pct: percentileSafe(
      target.tpa > 0 ? (100 * target.tpm) / target.tpa : null,
      cohort.map((row) => (row.tpa > 0 ? (100 * row.tpm) / row.tpa : Number.NaN)),
    ),
    ft_pct: percentileSafe(
      target.fta > 0 ? (100 * target.ftm) / target.fta : null,
      cohort.map((row) => (row.fta > 0 ? (100 * row.ftm) / row.fta : Number.NaN)),
    ),
  };
}

async function loadEnrichedLookup(
  season: number,
  gender: Gender,
  cfg: SourceCfg,
): Promise<Record<string, Record<string, unknown>>> {
  const key = `${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}:${gender}:${normSeason(season)}`;
  const cached = enrichedLookupMemo.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const scriptGender = gender === "women" ? "Women" : "Men";
    const targetSeason = Number(normSeason(season)) || Number(season);
    const path = `player_cards_pipeline/data/manual/enriched_players/by_script_season/players_all_${scriptGender}_scriptSeason_${targetSeason}_fromJsonYear_${targetSeason - 1}.json`;
    const lookup: Record<string, Record<string, unknown>> = {};
    try {
      const payload = await fetchRepoJson<{ players?: Record<string, unknown>[] }>(path, cfg);
      for (const row of payload.players ?? []) {
        if (!row || typeof row !== "object") continue;
        const obj = row as Record<string, unknown>;
        const playerRaw = String(obj.key ?? obj.player ?? obj.name ?? "").trim();
        const team = String(obj.team ?? obj.school ?? "").trim();
        if (!playerRaw || !team) continue;

        const aliases = new Set<string>([playerRaw]);
        if (playerRaw.includes(",")) {
          const parts = playerRaw.split(",").map((part) => part.trim()).filter(Boolean);
          if (parts.length >= 2) {
            aliases.add(`${parts.slice(1).join(" ")} ${parts[0]}`.trim());
          }
        }

        for (const alias of aliases) {
          lookup[cardCacheKey(alias, team, season)] = obj;
        }
      }
    } catch {
      return {};
    }

    return lookup;
  })();

  enrichedLookupMemo.set(key, promise);
  return promise;
}

function buildShotsFromEnrichedRow(enrichedRow: Record<string, unknown>): { shots: Array<Record<string, unknown>>; makes: number; attempts: number } {
  const shotInfo = enrichedRow?.shotInfo as Record<string, unknown> | undefined;
  const nested = shotInfo?.data as Record<string, unknown> | undefined;
  const entries = Array.isArray(nested?.info)
    ? (nested.info as unknown[])
    : Array.isArray(shotInfo?.info)
      ? (shotInfo.info as unknown[])
      : [];
  const shots: Array<Record<string, unknown>> = [];
  let makes = 0;
  let attempts = 0;
  for (const rec of entries) {
    if (!Array.isArray(rec) || rec.length < 4) continue;
    const xFt = Number(rec[0]);
    const yFt = Number(rec[1]);
    const points = Number(rec[2]);
    const fga = Math.max(0, Math.round(Number(rec[3])));
    if (!Number.isFinite(xFt) || !Number.isFinite(yFt) || !Number.isFinite(points) || fga <= 0) continue;
    attempts += fga;
    const isThree = Math.hypot(xFt, yFt) >= 22;
    const shotValue = isThree ? 3 : 2;
    const madeCount = Math.max(0, Math.min(fga, Math.round(points / shotValue)));
    makes += madeCount;
    for (let i = 0; i < madeCount; i += 1) {
      shots.push({ x: (xFt + 4) * 10, y: (yFt + 25) * 10, made: true });
    }
    for (let i = 0; i < fga - madeCount; i += 1) {
      shots.push({ x: (xFt + 4) * 10, y: (yFt + 25) * 10, made: false });
    }
  }
  return { shots, makes, attempts };
}

async function fetchRepoJson<T>(path: string, cfg: SourceCfg): Promise<T> {
  const encodedPath = path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const apiUrl = `https://api.github.com/repos/${cfg.dataOwner}/${cfg.dataRepo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.dataRef)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (cfg.dataToken) {
    headers.Authorization = `Bearer ${cfg.dataToken}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  const apiRes = await fetch(apiUrl, { cache: "no-store", headers });
  if (apiRes.ok) {
    const payload = (await apiRes.json()) as {
      content?: string;
      encoding?: string;
      download_url?: string;
    };
    if (payload?.content && payload.encoding === "base64") {
      return JSON.parse(Buffer.from(payload.content, "base64").toString("utf-8")) as T;
    }
    if (payload?.download_url) {
      const res = await fetch(payload.download_url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
      return (await res.json()) as T;
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}/${path}`;
  const res = await fetch(rawUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
  return (await res.json()) as T;
}

async function fetchRepoText(path: string, cfg: SourceCfg): Promise<string> {
  const encodedPath = path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const apiUrl = `https://api.github.com/repos/${cfg.dataOwner}/${cfg.dataRepo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.dataRef)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (cfg.dataToken) {
    headers.Authorization = `Bearer ${cfg.dataToken}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  const apiRes = await fetch(apiUrl, { cache: "no-store", headers });
  if (apiRes.ok) {
    const payload = (await apiRes.json()) as {
      content?: string;
      encoding?: string;
      download_url?: string;
    };
    if (payload?.content && payload.encoding === "base64") {
      return Buffer.from(payload.content, "base64").toString("utf-8");
    }
    if (payload?.download_url) {
      const res = await fetch(payload.download_url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
      return await res.text();
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}/${path}`;
  const res = await fetch(rawUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
  return await res.text();
}

async function loadTransferProjectionLookup(
  season: number,
  cfg: SourceCfg,
): Promise<Record<string, TransferProjectionCacheRow>> {
  const key = `${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}:${season}`;
  const cached = transferProjectionLookupMemo.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const lookup: Record<string, TransferProjectionCacheRow> = {};
    const candidates = [
      `player_cards_pipeline/data/cache/transfer_projection/${normSeason(season)}_part1.json`,
      `player_cards_pipeline/data/cache/transfer_projection/${normSeason(season)}_part2.json`,
    ];
    for (const path of candidates) {
      try {
        const file = await fetchRepoJson<TransferProjectionCacheFile>(path, cfg);
        for (const row of file.rows ?? []) {
          if (!row || typeof row !== "object") continue;
          const player = String(row.player ?? "").trim();
          const team = String(row.team ?? "").trim();
          const rowSeason = normSeason(row.season ?? season);
          if (!player || !team || !rowSeason) continue;
          lookup[transferCacheKey(player, team, rowSeason)] = row;
        }
      } catch {
        // Missing part files are fine; we just use whatever is available.
      }
    }
    return lookup;
  })();

  transferProjectionLookupMemo.set(key, promise);
  return promise;
}

async function loadBtBioFallback(
  season: number,
  team: string,
  player: string,
  cfg: SourceCfg,
): Promise<Record<string, string>> {
  for (const path of btCsvCandidates(cfg)) {
    try {
      const text = await fetchRepoText(path, cfg);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) continue;
      const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
      const pIdx = findCol(header, ["player_name", "player", "name", "plyr"]);
      const tIdx = findCol(header, ["team", "school", "tm", "team_name"]);
      const yIdx = findCol(header, ["year", "season", "yr"]);
      const posIdx = findCol(header, ["pos", "position"]);
      const htIdx = findCol(header, ["ht", "height"]);
      if (pIdx < 0 || tIdx < 0 || yIdx < 0) continue;

      const np = normPlayer(player);
      const nt = normTeam(team);
      const ys = normSeason(season);
      for (let i = 1; i < lines.length; i += 1) {
        const cols = parseCsvLine(lines[i]);
        const p = String(cols[pIdx] ?? "").trim();
        const t = String(cols[tIdx] ?? "").trim();
        const y = normSeason(cols[yIdx] ?? "");
        if (!p || !t || y !== ys) continue;
        if (normPlayer(p) !== np || normTeam(t) !== nt) continue;
        return {
          position: posIdx >= 0 ? String(cols[posIdx] ?? "").trim() : "",
          height: htIdx >= 0 ? String(cols[htIdx] ?? "").trim() : "",
        };
      }
    } catch {
      continue;
    }
  }
  return {};
}

async function loadBundledBioLookup(
  gender: Gender,
  season: number,
): Promise<Record<string, BundledBioLookupRow>> {
  const key = `${gender}:${season}`;
  if (!bundledBioLookupMemo.has(key)) {
    bundledBioLookupMemo.set(
      key,
      (async () => {
        try {
          const path = join(process.cwd(), "src", "data", "card-bio-lookups", `${gender}-${season}.json`);
          const raw = await readFile(path, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, BundledBioLookupRow>;
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          return {};
        }
      })(),
    );
  }
  return bundledBioLookupMemo.get(key)!;
}

async function loadBundledBioFallback(
  season: number,
  team: string,
  player: string,
  gender: Gender,
): Promise<Record<string, string>> {
  const lookup = await loadBundledBioLookup(gender, season);
  const directKey = `${normTeam(team)}::${normPlayer(player)}`;
  const direct = lookup[directKey];
  const row =
    direct ||
    Object.values(lookup).find((candidate) => normPlayer(candidate.player || "") === normPlayer(player));
  if (!row) return {};
  return {
    position: String(row.enriched_position || row.jason_position || "").trim(),
    height: String(row.bt_height || row.listed_height || row.enriched_height || "").trim(),
    statistical_height: String(row.statistical_height || "").trim(),
    statistical_height_delta: String(row.statistical_height_delta || "").trim(),
  };
}

async function enrichPayloadBio(payload: CardPayload, cfg: SourceCfg, gender: Gender): Promise<CardPayload> {
  const bio = payload.bio ?? {};
  const needsPosition = !String(bio.position ?? "").trim();
  const needsHeight = !String(bio.height ?? "").trim();
  const needsStatHeight =
    !String(
      bio.statistical_height_text ??
        bio.statistical_height ??
        bio.stat_height ??
        bio.statisticalHeight ??
        "",
    ).trim();
  if (!needsPosition && !needsHeight && !needsStatHeight) return payload;

  const bundledBio = await loadBundledBioFallback(
    Number(payload.season || 0),
    payload.team,
    payload.player,
    gender,
  );

  const btBio = await loadBtBioFallback(
    Number(payload.season || 0),
    payload.team,
    payload.player,
    cfg,
  );
  const nextPosition =
    String(bio.position ?? "").trim() ||
    String(bundledBio.position || "").trim() ||
    String(btBio.position || "").trim();
  const nextHeight =
    String(bio.height ?? "").trim() ||
    String(btBio.height || "").trim() ||
    String(bundledBio.height || "").trim();
  const nextStatHeight =
    String(
      bio.statistical_height_text ??
        bio.statistical_height ??
        bio.stat_height ??
        bio.statisticalHeight ??
        "",
    ).trim() || String(bundledBio.statistical_height || "").trim();
  const nextStatHeightDelta =
    String(
      bio.statistical_height_delta ??
        bio.stat_height_delta ??
        bio.statisticalHeightDelta ??
        "",
    ).trim() || String(bundledBio.statistical_height_delta || "").trim();

  if (!nextPosition && !nextHeight && !nextStatHeight) return payload;

  return {
    ...payload,
    bio: {
      ...bio,
      position: nextPosition,
      height: nextHeight,
      statistical_height: nextStatHeight,
      statistical_height_text: nextStatHeight,
      statistical_height_delta: nextStatHeightDelta,
    },
  };
}

export function mergedSectionsHtml(payload: CardPayload): Record<string, string> {
  const merged: Record<string, string> = {};
  const sections = payload.sections_html ?? {};
  for (const [key, value] of Object.entries(sections)) {
    if (typeof value === "string" && value.trim()) merged[key] = value;
  }
  const bundles = payload.section_bundles ?? {};
  for (const bundle of [bundles.core ?? {}, bundles.heavy ?? {}]) {
    for (const [key, value] of Object.entries(bundle)) {
      if (typeof value !== "string") continue;
      if (!value.trim()) continue;
      if (merged[key]) continue;
      merged[key] = value;
    }
  }
  return merged;
}

export async function loadTransferProjectionHtml(
  season: number,
  team: string,
  player: string,
  genderRaw: string | undefined,
  destinationConference: string,
): Promise<string> {
  const gender = parseGender(genderRaw);
  const cfg = getSourceCfg(gender);
  const lookup = await loadTransferProjectionLookup(season, cfg);
  const row = lookup[transferCacheKey(player, team, season)];
  if (!row?.projections) {
    return renderTransferProjectionPanel({
      destConfRaw: String(destinationConference).trim() || "Selected conference",
      predicted: {},
      transferGrade: "N/A",
      weightedCount: 0,
    });
  }

  const destKey = conferenceKey(destinationConference);
  const projection =
    row.projections[destKey] ||
    row.projections[conferenceKey(destinationConference.replace(/\s+/g, ""))] ||
    row.projections[String(destinationConference).trim().toLowerCase()];

  const projectedStats = projection?.projected_stats ?? null;
  if (!projectedStats) {
    return renderTransferProjectionPanel({
      destConfRaw: String(destinationConference).trim() || "Selected conference",
      predicted: {},
      transferGrade: String(projection?.transfer_grade ?? "").trim() || "N/A",
      weightedCount: Number(projection?.weighted_comp_count ?? 0) || 0,
    });
  }

  const predicted: TransferProjectionStatRow = {};
  for (const [key, value] of Object.entries(projectedStats)) {
    if (typeof value === "number" && Number.isFinite(value)) predicted[key] = value;
  }

  if (!Object.keys(predicted).length) {
    return renderTransferProjectionPanel({
      destConfRaw: String(destinationConference).trim() || "Selected conference",
      predicted: {},
      transferGrade: String(projection?.transfer_grade ?? "").trim() || "N/A",
      weightedCount: Number(projection?.weighted_comp_count ?? 0) || 0,
    });
  }

  return renderTransferProjectionPanel({
    destConfRaw: String(destinationConference).trim(),
    predicted,
    transferGrade: String(projection?.transfer_grade ?? "").trim(),
    weightedCount: Number(projection?.weighted_comp_count ?? 0) || 0,
  });
}

export async function loadStaticPayload(
  season: number,
  team: string,
  player: string,
  genderRaw?: string,
): Promise<CardPayload> {
  const gender = parseGender(genderRaw);
  const cfg = getSourceCfg(gender);
  const resolvedSeason = normSeason(season) || String(season);
  const sections_html = await loadWorkflowSectionsHtml(season, team, player, cfg);
  const btRows = await loadBtRowsForSeason(season, cfg);
  const enrichedLookup = await loadEnrichedLookup(season, gender, cfg);
  const enrichedRow = enrichedLookup[normalizedSectionKey(player, team, season)];
  const targetRow =
    btRows.find(
      (row) =>
        normPlayer(btGet(row, ["player_name", "player", "name"])) === normPlayer(player) &&
        normTeam(btGet(row, ["team", "school"])) === normTeam(team) &&
        normSeason(btGet(row, ["year", "season", "yr"])) === resolvedSeason,
    ) ??
    btRows.find(
      (row) =>
        normPlayer(btGet(row, ["player_name", "player", "name"])) === normPlayer(player) &&
        normSeason(btGet(row, ["year", "season", "yr"])) === resolvedSeason,
    ) ??
    null;

  const bundledBio = await loadBundledBioFallback(season, team, player, gender);
  const btBio = targetRow ? await loadBtBioFallback(season, team, player, cfg) : {};
  const deltaMaps = await loadHeightProfileDeltaMaps(season, cfg);
  const enrichedHeight =
    String(nestedValue(enrichedRow, "roster", "height") ?? nestedValue(enrichedRow, "height") ?? "").trim() ||
    String(nestedValue(enrichedRow, "bio", "height") ?? "").trim();
  const enrichedPosition =
    String(nestedValue(enrichedRow, "roster", "pos") ?? nestedValue(enrichedRow, "position") ?? nestedValue(enrichedRow, "bio", "position") ?? "").trim();
  const listedHeight =
    String(bundledBio?.bt_height ?? bundledBio?.listed_height ?? bundledBio?.enriched_height ?? "").trim() ||
    String(btBio.height || "").trim() ||
    enrichedHeight;
  const statDelta = computeStatisticalHeightDelta(player, team, targetRow, listedHeight, deltaMaps);
  const statisticalHeight =
    statDelta !== null && listedHeight
      ? inchesToHeightStr((heightToInches(listedHeight) ?? 0) + statDelta)
      : String(bundledBio?.statistical_height || "").trim();
  const bio: Record<string, unknown> = {
    position:
      String(bundledBio?.enriched_position ?? bundledBio?.jason_position ?? "").trim() ||
      String(btBio.position || "").trim() ||
      enrichedPosition ||
      String(btGet(targetRow ?? {}, ["pos", "position", "role"]) ?? "").trim() ||
      "N/A",
    height: listedHeight || "N/A",
    age_june25: "N/A",
    rsci: "N/A",
  };
  if (statisticalHeight) {
    bio.statistical_height = statisticalHeight;
    bio.statistical_height_text = statDelta !== null ? `${statisticalHeight}, ${statDelta > 0 ? "+" : ""}${statDelta.toFixed(2)} in` : statisticalHeight;
    bio.statistical_height_delta = statDelta !== null ? String(statDelta) : String(bundledBio.statistical_height_delta || "");
  } else if (bundledBio) {
    bio.statistical_height = String(bundledBio.statistical_height || "").trim();
    bio.statistical_height_text = String(bundledBio.statistical_height || "").trim();
    bio.statistical_height_delta = String(bundledBio.statistical_height_delta || "").trim();
  }

  const players = btRows
    .map((row) => buildPlayerGameStat(row))
    .filter((row): row is PlayerGameStat => Boolean(row));
  const target = buildPlayerGameStat(targetRow ?? {}) ?? {
    player,
    team,
    season: resolvedSeason,
    games: 1,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
  };
  const per_game_percentiles = buildPerGamePercentiles(players, target, 5, btRows);

  const per_game: Record<string, unknown> = {
    ppg: target.games > 0 ? target.points / target.games : null,
    rpg: target.games > 0 ? target.rebounds / target.games : null,
    apg: target.games > 0 ? target.assists / target.games : null,
    spg: target.games > 0 ? target.steals / target.games : null,
    bpg: target.games > 0 ? target.blocks / target.games : null,
    fg_pct: target.fga > 0 ? (100 * target.fgm) / target.fga : null,
    tp_pct: target.tpa > 0 ? (100 * target.tpm) / target.tpa : null,
    ft_pct: target.fta > 0 ? (100 * target.ftm) / target.fta : null,
    percentiles: per_game_percentiles,
  };

  const shotBuild = enrichedRow ? buildShotsFromEnrichedRow(enrichedRow) : { shots: [], makes: 0, attempts: 0 };
  const shot_chart: Record<string, unknown> = {
    shots: shotBuild.shots,
    makes: shotBuild.makes,
    attempts: shotBuild.attempts,
    fg_pct: shotBuild.attempts > 0 ? (100 * shotBuild.makes) / shotBuild.attempts : null,
    pps_over_expectation_line: "Points per Shot Over Expectation: N/A",
  };

  return {
    schema_version: "workflow-cache-v1",
    player,
    team,
    season: resolvedSeason,
    bio,
    per_game,
    shot_chart,
    sections_html,
  };
}
