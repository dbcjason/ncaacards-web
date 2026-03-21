import { NextRequest, NextResponse } from "next/server";

type Gender = "men" | "women";
type SourceCfg = {
  dataOwner: string;
  dataRepo: string;
  dataRef: string;
  btCsvPath: string;
  teamModelJsonPath: string;
  bartPrefix: string;
};

function parseGender(raw?: string): Gender {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
}

function getSourceCfg(gender: Gender): SourceCfg {
  if (gender === "women") {
    return {
      dataOwner: process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason",
      dataRepo: process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards",
      dataRef: process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main",
      btCsvPath: process.env.GITHUB_BT_CSV_PATH_WOMEN || process.env.GITHUB_BT_CSV_PATH || "player_cards_pipeline/data/bt/bt_advstats_2019_2026.csv",
      teamModelJsonPath:
        process.env.GITHUB_TEAM_MODEL_JSON_PATH_WOMEN ||
        process.env.GITHUB_TEAM_MODEL_JSON_PATH ||
        "player_cards_pipeline/data/models/team_interaction_ridge_v1.json",
      bartPrefix: (process.env.GITHUB_BART_PREFIX_WOMEN || "ncaaw").trim(),
    };
  }
  return {
    dataOwner: process.env.GITHUB_DATA_OWNER || "dbcjason",
    dataRepo: process.env.GITHUB_DATA_REPO || "NCAACards",
    dataRef: process.env.GITHUB_DATA_REF || "main",
    btCsvPath: process.env.GITHUB_BT_CSV_PATH || "player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv",
    teamModelJsonPath:
      process.env.GITHUB_TEAM_MODEL_JSON_PATH || "player_cards_pipeline/data/models/team_interaction_ridge_v1.json",
    bartPrefix: (process.env.GITHUB_BART_PREFIX || "").trim(),
  };
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

type PlayerRow = {
  player: string;
  team: string;
  season: number;
  gp: number;
  mpg: number;
  ORtg: number;
  drtg: number;
  usg: number;
  bpm: number;
  gbpm: number;
  dgbpm: number;
  adjoe: number;
  adrtg: number;
  FTM: number;
  FTA: number;
  twoPM: number;
  twoPA: number;
  TPM: number;
  TPA: number;
  ast: number;
  stl: number;
  blk: number;
  oreb: number;
  dreb: number;
  pts: number;
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
  { key: "oreb100", label: "OREB/100", higherIsBetter: true },
  { key: "fg", label: "FG%", higherIsBetter: true },
  { key: "tp", label: "3P%", higherIsBetter: true },
  { key: "ts", label: "TS%", higherIsBetter: true },
];

const DIRECT_ONLY_METRICS = new Set(["ast100", "stl100", "blk100", "reb100", "oreb100"]);

type SeasonCache = {
  rows: PlayerRow[];
  rosterByTeam: Record<string, PlayerRow[]>;
  playerDefaults: Record<string, number>;
  loadedAt: number;
};

type RidgeModel = {
  meanX: number[];
  stdX: number[];
  weights: number[];
  bias: number;
};

type TeamModelBundle = {
  version: string;
  feature_order: string[];
  metric_keys: string[];
  models: Record<string, RidgeModel>;
};

const seasonCache = new Map<string, SeasonCache>();
const modelCache = new Map<string, { loadedAt: number; modelByMetric: Record<string, RidgeModel> }>();
const pretrainedModelCache = new Map<string, { loadedAt: number; bundle: TeamModelBundle | null }>();
const TTL_MS = 1000 * 60 * 20;

const FEATURE_ORDER = [
  "n_players",
  "minutes_sum",
  "wm_pts",
  "wm_reb",
  "wm_ast",
  "wm_stl",
  "wm_blk",
  "wm_ortg",
  "wm_drtg",
  "wm_usg",
  "wm_ts",
  "wm_efg",
  "wm_tp",
  "wm_astp",
  "wm_top",
  "wm_orbp",
  "wm_drbp",
  "wm_bpm",
  "wm_gbpm",
  "wm_dgbpm",
  "usg_top1",
  "usg_top3_sum",
  "usg_std",
  "ts_std",
  "ast_std",
  "int_usg_x_ts",
  "int_ast_x_tp",
  "int_blk_x_drb",
  "int_orb_x_to",
  "int_offdef_gap",
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

function toNum(v: string | undefined): number {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function pctNum(v: string | undefined): number {
  const x = toNum(v);
  return x <= 1 ? x * 100 : x;
}

function normalizeTeamName(team: string, teams: string[]): string {
  if (teams.includes(team)) return team;
  const low = team.toLowerCase().trim();
  const exact = teams.find((t) => t.toLowerCase() === low);
  if (exact) return exact;
  return team;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function dot(a: number[], b: number[]): number {
  let out = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) out += a[i] * b[i];
  return out;
}

function trainRidgeGD(X: number[][], y: number[], lambda = 0.08, iters = 450, lr = 0.05): RidgeModel {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const meanX = new Array(d).fill(0);
  const stdX = new Array(d).fill(1);

  for (let j = 0; j < d; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += X[i][j];
    meanX[j] = s / Math.max(1, n);
  }
  for (let j = 0; j < d; j += 1) {
    let ss = 0;
    for (let i = 0; i < n; i += 1) {
      const v = X[i][j] - meanX[j];
      ss += v * v;
    }
    stdX[j] = Math.sqrt(ss / Math.max(1, n)) || 1;
  }

  const Xn = X.map((r) => r.map((v, j) => (v - meanX[j]) / stdX[j]));
  let bias = y.reduce((a, b) => a + b, 0) / Math.max(1, y.length);
  const w = new Array(d).fill(0);

  for (let it = 0; it < iters; it += 1) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const pred = bias + dot(w, Xn[i]);
      const err = pred - y[i];
      gradB += err;
      for (let j = 0; j < d; j += 1) gradW[j] += err * Xn[i][j];
    }
    const scale = 2 / Math.max(1, n);
    gradB *= scale;
    for (let j = 0; j < d; j += 1) {
      gradW[j] = gradW[j] * scale + 2 * lambda * w[j];
      w[j] -= lr * gradW[j];
    }
    bias -= lr * gradB;
  }

  return { meanX, stdX, weights: w, bias };
}

function predictRidge(model: RidgeModel, x: number[]): number {
  const xn = x.map((v, i) => (v - model.meanX[i]) / (model.stdX[i] || 1));
  return model.bias + dot(model.weights, xn);
}

async function loadPretrainedModelBundle(cfg: SourceCfg, gender: Gender): Promise<TeamModelBundle | null> {
  const cacheKey = `${gender}:${cfg.dataOwner}:${cfg.dataRepo}:${cfg.teamModelJsonPath}`;
  const cached = pretrainedModelCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) {
    return cached.bundle;
  }
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(cfg.dataOwner)}/${encodeURIComponent(
    cfg.dataRepo,
  )}/${encodeURIComponent(cfg.dataRef)}/${cfg.teamModelJsonPath}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    pretrainedModelCache.set(cacheKey, { loadedAt: Date.now(), bundle: null });
    return null;
  }
  const obj = (await res.json()) as TeamModelBundle;
  if (!obj || !obj.models || !obj.feature_order || !Array.isArray(obj.feature_order)) {
    pretrainedModelCache.set(cacheKey, { loadedAt: Date.now(), bundle: null });
    return null;
  }
  pretrainedModelCache.set(cacheKey, { loadedAt: Date.now(), bundle: obj });
  return obj;
}

async function loadSeasonData(season: number, cfg: SourceCfg, gender: Gender): Promise<SeasonCache> {
  const cacheKey = `${gender}:${season}`;
  const cached = seasonCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;

  async function fetchCsvText(): Promise<string> {
    let lastErr = "";
    for (const path of btCsvCandidates(cfg)) {
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(cfg.dataOwner)}/${encodeURIComponent(
        cfg.dataRepo,
      )}/${encodeURIComponent(cfg.dataRef)}/${path}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
      lastErr = `${path}: ${res.status}`;
    }
    const prefixes = Array.from(new Set([cfg.bartPrefix, cfg.bartPrefix ? "" : "ncaaw"]));
    for (const prefix of prefixes) {
      const pref = prefix ? `${prefix}/` : "";
      const url = `https://barttorvik.com/${pref}getadvstats.php?year=${season}&csv=1`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
      lastErr = `bart ${prefix || "men"}: ${res.status}`;
    }
    throw new Error(`Failed to fetch BT CSV (${lastErr || "no source"})`);
  }

  const text = await fetchCsvText();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("BT CSV has no rows");

  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const required = [
    "player_name",
    "team",
    "year",
    "mp",
    "ORtg",
    "drtg",
    "AST_per",
    "TO_per",
    "stl_per",
    "blk_per",
    "ORB_per",
    "DRB_per",
    "eFG",
    "TP_per",
    "TS_per",
    "FTM",
    "FTA",
    "twoPM",
    "twoPA",
    "TPM",
    "TPA",
    "ast",
    "stl",
    "blk",
    "oreb",
    "dreb",
    "pts",
  ];
  for (const c of required) {
    if (typeof idx[c] !== "number") throw new Error(`BT CSV missing column: ${c}`);
  }
  const has = (c: string) => typeof idx[c] === "number";
  const val = (cols: string[], c: string, pct = false) => {
    if (!has(c)) return 0;
    return pct ? pctNum(cols[idx[c]]) : toNum(cols[idx[c]]);
  };

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
      gp: Math.max(1, val(cols, "gp") || val(cols, "G") || val(cols, "games") || 1),
      mpg: toNum(cols[idx.mp]),
      ORtg: toNum(cols[idx.ORtg]),
      drtg: toNum(cols[idx.drtg]),
      usg: val(cols, "usg", true),
      bpm: val(cols, "bpm"),
      gbpm: val(cols, "gbpm"),
      dgbpm: val(cols, "dgbpm"),
      adjoe: val(cols, "adjoe"),
      adrtg: val(cols, "adrtg"),
      FTM: toNum(cols[idx.FTM]),
      FTA: toNum(cols[idx.FTA]),
      twoPM: toNum(cols[idx.twoPM]),
      twoPA: toNum(cols[idx.twoPA]),
      TPM: toNum(cols[idx.TPM]),
      TPA: toNum(cols[idx.TPA]),
      ast: toNum(cols[idx.ast]),
      stl: toNum(cols[idx.stl]),
      blk: toNum(cols[idx.blk]),
      oreb: toNum(cols[idx.oreb]),
      dreb: toNum(cols[idx.dreb]),
      pts: toNum(cols[idx.pts]),
      AST_per: toNum(cols[idx.AST_per]),
      TO_per: toNum(cols[idx.TO_per]),
      stl_per: toNum(cols[idx.stl_per]),
      blk_per: toNum(cols[idx.blk_per]),
      ORB_per: toNum(cols[idx.ORB_per]),
      DRB_per: toNum(cols[idx.DRB_per]),
      eFG: pctNum(cols[idx.eFG]),
      TP_per: pctNum(cols[idx.TP_per]),
      TS_per: pctNum(cols[idx.TS_per]),
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
  seasonCache.set(cacheKey, out);
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

function minuteScale(p: PlayerRow, minutes: Record<string, number>): number {
  const base = Number(p.mpg);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const next = Number(minutes[p.player] ?? base);
  if (!Number.isFinite(next) || next < 0) return 0;
  return next / base;
}

function teamFeatureMap(players: PlayerRow[], minutes: Record<string, number>): Record<string, number> {
  const rows = players.map((p) => ({ p, w: Math.max(0, Number(minutes[p.player] ?? p.mpg ?? 0)) })).filter((x) => x.w > 0);
  const ws = rows.reduce((a, b) => a + b.w, 0) || 1;
  const wm = (fn: (p: PlayerRow) => number) => rows.reduce((a, x) => a + fn(x.p) * x.w, 0) / ws;
  const std = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v);
  };

  const usgs = rows.map((x) => Number(x.p.usg || 0)).sort((a, b) => b - a);
  const tsVals = rows.map((x) => Number(x.p.TS_per || 0));
  const astVals = rows.map((x) => Number(x.p.AST_per || 0));

  const f: Record<string, number> = {};
  f.n_players = rows.length;
  f.minutes_sum = rows.reduce((a, b) => a + b.w, 0);
  f.wm_pts = wm((p) => p.pts);
  f.wm_reb = wm((p) => p.oreb + p.dreb);
  f.wm_ast = wm((p) => p.ast);
  f.wm_stl = wm((p) => p.stl);
  f.wm_blk = wm((p) => p.blk);
  f.wm_ortg = wm((p) => p.ORtg);
  f.wm_drtg = wm((p) => p.drtg);
  f.wm_usg = wm((p) => p.usg);
  f.wm_ts = wm((p) => p.TS_per);
  f.wm_efg = wm((p) => p.eFG);
  f.wm_tp = wm((p) => p.TP_per);
  f.wm_astp = wm((p) => p.AST_per);
  f.wm_top = wm((p) => p.TO_per);
  f.wm_orbp = wm((p) => p.ORB_per);
  f.wm_drbp = wm((p) => p.DRB_per);
  f.wm_bpm = wm((p) => p.bpm);
  f.wm_gbpm = wm((p) => p.gbpm);
  f.wm_dgbpm = wm((p) => p.dgbpm);
  f.usg_top1 = usgs[0] ?? 0;
  f.usg_top3_sum = (usgs[0] ?? 0) + (usgs[1] ?? 0) + (usgs[2] ?? 0);
  f.usg_std = std(usgs);
  f.ts_std = std(tsVals);
  f.ast_std = std(astVals);
  f.int_usg_x_ts = (f.wm_usg * f.wm_ts) / 100;
  f.int_ast_x_tp = (f.wm_astp * f.wm_tp) / 100;
  f.int_blk_x_drb = (f.wm_blk * f.wm_drbp) / 100;
  f.int_orb_x_to = (f.wm_orbp * f.wm_top) / 100;
  f.int_offdef_gap = f.wm_ortg - f.wm_drtg;
  return f;
}

function featureVector(fm: Record<string, number>): number[] {
  return FEATURE_ORDER.map((k) => Number(fm[k] ?? 0));
}

function featureVectorByOrder(fm: Record<string, number>, order: string[]): number[] {
  return order.map((k) => Number(fm[k] ?? 0));
}

function normalizePercentValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v <= 1 ? v * 100 : v;
}

function computeMetricMap(players: PlayerRow[], minutes: Record<string, number>): Record<string, number> {
  const off = weightedAvg(players, minutes, "ORtg");
  const def = weightedAvg(players, minutes, "drtg");
  const tov = weightedAvg(players, minutes, "TO_per");
  const selectedMinutes = players.reduce((acc, p) => acc + Math.max(0, Number(minutes[p.player] ?? p.mpg ?? 0)), 0);
  const gameScale = selectedMinutes > 0 ? 200 / selectedMinutes : 1;

  const pgScaled = (p: PlayerRow, total: number) => {
    const gp = Math.max(1, Number(p.gp || 1));
    return (total / gp) * minuteScale(p, minutes);
  };

  let twoPM = 0;
  let twoPA = 0;
  let tPM = 0;
  let tPA = 0;
  let fta = 0;
  let ftm = 0;
  let ast = 0;
  let stl = 0;
  let blk = 0;
  let oreb = 0;
  let dreb = 0;
  let ppg = 0;
  let tsWeight = 0;
  let tsWeightedSum = 0;
  for (const p of players) {
    const s = minuteScale(p, minutes);
    if (s <= 0 || !Number.isFinite(s)) continue;
    twoPM += pgScaled(p, p.twoPM);
    twoPA += pgScaled(p, p.twoPA);
    tPM += pgScaled(p, p.TPM);
    tPA += pgScaled(p, p.TPA);
    ftm += pgScaled(p, p.FTM);
    fta += pgScaled(p, p.FTA);
    ast += pgScaled(p, p.ast);
    stl += pgScaled(p, p.stl);
    blk += pgScaled(p, p.blk);
    oreb += pgScaled(p, p.oreb);
    dreb += pgScaled(p, p.dreb);
    ppg += pgScaled(p, p.pts);
    const shotDen = pgScaled(p, p.twoPA + p.TPA + 0.44 * p.FTA);
    if (shotDen > 0) {
      tsWeight += shotDen;
      tsWeightedSum += normalizePercentValue(p.TS_per) * shotDen;
    }
  }

  twoPM *= gameScale;
  twoPA *= gameScale;
  tPM *= gameScale;
  tPA *= gameScale;
  ftm *= gameScale;
  fta *= gameScale;
  ast *= gameScale;
  stl *= gameScale;
  blk *= gameScale;
  oreb *= gameScale;
  dreb *= gameScale;
  ppg *= gameScale;

  const pts = 2 * twoPM + 3 * tPM + ftm;
  const fgm = twoPM + tPM;
  const fga = twoPA + tPA;
  const fg = fga > 0 ? (fgm / fga) * 100 : 0;
  const tp = tPA > 0 ? (tPM / tPA) * 100 : 0;
  const tsFromTotals = (fga + 0.44 * fta) > 0 ? (pts / (2 * (fga + 0.44 * fta))) * 100 : 0;
  const tsFromPlayerWeighted = tsWeight > 0 ? tsWeightedSum / tsWeight : 0;
  const ts = tsFromTotals >= 20 && tsFromTotals <= 90 ? tsFromTotals : tsFromPlayerWeighted;

  const poss = off > 0 ? ppg / (off / 100) : 0;
  const ast100 = poss > 0 ? (ast / poss) * 100 : 0;
  const stl100 = poss > 0 ? (stl / poss) * 100 : 0;
  const blk100 = poss > 0 ? (blk / poss) * 100 : 0;
  const reb100 = poss > 0 ? ((oreb + dreb) / poss) * 100 : 0;
  const oreb100 = poss > 0 ? (oreb / poss) * 100 : 0;

  return {
    net: off - def,
    off,
    def,
    ast100,
    tov100: tov,
    stl100,
    blk100,
    reb100,
    oreb100,
    fg,
    tp,
    ts,
  };
}

function buildSeasonModels(
  gender: Gender,
  season: number,
  allTeams: string[],
  data: SeasonCache,
  currentMapByTeam: Record<string, Record<string, number>>,
): Record<string, RidgeModel> {
  const cacheKey = `${gender}:${season}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.modelByMetric;

  const X: number[][] = [];
  const yByMetric: Record<string, number[]> = {};
  for (const m of METRICS) yByMetric[m.key] = [];

  for (const t of allTeams) {
    const roster = data.rosterByTeam[t] ?? [];
    if (!roster.length) continue;
    const mins: Record<string, number> = {};
    for (const p of roster) mins[p.player] = p.mpg;
    X.push(featureVector(teamFeatureMap(roster, mins)));

    const adjOffVals = roster.map((r) => r.adjoe).filter((v) => Number.isFinite(v) && v > 70 && v < 140);
    const adjDefVals = roster.map((r) => r.adrtg).filter((v) => Number.isFinite(v) && v > 70 && v < 140);
    const offAdj = adjOffVals.length ? median(adjOffVals) : (currentMapByTeam[t]?.off ?? 0);
    const defAdj = adjDefVals.length ? median(adjDefVals) : (currentMapByTeam[t]?.def ?? 0);

    for (const m of METRICS) {
      if (m.key === "off") yByMetric[m.key].push(offAdj);
      else if (m.key === "def") yByMetric[m.key].push(defAdj);
      else if (m.key === "net") yByMetric[m.key].push(offAdj - defAdj);
      else yByMetric[m.key].push(currentMapByTeam[t]?.[m.key] ?? 0);
    }
  }

  const modelByMetric: Record<string, RidgeModel> = {};
  if (X.length >= 20) {
    for (const m of METRICS) {
      modelByMetric[m.key] = trainRidgeGD(X, yByMetric[m.key], 0.08, 450, 0.05);
    }
  }
  modelCache.set(cacheKey, { loadedAt: Date.now(), modelByMetric });
  return modelByMetric;
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
    const gender = parseGender(req.nextUrl.searchParams.get("gender") ?? "men");
    const cfg = getSourceCfg(gender);
    const season = Number(req.nextUrl.searchParams.get("season") ?? "2026");
    const teamRaw = (req.nextUrl.searchParams.get("team") ?? "").trim();
    if (!Number.isFinite(season)) {
      return NextResponse.json({ ok: false, error: "Invalid season" }, { status: 400 });
    }

    const data = await loadSeasonData(season, cfg, gender);
    const teams = Object.keys(data.rosterByTeam).sort((a, b) => a.localeCompare(b));
    const team = teamRaw ? normalizeTeamName(teamRaw, teams) : teams[0] ?? "";
    const roster = (data.rosterByTeam[team] ?? []).map((p) => ({ player: p.player, mpg: Number(p.mpg.toFixed(1)) }));

    return NextResponse.json({
      ok: true,
      source: "live_bt",
      gender,
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
      gender?: string;
      season: number;
      team: string;
      addPlayers?: string[];
      removePlayers?: string[];
      rosterMinutes?: Record<string, number>;
    };

    const gender = parseGender(body.gender ?? "men");
    const cfg = getSourceCfg(gender);
    const season = Number(body.season ?? 2026);
    const addPlayers = Array.isArray(body.addPlayers) ? body.addPlayers.map(String) : [];
    const removePlayers = new Set(Array.isArray(body.removePlayers) ? body.removePlayers.map(String) : []);
    const rosterMinutesIn = body.rosterMinutes && typeof body.rosterMinutes === "object" ? body.rosterMinutes : {};

    const data = await loadSeasonData(season, cfg, gender);
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
      newMinutes[p.player] = Number.isFinite(n) && n >= 0 ? n : p.mpg;
    }

    const currentMapByTeam: Record<string, Record<string, number>> = {};
    const teamFeatureMapByTeam: Record<string, Record<string, number>> = {};
    const teamMinutesByTeam: Record<string, Record<string, number>> = {};
    for (const t of allTeams) {
      const roster = data.rosterByTeam[t] ?? [];
      const mins: Record<string, number> = {};
      for (const p of roster) mins[p.player] = p.mpg;
      currentMapByTeam[t] = computeMetricMap(roster, mins);
      teamFeatureMapByTeam[t] = teamFeatureMap(roster, mins);
      teamMinutesByTeam[t] = mins;
    }
    const editedFeatureMap = teamFeatureMap(newPlayers, newMinutes);
    const fallbackEditedMap = computeMetricMap(newPlayers, newMinutes);

    let modelByMetric: Record<string, RidgeModel> = {};
    let modelSource = "live_bt";
    let featureOrder = FEATURE_ORDER;

    const pretrained = await loadPretrainedModelBundle(cfg, gender);
    if (pretrained && pretrained.models && Object.keys(pretrained.models).length > 0) {
      modelByMetric = pretrained.models;
      modelSource = "pretrained_model";
      if (Array.isArray(pretrained.feature_order) && pretrained.feature_order.length > 0) {
        featureOrder = pretrained.feature_order;
      }
    } else {
      modelByMetric = buildSeasonModels(gender, season, allTeams, data, currentMapByTeam);
      if (Object.keys(modelByMetric).length > 0) modelSource = "learned_regression";
    }

    const useLearned = Object.keys(modelByMetric).length > 0;

    const metrics = METRICS.map((m) => {
      const currentValues: Record<string, number> = {};
      const editedValues: Record<string, number> = {};
      const mdl = modelByMetric[m.key];
      const forceDirect = DIRECT_ONLY_METRICS.has(m.key);
      for (const t of allTeams) {
        if (useLearned && mdl && !forceDirect) {
          const teamFeat = teamFeatureMapByTeam[t] ?? teamFeatureMap(data.rosterByTeam[t] ?? [], teamMinutesByTeam[t] ?? {});
          const pred = predictRidge(mdl, featureVectorByOrder(teamFeat, featureOrder));
          currentValues[t] = pred;
          editedValues[t] = pred;
        } else {
          currentValues[t] = currentMapByTeam[t]?.[m.key] ?? 0;
          editedValues[t] = currentMapByTeam[t]?.[m.key] ?? 0;
        }
      }
      if (useLearned && mdl && !forceDirect) editedValues[team] = predictRidge(mdl, featureVectorByOrder(editedFeatureMap, featureOrder));
      else editedValues[team] = fallbackEditedMap[m.key] ?? 0;

      const cur = currentValues[team] ?? 0;
      const neu = editedValues[team] ?? 0;
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
      source: useLearned ? modelSource : "live_bt",
      cache: "live",
      gender,
      season,
      team,
      metrics,
      activeRoster,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
