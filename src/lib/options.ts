type SeasonOptions = {
  teams: string[];
  playersByTeam: Record<string, string[]>;
  allPlayers: string[];
  loadedAt: number;
};

const seasonCache = new Map<number, SeasonOptions>();
const TTL_MS = 1000 * 60 * 60;

const DATA_OWNER = process.env.GITHUB_DATA_OWNER || "dbcjason";
const DATA_REPO = process.env.GITHUB_DATA_REPO || "NCAACards";
const DATA_REF = process.env.GITHUB_DATA_REF || "main";
const STATIC_ROOT =
  process.env.GITHUB_STATIC_PAYLOAD_ROOT || "player_cards_pipeline/public/cards";
const BT_PLAYERSTAT_JSON_TEMPLATE =
  process.env.GITHUB_BT_PLAYERSTAT_JSON_TEMPLATE ||
  "player_cards_pipeline/data/bt/raw_playerstat_json/{season}_pbp_playerstat_array.json";
const BT_CSV_PATH =
  process.env.GITHUB_BT_CSV_PATH ||
  "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv";
const BART_PREFIX = (process.env.GITHUB_BART_PREFIX || "").trim();
const BT_CSV_CANDIDATES = [
  BT_CSV_PATH,
  "player_cards_pipeline/data/bt/bt_advstats_2019_2026.csv",
  "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv",
  "player_cards_pipeline/data/bt/bt_advstats_2019_2025.csv",
  "player_cards_pipeline/data/bt/bt_advstats_2010_2025.csv",
  "player_cards_pipeline/data/bt/bt_advstats_2026.csv",
];

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

function normalizeColName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findCol(header: string[], names: string[]): number {
  const normalized = header.map((h) => normalizeColName(h));
  const targets = names.map((n) => normalizeColName(n));
  for (const target of targets) {
    const idx = normalized.findIndex((h) => h === target);
    if (idx >= 0) return idx;
  }
  return -1;
}

function seasonMatches(rawYear: string, season: number): boolean {
  const v = String(rawYear ?? "").trim();
  if (!v) return false;
  const n = Number(v);
  if (Number.isFinite(n)) return n === season;
  if (v.includes(String(season))) return true;
  const prev = String(season - 1);
  const two = String(season).slice(-2);
  if (v.includes(prev) && v.includes(two)) return true;
  return false;
}

function seasonMatchesPrev(rawYear: string, season: number): boolean {
  const v = String(rawYear ?? "").trim();
  if (!v) return false;
  const n = Number(v);
  if (Number.isFinite(n)) return n === season - 1;
  return v.includes(String(season - 1));
}

async function fetchSeasonOptionsFromBart(season: number): Promise<SeasonOptions> {
  const prefixes = Array.from(new Set([BART_PREFIX, BART_PREFIX ? "" : "ncaaw"])).filter((x) => x !== "__none__");
  let lastErr = "";
  for (const prefix of prefixes) {
    const pref = prefix ? `${prefix}/` : "";
    const url = `https://barttorvik.com/${pref}getadvstats.php?year=${season}&csv=1`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      lastErr = `Failed to fetch Bart CSV (${res.status})`;
      continue;
    }
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      lastErr = "Bart CSV returned no rows";
      continue;
    }
    const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
    const pIdx = findCol(header, ["player_name", "player", "name", "plyr"]);
    const tIdx = findCol(header, ["team", "school", "tm", "team_name", "school_name"]);
    if (pIdx < 0 || tIdx < 0) {
      lastErr = "Bart CSV missing player_name/team columns";
      continue;
    }
    const parsed = parseOptionsFromCsvText(text, { playerIdx: pIdx, teamIdx: tIdx });
    if (!parsed.teams.length) {
      lastErr = "Bart CSV returned zero teams";
      continue;
    }
    return parsed;
  }
  throw new Error(lastErr || "Failed to fetch Bart CSV");
}

async function fetchSeasonOptionsFromStaticIndex(season: number): Promise<SeasonOptions> {
  const path = `${STATIC_ROOT}/${season}/index.json`;
  const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch static index (${res.status})`);
  const arr = (await res.json()) as Array<{ player?: string; team?: string }>;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("Static index empty");
  const byTeam = new Map<string, Set<string>>();
  const allPlayersSet = new Set<string>();
  for (const row of arr) {
    const player = String(row?.player ?? "").trim();
    const team = String(row?.team ?? "").trim();
    if (!player || !team) continue;
    if (!byTeam.has(team)) byTeam.set(team, new Set<string>());
    byTeam.get(team)!.add(player);
    allPlayersSet.add(player);
  }
  const teams = Array.from(byTeam.keys()).sort((a, b) => a.localeCompare(b));
  const playersByTeam: Record<string, string[]> = {};
  for (const team of teams) {
    playersByTeam[team] = Array.from(byTeam.get(team) ?? []).sort((a, b) => a.localeCompare(b));
  }
  const allPlayers = Array.from(allPlayersSet).sort((a, b) => a.localeCompare(b));
  return { teams, playersByTeam, allPlayers, loadedAt: Date.now() };
}

function parseOptionsFromCsvText(
  text: string,
  opts: { playerIdx?: number; teamIdx?: number; yearIdx?: number; season?: number },
): SeasonOptions {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV returned no rows");
  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const pIdx =
    typeof opts.playerIdx === "number"
      ? opts.playerIdx
      : findCol(header, ["player_name", "player", "name", "plyr"]);
  const tIdx =
    typeof opts.teamIdx === "number"
      ? opts.teamIdx
      : findCol(header, ["team", "school", "tm", "team_name", "school_name"]);
  const yIdx = typeof opts.yearIdx === "number" ? opts.yearIdx : findCol(header, ["year", "season", "yr"]);
  if (pIdx < 0 || tIdx < 0) throw new Error("CSV missing player/team columns");

  const byTeam = new Map<string, Set<string>>();
  const allPlayersSet = new Set<string>();
  const seasonRows: string[][] = [];
  const prevSeasonRows: string[][] = [];
  const noSeasonRows: string[][] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (typeof opts.season === "number" && yIdx >= 0) {
      const rawYr = (cols[yIdx] ?? "").trim();
      if (seasonMatches(rawYr, opts.season)) {
        seasonRows.push(cols);
      } else if (seasonMatchesPrev(rawYr, opts.season)) {
        prevSeasonRows.push(cols);
      }
      continue;
    }
    noSeasonRows.push(cols);
  }

  const rowsToUse =
    typeof opts.season === "number" && yIdx >= 0
      ? seasonRows.length
        ? seasonRows
        : prevSeasonRows
      : noSeasonRows;

  for (const cols of rowsToUse) {
    const player = (cols[pIdx] ?? "").trim();
    const team = (cols[tIdx] ?? "").trim();
    if (!player || !team) continue;
    if (!byTeam.has(team)) byTeam.set(team, new Set<string>());
    byTeam.get(team)!.add(player);
    allPlayersSet.add(player);
  }

  const teams = Array.from(byTeam.keys()).sort((a, b) => a.localeCompare(b));
  const playersByTeam: Record<string, string[]> = {};
  for (const team of teams) {
    playersByTeam[team] = Array.from(byTeam.get(team) ?? []).sort((a, b) => a.localeCompare(b));
  }
  const allPlayers = Array.from(allPlayersSet).sort((a, b) => a.localeCompare(b));
  return { teams, playersByTeam, allPlayers, loadedAt: Date.now() };
}

function pickJsonKey(obj: Record<string, unknown>, keys: string[]): string | null {
  const map = new Map<string, string>();
  for (const k of Object.keys(obj)) map.set(normalizeColName(k), k);
  for (const k of keys) {
    const hit = map.get(normalizeColName(k));
    if (hit) return hit;
  }
  return null;
}

async function fetchSeasonOptionsFromGithubPlayerstatJson(season: number): Promise<SeasonOptions> {
  const path = BT_PLAYERSTAT_JSON_TEMPLATE.replace("{season}", String(season));
  const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch repo playerstat JSON (${res.status})`);
  const text = await res.text();
  const arr = JSON.parse(text) as unknown[];
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("Playerstat JSON empty");

  const byTeam = new Map<string, Set<string>>();
  const allPlayersSet = new Set<string>();
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const playerKey = pickJsonKey(obj, ["player_name", "player", "name", "plyr"]);
    const teamKey = pickJsonKey(obj, ["team", "school", "tm", "team_name", "school_name"]);
    if (!playerKey || !teamKey) continue;
    const player = String(obj[playerKey] ?? "").trim();
    const team = String(obj[teamKey] ?? "").trim();
    if (!player || !team) continue;
    if (!byTeam.has(team)) byTeam.set(team, new Set<string>());
    byTeam.get(team)!.add(player);
    allPlayersSet.add(player);
  }
  const teams = Array.from(byTeam.keys()).sort((a, b) => a.localeCompare(b));
  if (!teams.length) throw new Error("Playerstat JSON returned zero teams");
  const playersByTeam: Record<string, string[]> = {};
  for (const team of teams) {
    playersByTeam[team] = Array.from(byTeam.get(team) ?? []).sort((a, b) => a.localeCompare(b));
  }
  const allPlayers = Array.from(allPlayersSet).sort((a, b) => a.localeCompare(b));
  return { teams, playersByTeam, allPlayers, loadedAt: Date.now() };
}

async function fetchSeasonOptionsFromGithubLargeFile(season: number): Promise<SeasonOptions> {
  let lastErr = "";
  for (const path of BT_CSV_CANDIDATES) {
    const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${path}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      lastErr = `${path}: ${res.status}`;
      continue;
    }
    const text = await res.text();
    const parsed = parseOptionsFromCsvText(text, { season });
    if (parsed.teams.length > 0) return parsed;
    lastErr = `${path}: no teams`;
  }
  throw new Error(`Failed to fetch repo all-years CSV (${lastErr || "no valid path"})`);
}

export async function getSeasonOptions(season: number): Promise<SeasonOptions> {
  const cached = seasonCache.get(season);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;
  let fresh: SeasonOptions;
  try {
    fresh = await fetchSeasonOptionsFromGithubPlayerstatJson(season);
  } catch (ghJsonErr) {
    try {
      fresh = await fetchSeasonOptionsFromStaticIndex(season);
    } catch (staticErr) {
      try {
        fresh = await fetchSeasonOptionsFromBart(season);
      } catch (bartErr) {
        try {
          fresh = await fetchSeasonOptionsFromGithubLargeFile(season);
        } catch (ghLargeErr) {
          const gs = ghJsonErr instanceof Error ? ghJsonErr.message : String(ghJsonErr);
          const s = staticErr instanceof Error ? staticErr.message : String(staticErr);
          const b = bartErr instanceof Error ? bartErr.message : String(bartErr);
          const gl = ghLargeErr instanceof Error ? ghLargeErr.message : String(ghLargeErr);
          throw new Error(
            `Repo playerstat failed: ${gs} | Static index failed: ${s} | Bart failed: ${b} | Repo all-years failed: ${gl}`,
          );
        }
      }
    }
  }
  seasonCache.set(season, fresh);
  return fresh;
}

export async function resolveTeamPlayerForSeason(
  season: number,
  team: string,
  player: string,
): Promise<{ team: string; player: string }> {
  const opts = await getSeasonOptions(season);
  const nextTeam = opts.teams.includes(team) ? team : opts.teams.find((t) => t.toLowerCase() === team.toLowerCase()) ?? team;
  const candidates = opts.playersByTeam[nextTeam] ?? [];
  if (!candidates.length) return { team: nextTeam, player };
  const { resolveClosestName } = await import("@/lib/name-match");
  const nextPlayer = resolveClosestName(player, candidates);
  return { team: nextTeam, player: nextPlayer };
}
