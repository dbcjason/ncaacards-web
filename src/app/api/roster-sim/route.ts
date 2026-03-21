import { NextRequest, NextResponse } from "next/server";

const DATA_OWNER = process.env.GITHUB_DATA_OWNER || "dbcjason";
const DATA_REPO = process.env.GITHUB_DATA_REPO || "NCAACards";
const DATA_REF = process.env.GITHUB_DATA_REF || "main";
const BT_CSV_PATH = process.env.GITHUB_BT_CSV_PATH || "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv";

type PlayerRow = {
  player: string;
  team: string;
  season: number;
  mpg: number;
  ORtg: number;
  drtg: number;
  AST_per: number;
  TO_per: number;
  stl_per: number;
  blk_per: number;
  ORB_per: number;
  DRB_per: number;
  eFG: number;
  TP_per: number;
  TS_per: number;
};

type MetricDef = { key: string; label: string; higherIsBetter: boolean };

const METRICS: MetricDef[] = [
  { key: "net", label: "Net Rtg", higherIsBetter: true },
  { key: "off", label: "Off Rtg", higherIsBetter: true },
  { key: "def", label: "Def Rtg", higherIsBetter: false },
  { key: "ast100", label: "Ast/100", higherIsBetter: true },
  { key: "tov100", label: "TOV/100", higherIsBetter: false },
  { key: "stl100", label: "Stl/100", higherIsBetter: true },
  { key: "blk100", label: "Blk/100", higherIsBetter: true },
  { key: "reb100", label: "Reb/100", higherIsBetter: true },
  { key: "oreb", label: "Off Reb%", higherIsBetter: true },
  { key: "fg", label: "FG%", higherIsBetter: true },
  { key: "tp", label: "3P%", higherIsBetter: true },
  { key: "ts", label: "TS%", higherIsBetter: true },
];

type SeasonCache = {
  rows: PlayerRow[];
  rosterByTeam: Record<string, PlayerRow[]>;
  playerDefaults: Record<string, number>;
  loadedAt: number;
};

const seasonCache = new Map<number, SeasonCache>();
const TTL_MS = 1000 * 60 * 20;

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

function toNum(v: string | undefined): number {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeTeamName(team: string, teams: string[]): string {
  if (teams.includes(team)) return team;
  const low = team.toLowerCase().trim();
  const exact = teams.find((t) => t.toLowerCase() === low);
  if (exact) return exact;
  return team;
}

async function loadSeasonData(season: number): Promise<SeasonCache> {
  const cached = seasonCache.get(season);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;

  const url = `https://raw.githubusercontent.com/${encodeURIComponent(DATA_OWNER)}/${encodeURIComponent(
    DATA_REPO,
  )}/${encodeURIComponent(DATA_REF)}/${BT_CSV_PATH}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch BT CSV (${res.status})`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("BT CSV has no rows");

  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const required = ["player_name", "team", "year", "mp", "ORtg", "drtg", "AST_per", "TO_per", "stl_per", "blk_per", "ORB_per", "DRB_per", "eFG", "TP_per", "TS_per"];
  for (const c of required) {
    if (typeof idx[c] !== "number") throw new Error(`BT CSV missing column: ${c}`);
  }

  const rows: PlayerRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const yr = toNum(cols[idx.year]);
    if (yr !== season) continue;
    const player = (cols[idx.player_name] ?? "").trim();
    const team = (cols[idx.team] ?? "").trim();
    if (!player || !team) continue;
    rows.push({
      player,
      team,
      season: yr,
      mpg: toNum(cols[idx.mp]),
      ORtg: toNum(cols[idx.ORtg]),
      drtg: toNum(cols[idx.drtg]),
      AST_per: toNum(cols[idx.AST_per]),
      TO_per: toNum(cols[idx.TO_per]),
      stl_per: toNum(cols[idx.stl_per]),
      blk_per: toNum(cols[idx.blk_per]),
      ORB_per: toNum(cols[idx.ORB_per]),
      DRB_per: toNum(cols[idx.DRB_per]),
      eFG: toNum(cols[idx.eFG]),
      TP_per: toNum(cols[idx.TP_per]),
      TS_per: toNum(cols[idx.TS_per]),
    });
  }

  const rosterByTeam: Record<string, PlayerRow[]> = {};
  const playerDefaults: Record<string, number> = {};
  for (const r of rows) {
    if (!rosterByTeam[r.team]) rosterByTeam[r.team] = [];
    rosterByTeam[r.team].push(r);
    const prev = playerDefaults[r.player] ?? 0;
    if (r.mpg > prev) playerDefaults[r.player] = r.mpg;
  }

  for (const t of Object.keys(rosterByTeam)) {
    rosterByTeam[t].sort((a, b) => b.mpg - a.mpg || a.player.localeCompare(b.player));
  }

  const out: SeasonCache = { rows, rosterByTeam, playerDefaults, loadedAt: Date.now() };
  seasonCache.set(season, out);
  return out;
}

function weightedAvg(players: PlayerRow[], minutes: Record<string, number>, key: keyof PlayerRow): number {
  let num = 0;
  let den = 0;
  for (const p of players) {
    const w = Number(minutes[p.player] ?? p.mpg ?? 0);
    if (!Number.isFinite(w) || w <= 0) continue;
    num += w * Number(p[key] ?? 0);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

function computeMetricMap(players: PlayerRow[], minutes: Record<string, number>): Record<string, number> {
  const off = weightedAvg(players, minutes, "ORtg");
  const def = weightedAvg(players, minutes, "drtg");
  const ast = weightedAvg(players, minutes, "AST_per");
  const tov = weightedAvg(players, minutes, "TO_per");
  const stl = weightedAvg(players, minutes, "stl_per");
  const blk = weightedAvg(players, minutes, "blk_per");
  const oreb = weightedAvg(players, minutes, "ORB_per");
  const dreb = weightedAvg(players, minutes, "DRB_per");
  const fg = weightedAvg(players, minutes, "eFG");
  const tp = weightedAvg(players, minutes, "TP_per");
  const ts = weightedAvg(players, minutes, "TS_per");
  return {
    net: off - def,
    off,
    def,
    ast100: ast,
    tov100: tov,
    stl100: stl,
    blk100: blk,
    reb100: oreb + dreb,
    oreb,
    fg,
    tp,
    ts,
  };
}

function rankForMetric(valuesByTeam: Record<string, number>, team: string, higherIsBetter: boolean): number {
  const arr = Object.entries(valuesByTeam).sort((a, b) => {
    const d = a[1] - b[1];
    return higherIsBetter ? -d : d;
  });
  const idx = arr.findIndex(([t]) => t === team);
  return idx >= 0 ? idx + 1 : arr.length;
}

export async function GET(req: NextRequest) {
  try {
    const season = Number(req.nextUrl.searchParams.get("season") ?? "2026");
    const teamRaw = (req.nextUrl.searchParams.get("team") ?? "").trim();
    if (!Number.isFinite(season)) {
      return NextResponse.json({ ok: false, error: "Invalid season" }, { status: 400 });
    }

    const data = await loadSeasonData(season);
    const teams = Object.keys(data.rosterByTeam).sort((a, b) => a.localeCompare(b));
    const team = teamRaw ? normalizeTeamName(teamRaw, teams) : teams[0] ?? "";
    const roster = (data.rosterByTeam[team] ?? []).map((p) => ({ player: p.player, mpg: Number(p.mpg.toFixed(1)) }));

    return NextResponse.json({
      ok: true,
      source: "live_bt",
      season,
      team,
      teams,
      roster,
      playerDefaults: data.playerDefaults,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      season: number;
      team: string;
      addPlayers?: string[];
      removePlayers?: string[];
      rosterMinutes?: Record<string, number>;
    };

    const season = Number(body.season ?? 2026);
    const addPlayers = Array.isArray(body.addPlayers) ? body.addPlayers.map(String) : [];
    const removePlayers = new Set(Array.isArray(body.removePlayers) ? body.removePlayers.map(String) : []);
    const rosterMinutesIn = body.rosterMinutes && typeof body.rosterMinutes === "object" ? body.rosterMinutes : {};

    const data = await loadSeasonData(season);
    const allTeams = Object.keys(data.rosterByTeam);
    const team = normalizeTeamName(String(body.team ?? ""), allTeams);
    const teamRows = data.rosterByTeam[team] ?? [];

    const baseByPlayer = new Map<string, PlayerRow>();
    for (const p of teamRows) baseByPlayer.set(p.player, p);

    for (const p of addPlayers) {
      if (baseByPlayer.has(p)) continue;
      const hit = data.rows.find((r) => r.player === p);
      if (hit) baseByPlayer.set(p, hit);
    }
    for (const p of removePlayers) baseByPlayer.delete(p);

    const currentPlayers = [...teamRows];
    const newPlayers = [...baseByPlayer.values()];

    const currentMinutes: Record<string, number> = {};
    for (const p of currentPlayers) currentMinutes[p.player] = p.mpg;

    const newMinutes: Record<string, number> = {};
    for (const p of newPlayers) {
      const n = Number((rosterMinutesIn as Record<string, unknown>)[p.player]);
      if (Number.isFinite(n) && n >= 0) newMinutes[p.player] = n;
      else newMinutes[p.player] = p.mpg;
    }

    const currentMapByTeam: Record<string, Record<string, number>> = {};
    for (const t of allTeams) {
      const roster = data.rosterByTeam[t] ?? [];
      const mins: Record<string, number> = {};
      for (const p of roster) mins[p.player] = p.mpg;
      currentMapByTeam[t] = computeMetricMap(roster, mins);
    }

    const editedMapByTeam: Record<string, Record<string, number>> = { ...currentMapByTeam, [team]: computeMetricMap(newPlayers, newMinutes) };
    const currentTeamMap = currentMapByTeam[team] ?? computeMetricMap(currentPlayers, currentMinutes);
    const newTeamMap = editedMapByTeam[team] ?? computeMetricMap(newPlayers, newMinutes);

    const metrics = METRICS.map((m) => {
      const currentValues: Record<string, number> = {};
      const editedValues: Record<string, number> = {};
      for (const t of allTeams) {
        currentValues[t] = currentMapByTeam[t]?.[m.key] ?? 0;
        editedValues[t] = editedMapByTeam[t]?.[m.key] ?? 0;
      }
      const cur = currentTeamMap[m.key] ?? 0;
      const neu = newTeamMap[m.key] ?? 0;
      return {
        metric: m.label,
        current: Number(cur.toFixed(2)),
        edited: Number(neu.toFixed(2)),
        delta: Number((neu - cur).toFixed(2)),
        current_rank: rankForMetric(currentValues, team, m.higherIsBetter),
        edited_rank: rankForMetric(editedValues, team, m.higherIsBetter),
        total_teams: allTeams.length,
      };
    });

    const activeRoster = newPlayers
      .map((p) => ({ player: p.player, mpg: Number((newMinutes[p.player] ?? p.mpg).toFixed(1)) }))
      .sort((a, b) => b.mpg - a.mpg || a.player.localeCompare(b.player));

    return NextResponse.json({
      ok: true,
      source: "live_bt",
      cache: "live",
      season,
      team,
      metrics,
      activeRoster,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
