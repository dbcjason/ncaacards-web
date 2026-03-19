type SeasonOptions = {
  teams: string[];
  playersByTeam: Record<string, string[]>;
  allPlayers: string[];
  loadedAt: number;
};

const seasonCache = new Map<number, SeasonOptions>();
const TTL_MS = 1000 * 60 * 60;

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

async function fetchSeasonOptionsFromBart(season: number): Promise<SeasonOptions> {
  const url = `https://barttorvik.com/getadvstats.php?year=${season}&csv=1`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch Bart CSV (${res.status})`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Bart CSV returned no rows");

  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const pIdx = header.findIndex((h) => h === "player_name");
  const tIdx = header.findIndex((h) => h === "team");
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

export async function getSeasonOptions(season: number): Promise<SeasonOptions> {
  const cached = seasonCache.get(season);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;
  const fresh = await fetchSeasonOptionsFromBart(season);
  seasonCache.set(season, fresh);
  return fresh;
}

