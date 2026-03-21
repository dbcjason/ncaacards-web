import { NextRequest, NextResponse } from "next/server";

type LeaderboardRow = {
  player: string;
  team: string;
  season: number;
  pos: string;
  age: number | null;
  height: string;
  rsci: number | null;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
};

const DATA_OWNER = process.env.GITHUB_DATA_OWNER || "dbcjason";
const DATA_REPO = process.env.GITHUB_DATA_REPO || "NCAACards";
const DATA_REF = process.env.GITHUB_DATA_REF || "main";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const BT_CSV_PATH =
  process.env.GITHUB_BT_CSV_PATH || "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv";

const METRIC_ALIASES: Record<string, string[]> = {
  ppg: ["pts", "ppg"],
  rpg: ["treb", "reb", "rpg"],
  apg: ["ast", "apg"],
  spg: ["stl", "spg"],
  bpg: ["blk", "bpg"],
  fg_pct: ["efg", "fg%", "fg_per"],
  ts_pct: ["ts_per", "ts%"],
  tp_pct: ["tp_per", "3p%", "3pt%"],
  tpa_100: ["3p/100?", "3pa/100"],
  ftr: ["ftr"],
  ast_pct: ["ast_per", "ast%"],
  ato: ["ast/tov", "a/to"],
  to_pct: ["to_per", "to%"],
  stl_pct: ["stl_per", "stl%"],
  blk_pct: ["blk_per", "blk%"],
  oreb_pct: ["orb_per", "oreb%"],
  dreb_pct: ["drb_per", "dreb%"],
  bpm: ["gbpm", "bpm"],
  rapm: ["dgbpm", "dbpm"],
  obpm: ["obpm", "ogbpm"],
  dbpm: ["dbpm", "dgbpm"],
};

const METRIC_KEYS = Object.keys(METRIC_ALIASES);

let memoRows: LeaderboardRow[] | null = null;
let memoTs = 0;
const MEMO_TTL_MS = 1000 * 60 * 60 * 24;

function norm(v: string): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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
  const h = header.map((x) => norm(x));
  for (const n of names) {
    const idx = h.findIndex((x) => x === norm(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

function toNum(v: unknown): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function calcAgeOnJune25(dob: string, seasonYear: number): number | null {
  const d = new Date(dob);
  if (!Number.isFinite(d.getTime())) return null;
  const ref = new Date(Date.UTC(seasonYear, 5, 25));
  let age = ref.getUTCFullYear() - d.getUTCFullYear();
  const m = ref.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) age -= 1;
  return Number.isFinite(age) ? age : null;
}

function percentile(values: number[], v: number): number {
  if (!values.length) return 0;
  let le = 0;
  for (const x of values) if (x <= v) le += 1;
  return Math.max(0, Math.min(100, Math.round((le / values.length) * 100)));
}

async function fetchCsvText(path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${path}`;
  const headers: Record<string, string> = {};
  if (GH_TOKEN) {
    headers.Authorization = `Bearer ${GH_TOKEN}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  const r = await fetch(url, { cache: "force-cache", next: { revalidate: 3600 }, headers });
  if (!r.ok) throw new Error(`Failed to fetch BT CSV (${r.status})`);
  return await r.text();
}

async function loadRows(): Promise<LeaderboardRow[]> {
  const now = Date.now();
  if (memoRows && now - memoTs < MEMO_TTL_MS) return memoRows;

  const text = await fetchCsvText(BT_CSV_PATH);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));

  const pIdx = findCol(header, ["player_name", "player"]);
  const tIdx = findCol(header, ["team", "school"]);
  const yIdx = findCol(header, ["year", "yr", "season"]);
  const posIdx = findCol(header, ["role", "pos", "position"]);
  const htIdx = findCol(header, ["ht", "height"]);
  const rsciIdx = findCol(header, ["rec rank", "rsci"]);
  const dobIdx = findCol(header, ["dob", "dateofbirth"]);
  if (pIdx < 0 || tIdx < 0 || yIdx < 0) return [];

  const metricCol: Record<string, number> = {};
  for (const key of METRIC_KEYS) {
    metricCol[key] = findCol(header, METRIC_ALIASES[key]);
  }

  const rows: LeaderboardRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const player = String(cols[pIdx] ?? "").trim();
    const team = String(cols[tIdx] ?? "").trim();
    const season = Number(String(cols[yIdx] ?? "").trim());
    if (!player || !team || !Number.isFinite(season)) continue;

    const values: Record<string, number | null> = {};
    for (const key of METRIC_KEYS) {
      const idx = metricCol[key];
      values[key] = idx >= 0 ? toNum(cols[idx]) : null;
    }

    const dob = dobIdx >= 0 ? String(cols[dobIdx] ?? "").trim() : "";
    rows.push({
      player,
      team,
      season,
      pos: posIdx >= 0 ? String(cols[posIdx] ?? "").trim() : "",
      age: calcAgeOnJune25(dob, season),
      height: htIdx >= 0 ? String(cols[htIdx] ?? "").trim() : "",
      rsci: rsciIdx >= 0 ? toNum(cols[rsciIdx]) : null,
      values,
      percentiles: {},
    });
  }

  // Precompute season-level percentiles once so query-time filtering is fast.
  const bySeason = new Map<number, LeaderboardRow[]>();
  for (const r of rows) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season)!.push(r);
  }
  for (const [, rs] of bySeason.entries()) {
    const metricVals: Record<string, number[]> = {};
    for (const key of METRIC_KEYS) {
      metricVals[key] = rs
        .map((x) => x.values[key])
        .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    }
    for (const row of rs) {
      const pct: Record<string, number | null> = {};
      for (const key of METRIC_KEYS) {
        const v = row.values[key];
        pct[key] = typeof v === "number" ? percentile(metricVals[key], v) : null;
      }
      row.percentiles = pct;
    }
  }

  memoRows = rows;
  memoTs = now;
  return rows;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      year?: string;
      age?: string;
      team?: string;
      height?: string;
      rsci?: string;
      position?: string;
      filters?: Array<{ metric: string; comparator: ">=" | "<="; value: number; mode: "stat" | "percentile" }>;
      sortBy?: string;
      sortDir?: "asc" | "desc";
      limit?: number;
    };

    const all = await loadRows();
    let rows = [...all];

    if (body.year && body.year !== "All") {
      const y = Number(body.year);
      if (Number.isFinite(y)) rows = rows.filter((r) => r.season === y);
    }
    if (body.age && body.age !== "All") {
      const a = Number(body.age);
      if (Number.isFinite(a)) rows = rows.filter((r) => r.age !== null && r.age === a);
    }
    if (body.team && body.team !== "All") {
      const needle = body.team.toLowerCase();
      rows = rows.filter((r) => r.team.toLowerCase().includes(needle));
    }
    if (body.height && body.height !== "All") {
      const needle = body.height.toLowerCase();
      rows = rows.filter((r) => r.height.toLowerCase().includes(needle));
    }
    if (body.position && body.position !== "All") {
      const p = body.position.toLowerCase();
      rows = rows.filter((r) => r.pos.toLowerCase().includes(p));
    }
    if (body.rsci && body.rsci !== "All") {
      const r = Number(body.rsci);
      if (Number.isFinite(r)) rows = rows.filter((x) => x.rsci !== null && x.rsci <= r);
    }

    const filters = Array.isArray(body.filters) ? body.filters : [];
    for (const f of filters) {
      if (!f || !f.metric || !METRIC_KEYS.includes(f.metric)) continue;
      const comparator = f.comparator === "<=" ? "<=" : ">=";
      const mode = f.mode === "percentile" ? "percentile" : "stat";
      const target = Number(f.value);
      if (!Number.isFinite(target)) continue;
      rows = rows.filter((r) => {
        const v = mode === "percentile" ? r.percentiles[f.metric] : r.values[f.metric];
        if (typeof v !== "number" || !Number.isFinite(v)) return false;
        return comparator === ">=" ? v >= target : v <= target;
      });
    }

    const sortBy = body.sortBy && METRIC_KEYS.includes(body.sortBy) ? body.sortBy : "bpm";
    const dir = body.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a.values[sortBy];
      const bv = b.values[sortBy];
      const na = typeof av === "number" ? av : -Infinity;
      const nb = typeof bv === "number" ? bv : -Infinity;
      if (na === nb) return a.player.localeCompare(b.player);
      return na > nb ? dir : -dir;
    });

    const limit = Math.max(1, Math.min(100, Number(body.limit) || 100));
    rows = rows.slice(0, limit);

    return NextResponse.json({ ok: true, rows, metricKeys: METRIC_KEYS });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
