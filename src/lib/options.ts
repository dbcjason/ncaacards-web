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
const BT_CSV_PATH =
  process.env.GITHUB_BT_CSV_PATH ||
  "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv";

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

async function fetchSeasonOptionsFromBart(season: number): Promise<SeasonOptions> {
  const url = `https://barttorvik.com/getadvstats.php?year=${season}&csv=1`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch Bart CSV (${res.status})`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Bart CSV returned no rows");

  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const pIdx = findCol(header, ["player_name", "player", "name"]);
  const tIdx = findCol(header, ["team", "school"]);
  if (pIdx < 0 || tIdx < 0) throw new Error("Bart CSV missing player_name/team columns");

  const byTeam = new Map<string, Set<string>>();
  const allPlayersSet = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
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

async function fetchSeasonOptionsFromGithub(season: number): Promise<SeasonOptions> {
  const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${BT_CSV_PATH}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch repo CSV (${res.status})`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Repo CSV returned no rows");

  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const pIdx = findCol(header, ["player_name", "player", "name"]);
  const tIdx = findCol(header, ["team", "school"]);
  const yIdx = findCol(header, ["year", "season", "yr"]);
  if (pIdx < 0 || tIdx < 0 || yIdx < 0) {
    throw new Error("Repo CSV missing player_name/team/year columns");
  }

  const byTeam = new Map<string, Set<string>>();
  const allPlayersSet = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const yearRaw = (cols[yIdx] ?? "").trim();
    const yr = Number(yearRaw);
    if (!Number.isFinite(yr) || yr !== season) continue;
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

export async function getSeasonOptions(season: number): Promise<SeasonOptions> {
  const cached = seasonCache.get(season);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;
  let fresh: SeasonOptions;
  try {
    fresh = await fetchSeasonOptionsFromBart(season);
  } catch (bartErr) {
    try {
      fresh = await fetchSeasonOptionsFromGithub(season);
    } catch (ghErr) {
      const b = bartErr instanceof Error ? bartErr.message : String(bartErr);
      const g = ghErr instanceof Error ? ghErr.message : String(ghErr);
      throw new Error(`Bart failed: ${b} | Repo failed: ${g}`);
    }
  }
  seasonCache.set(season, fresh);
  return fresh;
}
