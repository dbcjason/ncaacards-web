import { NextRequest, NextResponse } from "next/server";
import { resolveTeamPlayerForSeason } from "@/lib/options";

type BasePayload = {
  player: string;
  team: string;
  season: string;
  bio: Record<string, unknown>;
  per_game: Record<string, unknown>;
  sections_html: Record<string, string>;
};

const DATA_OWNER = process.env.GITHUB_DATA_OWNER || "dbcjason";
const DATA_REPO = process.env.GITHUB_DATA_REPO || "NCAACards";
const DATA_REF = process.env.GITHUB_DATA_REF || "main";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const BT_CSV_PATH =
  process.env.GITHUB_BT_CSV_PATH ||
  "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv";
const BIO_CSV_PATH =
  process.env.GITHUB_BIO_CSV_PATH ||
  "player_cards_pipeline/data/manual/bio/trank_data_5.csv";

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

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCol(header: string[], names: string[]): number {
  const h = header.map((x) => norm(x));
  for (const n of names) {
    const idx = h.findIndex((x) => x === norm(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

function toNum(v: string, mult = 1): number | null {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

async function fetchText(path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${path}`;
  const headers: Record<string, string> = {};
  if (GH_TOKEN) {
    headers.Authorization = `Bearer ${GH_TOKEN}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  const r = await fetch(url, { cache: "no-store", headers });
  if (!r.ok) throw new Error(`Fetch failed ${path} (${r.status})`);
  return await r.text();
}

async function loadBtRow(season: number, team: string, player: string): Promise<Record<string, string> | null> {
  const text = await fetchText(BT_CSV_PATH);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const pIdx = findCol(header, ["player_name", "player", "name", "PlayerName"]);
  const tIdx = findCol(header, ["team", "school", "TeamName"]);
  const yIdx = findCol(header, ["year", "season", "yr"]);
  if (pIdx < 0 || tIdx < 0 || yIdx < 0) return null;

  const np = norm(player);
  const nt = norm(team);
  const ys = String(season);
  let fallback: Record<string, string> | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const y = String(cols[yIdx] ?? "").trim();
    if (y !== ys) continue;
    const p = String(cols[pIdx] ?? "").trim();
    const t = String(cols[tIdx] ?? "").trim();
    if (!p || !t) continue;
    if (norm(p) === np && norm(t) === nt) {
      const row: Record<string, string> = {};
      header.forEach((h, idx) => (row[h] = String(cols[idx] ?? "")));
      return row;
    }
    if (!fallback && norm(p) === np) {
      const row: Record<string, string> = {};
      header.forEach((h, idx) => (row[h] = String(cols[idx] ?? "")));
      fallback = row;
    }
  }
  return fallback;
}

async function loadBio(season: number, team: string, player: string): Promise<Record<string, string>> {
  try {
    const text = await fetchText(BIO_CSV_PATH);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return {};
    const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
    const pIdx = findCol(header, ["player", "player_name", "name"]);
    const tIdx = findCol(header, ["team", "school"]);
    const yIdx = findCol(header, ["season", "year", "yr"]);
    if (pIdx < 0) return {};
    const np = norm(player);
    const nt = norm(team);
    const ys = String(season);
    for (let i = 1; i < lines.length; i += 1) {
      const cols = parseCsvLine(lines[i]);
      const p = String(cols[pIdx] ?? "").trim();
      if (norm(p) !== np) continue;
      const t = tIdx >= 0 ? String(cols[tIdx] ?? "").trim() : "";
      const y = yIdx >= 0 ? String(cols[yIdx] ?? "").trim() : "";
      if (y && y !== ys) continue;
      if (t && norm(t) !== nt) continue;
      const row: Record<string, string> = {};
      header.forEach((h, idx) => (row[h] = String(cols[idx] ?? "")));
      return row;
    }
    return {};
  } catch {
    return {};
  }
}

function pick(row: Record<string, string>, names: string[], mult = 1): number | null {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((x) => norm(x) === norm(n));
    if (!k) continue;
    const v = toNum(row[k], mult);
    if (v !== null) return v;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { season: number; team: string; player: string };
    const season = Number(body.season);
    const resolved = await resolveTeamPlayerForSeason(
      season,
      String(body.team ?? ""),
      String(body.player ?? ""),
    );
    const team = resolved.team;
    const player = resolved.player;

    const bt = await loadBtRow(season, team, player);
    if (!bt) {
      return NextResponse.json(
        { ok: false, error: `No BT row found for ${player} (${season})` },
        { status: 404 },
      );
    }
    const bioRow = await loadBio(season, team, player);

    const perGame = {
      ppg: pick(bt, ["pts", "ppg", "points"]) ?? null,
      rpg: pick(bt, ["orb", "oreb"]) !== null && pick(bt, ["drb", "dreb"]) !== null
        ? ((pick(bt, ["orb", "oreb"]) ?? 0) + (pick(bt, ["drb", "dreb"]) ?? 0))
        : (pick(bt, ["trb", "reb", "rpg"]) ?? null),
      apg: pick(bt, ["ast", "apg"]) ?? null,
      spg: pick(bt, ["stl", "spg"]) ?? null,
      bpg: pick(bt, ["blk", "bpg"]) ?? null,
      fg_pct: pick(bt, ["fg%", "fg_pct"], 1) ?? (pick(bt, ["fgp"], 100) ?? null),
      tp_pct: pick(bt, ["3p%", "tp_pct", "3pt%"], 1) ?? (pick(bt, ["3pp"], 100) ?? null),
      ft_pct: pick(bt, ["ft%", "ft_pct"], 1) ?? (pick(bt, ["ftp"], 100) ?? null),
      percentiles: {},
    };

    const payload: BasePayload = {
      player,
      team,
      season: String(season),
      bio: {
        position:
          bioRow.position || bioRow.pos || bt.pos || bt.position || "N/A",
        height: bioRow.height || bioRow.ht || "N/A",
        age_june25: bioRow.age_june25 || bioRow.age || "N/A",
        rsci: bioRow.rsci || "N/A",
      },
      per_game: perGame,
      sections_html: {
        grade_boxes_html: `<div class="text-zinc-300">Impact/Scoring/Playmaking/Defense grades loading from live model...</div>`,
        bt_percentiles_html: `<div class="text-zinc-300">Advanced percentiles ready. More rows load as heavy model completes.</div>`,
        self_creation_html: `<div class="text-zinc-300">Self creation section loads from live model cache.</div>`,
        playstyles_html: `<div class="text-zinc-300">Playstyles section loads from live model cache.</div>`,
        team_impact_html: `<div class="text-zinc-300">Team impact section loads from live model cache.</div>`,
        shot_diet_html: `<div class="text-zinc-300">Shot diet section loads from live model cache.</div>`,
      },
    };

    return NextResponse.json({ ok: true, payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
