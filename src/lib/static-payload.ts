import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type CardSections = Record<string, unknown>;

export type CardPayload = {
  schema_version?: string;
  player: string;
  team: string;
  season: string;
  destinationConference?: string;
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

type IndexRow = {
  player: string;
  team: string;
  season: string;
  path: string;
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

type EnrichedManifestEntry = {
  script_season?: number;
  output_script_season?: string;
  source_files?: string[];
};

type EnrichedPlayerRow = Record<string, unknown> & {
  key?: string;
  team?: string;
  year?: string;
  shotInfo?: {
    total_freq?: number;
    info?: Array<[number, number, number, number]>;
    data?: {
      doc_count?: number;
      info?: Array<[number, number, number, number]>;
    };
  };
};

const bundledBioLookupMemo = new Map<string, Promise<Record<string, BundledBioLookupRow>>>();
const btRowsMemo = new Map<string, Promise<Record<string, string>[]>>();
const enrichedLookupMemo = new Map<string, Promise<Record<string, EnrichedPlayerRow>>>();
const sectionHtmlMemo = new Map<string, Promise<Record<string, string>>>();
const transferProjectionMemo = new Map<string, Promise<string>>();
const workflowSectionNames = [
  "grade_boxes_html",
  "bt_percentiles_html",
  "self_creation_html",
  "playstyles_html",
  "shot_diet_html",
  "team_impact_html",
  "player_comparisons_html",
  "draft_projection_html",
  "transfer_projection_html",
] as const;

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

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
        "player_cards_pipeline/public/cards",
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
    staticRoot: process.env.GITHUB_STATIC_PAYLOAD_ROOT || "player_cards_pipeline/public/cards",
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

async function fetchAbsoluteJson<T>(url: string, cfg: SourceCfg): Promise<T> {
  const headers: Record<string, string> = {};
  if (cfg.dataToken && url.includes("github")) {
    headers.Authorization = `Bearer ${cfg.dataToken}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
  return (await res.json()) as T;
}

async function fetchAbsoluteText(url: string, cfg: SourceCfg): Promise<string> {
  const headers: Record<string, string> = {};
  if (cfg.dataToken && url.includes("github")) {
    headers.Authorization = `Bearer ${cfg.dataToken}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
  return await res.text();
}

async function fetchRepoJson<T>(path: string, cfg: SourceCfg): Promise<T> {
  // Large section payload files (>1MB) are more reliable via raw URLs than the Contents API.
  if (path.includes("player_cards_pipeline/data/cache/section_payloads/")) {
    const rawUrl = `https://raw.githubusercontent.com/${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}/${path}`;
    return await fetchAbsoluteJson<T>(rawUrl, cfg);
  }

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
      return await fetchAbsoluteJson<T>(payload.download_url, cfg);
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}/${path}`;
  return await fetchAbsoluteJson<T>(rawUrl, cfg);
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
      return await fetchAbsoluteText(payload.download_url, cfg);
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}/${path}`;
  return await fetchAbsoluteText(rawUrl, cfg);
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

function normalizeColName(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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

async function loadBtBioFallback(
  season: number,
  team: string,
  player: string,
  cfg: SourceCfg,
): Promise<Record<string, string>> {
  try {
    const text = await fetchRepoText(cfg.btCsvPath, cfg);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return {};
    const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
    const pIdx = findCol(header, ["player_name", "player", "name", "plyr"]);
    const tIdx = findCol(header, ["team", "school", "tm", "team_name"]);
    const yIdx = findCol(header, ["year", "season", "yr"]);
    const posIdx = findCol(header, ["pos", "position"]);
    const htIdx = findCol(header, ["ht", "height"]);
    if (pIdx < 0 || tIdx < 0 || yIdx < 0) return {};

    const np = normPlayer(player);
    const nt = normTeam(team);
    const ys = String(season);
    for (let i = 1; i < lines.length; i += 1) {
      const cols = parseCsvLine(lines[i]);
      const p = String(cols[pIdx] ?? "").trim();
      const t = String(cols[tIdx] ?? "").trim();
      const y = String(cols[yIdx] ?? "").trim();
      if (!p || !t || y !== ys) continue;
      if (normPlayer(p) !== np || normTeam(t) !== nt) continue;
      return {
        position: posIdx >= 0 ? String(cols[posIdx] ?? "").trim() : "",
        height: htIdx >= 0 ? String(cols[htIdx] ?? "").trim() : "",
      };
    }
    return {};
  } catch {
    return {};
  }
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

function btGet(row: Record<string, string>, names: string[]): string {
  const keys = Object.keys(row);
  for (const name of names) {
    const hit = keys.find((key) => normalizeColName(key) === normalizeColName(name));
    if (hit) return String(row[hit] ?? "");
  }
  return "";
}

function btNum(row: Record<string, string>, names: string[]): number | null {
  for (const name of names) {
    const raw = btGet(row, [name]).trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function percentile(value: number | null, cohort: number[]): number | null {
  if (value === null || !Number.isFinite(value) || !cohort.length) return null;
  const sorted = [...cohort].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count += 1;
  }
  return (100 * count) / sorted.length;
}

function seasonNorm(raw: string | number): string {
  return String(raw ?? "").trim();
}

function cardCacheKey(player: string, team: string, season: string | number): string {
  return `${normPlayer(player)}|${normTeam(team)}|${seasonNorm(season)}`;
}

function repoRelativePathFromRunnerPath(raw: string): string {
  const normalized = String(raw || "").replace(/\\/g, "/").trim();
  const marker = "/player_cards_pipeline/";
  const idx = normalized.indexOf(marker);
  if (idx >= 0) return normalized.slice(idx + 1);
  return normalized
    .split("/")
    .filter((part) => part.length > 0)
    .slice(-6)
    .join("/");
}

async function loadBtRowsForSeason(season: number, cfg: SourceCfg): Promise<Record<string, string>[]> {
  const key = `${cfg.dataOwner}:${cfg.dataRepo}:${cfg.dataRef}:${season}`;
  if (!btRowsMemo.has(key)) {
    btRowsMemo.set(
      key,
      (async () => {
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
            const rows: Record<string, string>[] = [];
            for (let i = 1; i < lines.length; i += 1) {
              const cols = parseCsvLine(lines[i]);
              const year = String(cols[yIdx] ?? "").trim();
              if (year !== String(season)) continue;
              const row: Record<string, string> = {};
              header.forEach((h, idx) => {
                row[h] = String(cols[idx] ?? "");
              });
              rows.push(row);
            }
            if (rows.length) return rows;
          } catch {
            // try the next candidate path
          }
        }
        return [];
      })(),
    );
  }
  return btRowsMemo.get(key)!;
}

function findBtTargetRow(
  rows: Record<string, string>[],
  season: number,
  team: string,
  player: string,
): Record<string, string> | null {
  const desiredKey = cardCacheKey(player, team, season);
  const exact = rows.find((row) => cardCacheKey(btGet(row, ["player_name", "player", "name", "plyr"]), btGet(row, ["team", "school", "tm", "team_name", "school_name"]), btGet(row, ["year", "season", "yr"])) === desiredKey);
  if (exact) return exact;
  return (
    rows.find((row) => {
      const rowPlayer = normPlayer(btGet(row, ["player_name", "player", "name", "plyr"]));
      const rowTeam = normTeam(btGet(row, ["team", "school", "tm", "team_name", "school_name"]));
      const rowSeason = String(btGet(row, ["year", "season", "yr"]) ?? "").trim();
      return rowPlayer === normPlayer(player) && rowTeam === normTeam(team) && rowSeason === String(season);
    }) ?? null
  );
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

async function loadEnrichedLookupForSeason(
  season: number,
  gender: Gender,
  cfg: SourceCfg,
): Promise<Record<string, EnrichedPlayerRow>> {
  const key = `${cfg.dataOwner}:${cfg.dataRepo}:${cfg.dataRef}:${gender}:${season}`;
  if (!enrichedLookupMemo.has(key)) {
    enrichedLookupMemo.set(
      key,
      (async () => {
        try {
          const manifest = await fetchRepoJson<EnrichedManifestEntry[]>(
            "player_cards_pipeline/data/manual/enriched_players/manifest.json",
            cfg,
          );
          const entry = (Array.isArray(manifest) ? manifest : []).find(
            (item) => Number(item.script_season ?? 0) === season,
          );
          const filePath = repoRelativePathFromRunnerPath(String(entry?.output_script_season ?? "").trim());
          if (!filePath) return {};
          const payload = await fetchRepoJson<{ players?: EnrichedPlayerRow[] }>(filePath, cfg);
          const rows = Array.isArray(payload.players) ? payload.players : [];
          const lookup: Record<string, EnrichedPlayerRow> = {};
          for (const row of rows) {
            const team = String(row?.team ?? "").trim();
            const player = String(row?.key ?? "").trim();
            const year = String(row?.year ?? "").trim();
            if (!team || !player || !year) continue;
            lookup[cardCacheKey(player, team, season)] = row;
          }
          return lookup;
        } catch {
          return {};
        }
      })(),
    );
  }
  return enrichedLookupMemo.get(key)!;
}

async function loadEnrichedRow(
  season: number,
  team: string,
  player: string,
  gender: Gender,
  cfg: SourceCfg,
): Promise<EnrichedPlayerRow | null> {
  const lookup = await loadEnrichedLookupForSeason(season, gender, cfg);
  return lookup[cardCacheKey(player, team, season)] ?? null;
}

function expandEnrichedShots(row: EnrichedPlayerRow | null): Array<{ x: number; y: number; made: boolean }> {
  const shotInfo = row?.shotInfo;
  const rawRows =
    (Array.isArray(shotInfo?.data?.info) && shotInfo?.data?.info) ||
    (Array.isArray(shotInfo?.info) && shotInfo?.info) ||
    [];
  const shots: Array<{ x: number; y: number; made: boolean }> = [];
  for (const entry of rawRows) {
    const [x, y, madeCount, missCount] = entry;
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const made = Number(madeCount) >= Number(missCount);
    // Spread points out a little so the chart keeps the same visual character.
    const repeat = Math.max(1, Math.min(4, Math.round((Number(madeCount) + Number(missCount)) / 12)));
    for (let i = 0; i < repeat; i += 1) {
      shots.push({
        x: 470 + px * 12 + (i % 2 === 0 ? -2.5 : 2.5),
        y: 250 + py * 8 + (i % 3) - 1,
        made,
      });
    }
  }
  return shots;
}

function buildPerGameStats(row: Record<string, string>): {
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  fg_pct: number | null;
  tp_pct: number | null;
  ft_pct: number | null;
} {
  const rebounds =
    btNum(row, ["treb", "reb", "rpg"]) ??
    ((btNum(row, ["oreb"]) ?? 0) + (btNum(row, ["dreb"]) ?? 0) || null);
  const fgm = btNum(row, ["fgm"]);
  const fga = btNum(row, ["fga"]);
  const tpm = btNum(row, ["tpm"]);
  const tpa = btNum(row, ["tpa"]);
  const ftm = btNum(row, ["ftm"]);
  const fta = btNum(row, ["fta"]);
  return {
    ppg: btNum(row, ["pts", "ppg", "points"]),
    rpg: rebounds,
    apg: btNum(row, ["ast", "apg"]),
    spg: btNum(row, ["stl", "spg"]),
    bpg: btNum(row, ["blk", "bpg"]),
    fg_pct:
      btNum(row, ["fg%", "fg_pct"]) ??
      (fgm !== null && fga !== null && fga > 0 ? (100 * fgm) / fga : null),
    tp_pct:
      btNum(row, ["3p%", "tp_pct", "3pt%"]) ??
      (tpm !== null && tpa !== null && tpa > 0 ? (100 * tpm) / tpa : null),
    ft_pct:
      btNum(row, ["ft%", "ft_pct"]) ??
      (ftm !== null && fta !== null && fta > 0 ? (100 * ftm) / fta : null),
  };
}

function buildPerGamePercentiles(target: Record<string, string>, cohort: Record<string, string>[]) {
  const metrics = ["pts", "reb", "ast", "stl", "blk", "fg_pct", "tp_pct", "ft_pct"];
  const valuesByMetric: Record<string, number[]> = {};
  for (const metric of metrics) valuesByMetric[metric] = [];
  for (const row of cohort) {
    const pg = buildPerGameStats(row);
    if (pg.ppg !== null) valuesByMetric.pts.push(pg.ppg);
    if (pg.rpg !== null) valuesByMetric.reb.push(pg.rpg);
    if (pg.apg !== null) valuesByMetric.ast.push(pg.apg);
    if (pg.spg !== null) valuesByMetric.stl.push(pg.spg);
    if (pg.bpg !== null) valuesByMetric.blk.push(pg.bpg);
    if (pg.fg_pct !== null) valuesByMetric.fg_pct.push(pg.fg_pct);
    if (pg.tp_pct !== null) valuesByMetric.tp_pct.push(pg.tp_pct);
    if (pg.ft_pct !== null) valuesByMetric.ft_pct.push(pg.ft_pct);
  }
  const targetPg = buildPerGameStats(target);
  return {
    ppg: percentile(targetPg.ppg, valuesByMetric.pts),
    rpg: percentile(targetPg.rpg, valuesByMetric.reb),
    apg: percentile(targetPg.apg, valuesByMetric.ast),
    spg: percentile(targetPg.spg, valuesByMetric.stl),
    bpg: percentile(targetPg.bpg, valuesByMetric.blk),
    fg_pct: percentile(targetPg.fg_pct, valuesByMetric.fg_pct),
    tp_pct: percentile(targetPg.tp_pct, valuesByMetric.tp_pct),
    ft_pct: percentile(targetPg.ft_pct, valuesByMetric.ft_pct),
  };
}

function buildShotChartFromEnriched(
  row: EnrichedPlayerRow | null,
  targetBtRow: Record<string, string> | null,
) {
  const fgm = targetBtRow ? btNum(targetBtRow, ["fgm", "FGM"]) : null;
  const fga = targetBtRow ? btNum(targetBtRow, ["fga", "FGA"]) : null;
  const tpm = targetBtRow ? btNum(targetBtRow, ["tpm", "TPM"]) : null;
  const tpa = targetBtRow ? btNum(targetBtRow, ["tpa", "TPA"]) : null;
  const ftm = targetBtRow ? btNum(targetBtRow, ["ftm", "FTM"]) : null;
  const fta = targetBtRow ? btNum(targetBtRow, ["fta", "FTA"]) : null;
  const attempts = fga ?? (targetBtRow ? (btNum(targetBtRow, ["pts"]) ?? 0) : 0);
  const makes =
    fgm ??
    (tpm !== null && ftm !== null ? tpm + ftm : null) ??
    (attempts > 0 ? Math.round(attempts * 0.4) : 0);
  const fgPct = attempts > 0 && makes !== null ? (100 * makes) / attempts : null;
  const pointsPerShotLine = "Points per Shot Over Expectation: N/A";
  return {
    attempts: attempts ?? 0,
    makes: makes ?? 0,
    fg_pct: fgPct ?? 0,
    pps_over_expectation_line: pointsPerShotLine,
    shots: expandEnrichedShots(row),
  };
}

async function loadWorkflowSectionHtml(
  section: string,
  season: number,
  team: string,
  player: string,
  cfg: SourceCfg,
): Promise<string> {
  const key = `${cfg.dataOwner}:${cfg.dataRepo}:${cfg.dataRef}:${section}:${season}:${cardCacheKey(player, team, season)}`;
  if (!sectionHtmlMemo.has(key)) {
    sectionHtmlMemo.set(
      key,
      (async () => {
        try {
          const payload = await fetchRepoJson<WorkflowSectionPayload>(
            `player_cards_pipeline/data/cache/section_payloads/${section}/${season}.json`,
            cfg,
          );
          const rows = payload.rows ?? {};
          const exactKey = cardCacheKey(player, team, season);
          const direct = rows[exactKey];
          const directHtml =
            typeof direct === "string"
              ? direct
              : direct && typeof direct === "object"
                ? workflowHtmlFromValue(direct)
                : "";
          if (directHtml) return directHtml;
          const fallback = Object.entries(rows).find(([k]) => workflowRowMatches(k, player, team, season));
          return fallback ? workflowHtmlFromValue(fallback[1]) : "";
        } catch {
          return "";
        }
      })(),
    );
  }
  return sectionHtmlMemo.get(key)!;
}

function normalizeConference(raw: string): string {
  return String(raw || "").trim().toUpperCase();
}

function extractTransferProjectionCandidate(
  payload: unknown,
  player: string,
  team: string,
  season: number,
) {
  const desiredKey = cardCacheKey(player, team, season);
  const stack: unknown[] = [payload];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    const obj = cur as Record<string, unknown>;
    const p = String(obj.player ?? obj.name ?? "").trim();
    const t = String(obj.team ?? obj.school ?? "").trim();
    const s = String(obj.season ?? obj.year ?? "").trim();
    const key = String(obj.key ?? obj.cache_key ?? "").trim();
    if (
      (p && t && s && cardCacheKey(p, t, s) === desiredKey) ||
      (key && key === desiredKey)
    ) {
      return obj;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

async function loadTransferProjectionHtml(
  season: number,
  team: string,
  player: string,
  destinationConference: string,
  cfg: SourceCfg,
): Promise<string> {
  const key = `${cfg.dataOwner}:${cfg.dataRepo}:${cfg.dataRef}:transfer:${season}:${cardCacheKey(player, team, season)}:${normalizeConference(destinationConference)}`;
  if (!transferProjectionMemo.has(key)) {
    transferProjectionMemo.set(
      key,
      (async () => {
        try {
          const paths = [
            `player_cards_pipeline/data/cache/transfer_projection/${season}_part1.json`,
            `player_cards_pipeline/data/cache/transfer_projection/${season}_part2.json`,
          ];
          let candidate: Record<string, unknown> | null = null;
          for (const path of paths) {
            try {
              const payload = await fetchRepoJson<unknown>(path, cfg);
              const found = extractTransferProjectionCandidate(payload, player, team, season);
              if (found) {
                candidate = found;
                break;
              }
            } catch {
              // try the next part
            }
          }
          if (!candidate) return "";
          const projections = candidate.projections as Record<string, unknown> | undefined;
          const destKey = normalizeConference(destinationConference).toLowerCase().replace(/[^a-z0-9]/g, "");
          const projection =
            (projections &&
              (projections[destKey] ||
                projections[normalizeConference(destinationConference)] ||
                projections[Object.keys(projections)[0] || ""])) ||
            candidate.projection ||
            candidate.transfer_projection;
          const proj = (projection && typeof projection === "object" ? projection : {}) as Record<string, unknown>;
          const projectedStats = (proj.projected_stats ||
            proj.projectedRates ||
            proj.projected_rates ||
            proj.stats ||
            {}) as Record<string, unknown>;
          const grade = String(proj.transfer_grade ?? proj.grade ?? candidate.transfer_grade ?? "N/A").trim() || "N/A";
          const weightedCount = Number(
            proj.weighted_comp_count ??
              proj.weighted_comps ??
              proj.weighted_count ??
              proj.comp_count ??
              candidate.weighted_comp_count ??
              candidate.weighted_comps ??
              candidate.comp_count ??
              0,
          );
          const rateValue = (keys: string[]) => {
            for (const k of keys) {
              const hit = Object.keys(projectedStats).find(
                (cur) => normalizeColName(cur) === normalizeColName(k),
              );
              if (!hit) continue;
              const n = Number(projectedStats[hit]);
              if (Number.isFinite(n)) return n;
            }
            return null;
          };
          const metricHtml = [
            ["AST%", ["ast%", "ast_per"]],
            ["OREB%", ["oreb%", "orb_per"]],
            ["DREB%", ["dreb%", "drb_per"]],
            ["STL%", ["stl%", "stl_per"]],
            ["BLK%", ["blk%", "blk_per"]],
            ["FG%", ["fg%", "fg_pct"]],
            ["3P%", ["3p%", "tp_pct"]],
            ["FT%", ["ft%", "ft_pct"]],
          ]
            .map(([label, keys]) => {
              const val = rateValue(keys as string[]);
              return `<div class="draft-odd-row"><div class="draft-odd-k">${label}</div><div class="draft-odd-v">${val === null ? "-" : val.toFixed(1)}</div></div>`;
            })
            .join("");
          return `
      <div class="panel draft-proj-panel">
        <h3>Transfer Projection</h3>
        <div class="draft-proj-main">${normalizeConference(destinationConference)} Transfer Grade: ${grade}</div>
        <div class="draft-proj-sub">Projected next-season statline vs historical transfer comps (${Number.isFinite(weightedCount) ? Math.round(weightedCount) : 0} comps weighted)</div>
        <div class="draft-proj-sub" style="font-weight:700;margin-top:6px;">Projected Rates</div>
        <div class="draft-odds-grid transfer-two-col">
          ${metricHtml}
        </div>
        <div class="draft-proj-sub" style="margin-top:8px;">The model examines historical cross-conference transfers, weighting similar pre-transfer profiles more heavily. Using those weighted historical stat translations, it projects statistical outcomes for the new player in the selected conference.</div>
        <div class="draft-proj-sub">Transfer Grade compares the player’s projected impact to historical transfer-up outcomes into the selected conference.</div>
      </div>
`;
        } catch {
          return "";
        }
      })(),
    );
  }
  return transferProjectionMemo.get(key)!;
}

async function enrichPayloadCaches(
  payload: CardPayload,
  cfg: SourceCfg,
  gender: Gender,
): Promise<CardPayload> {
  const season = Number(payload.season || 0);
  const [btRows, enrichedRow] = await Promise.all([
    loadBtRowsForSeason(season, cfg),
    loadEnrichedRow(season, payload.team, payload.player, gender, cfg),
  ]);
  const targetBtRow = findBtTargetRow(btRows, season, payload.team, payload.player);
  const nextPerGame = targetBtRow
    ? {
        ...(payload.per_game ?? {}),
        ...buildPerGameStats(targetBtRow),
        percentiles: buildPerGamePercentiles(targetBtRow, btRows),
      }
    : payload.per_game ?? {};
  const nextShotChart = targetBtRow
    ? {
        ...(payload.shot_chart ?? {}),
        ...buildShotChartFromEnriched(enrichedRow, targetBtRow),
      }
    : payload.shot_chart ?? {};

  const sections = { ...(payload.sections_html ?? {}) };
  for (const section of workflowSectionNames) {
    const html =
      section === "transfer_projection_html"
        ? await loadTransferProjectionHtml(
            season,
            payload.team,
            payload.player,
            String((payload as { destinationConference?: string }).destinationConference ?? "SEC"),
            cfg,
          )
        : await loadWorkflowSectionHtml(section, season, payload.team, payload.player, cfg);
    if (html) sections[section] = html;
  }

  return {
    ...payload,
    per_game: nextPerGame,
    shot_chart: nextShotChart,
    sections_html: Object.keys(sections).length ? sections : payload.sections_html,
  };
}

async function buildCacheFallbackPayload(
  season: number,
  team: string,
  player: string,
  destinationConference: string | undefined,
  gender: Gender,
  cfg: SourceCfg,
): Promise<CardPayload> {
  const btRows = await loadBtRowsForSeason(season, cfg);
  const targetBtRow = findBtTargetRow(btRows, season, team, player);

  const perGame =
    targetBtRow
      ? {
          ...buildPerGameStats(targetBtRow),
          percentiles: buildPerGamePercentiles(targetBtRow, btRows),
        }
      : {};

  const enrichedRow = await loadEnrichedRow(season, team, player, gender, cfg);
  const shotChart =
    targetBtRow
      ? buildShotChartFromEnriched(enrichedRow, targetBtRow)
      : { attempts: 0, makes: 0, fg_pct: 0, pps_over_expectation_line: "Points per Shot Over Expectation: N/A", shots: [] };

  const sections: Record<string, string> = {};
  for (const section of workflowSectionNames) {
    const html =
      section === "transfer_projection_html"
        ? await loadTransferProjectionHtml(
            season,
            team,
            player,
            String(destinationConference ?? "SEC"),
            cfg,
          )
        : await loadWorkflowSectionHtml(section, season, team, player, cfg);
    if (html) sections[section] = html;
  }

  return {
    schema_version: "workflow-cache-v1",
    player,
    team,
    season: String(season),
    destinationConference,
    bio: {},
    per_game: perGame,
    shot_chart: shotChart,
    sections_html: sections,
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

async function loadFromStaticIndex(
  season: number,
  team: string,
  player: string,
  cfg: SourceCfg,
): Promise<CardPayload> {
  const idxPath = `${cfg.staticRoot}/${season}/index.json`;
  const rows = await fetchRepoJson<IndexRow[]>(idxPath, cfg);
  const nt = normTeam(team);
  const np = normPlayer(player);
  const row =
    rows.find((candidate) => normTeam(candidate.team) === nt && normPlayer(candidate.player) === np) ||
    rows.find((candidate) => normPlayer(candidate.player) === np);
  if (!row) {
    throw new Error(`Static payload not found for ${player} (${season})`);
  }
  const payloadPath = `${cfg.staticRoot}/${season}/${row.path}`;
  return await fetchRepoJson<CardPayload>(payloadPath, cfg);
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

export async function loadStaticPayload(
  season: number,
  team: string,
  player: string,
  genderRaw?: string,
  destinationConference?: string,
): Promise<CardPayload> {
  const gender = parseGender(genderRaw);
  const cfg = getSourceCfg(gender);
  let basePayload: CardPayload;
  try {
    basePayload = await loadFromStaticIndex(season, team, player, cfg);
  } catch {
    basePayload = await buildCacheFallbackPayload(
      season,
      team,
      player,
      destinationConference,
      gender,
      cfg,
    );
  }
  const hasBaseSections = isNonEmptyObject(basePayload.sections_html) || isNonEmptyObject(basePayload.section_bundles?.core) || isNonEmptyObject(basePayload.section_bundles?.heavy);
  const needsFallback =
    !hasBaseSections ||
    !isNonEmptyObject(basePayload.per_game) ||
    !isNonEmptyObject(basePayload.shot_chart);
  if (needsFallback) {
    const fallback = await buildCacheFallbackPayload(
      season,
      team,
      player,
      destinationConference,
      gender,
      cfg,
    );
    basePayload = {
      ...fallback,
      ...basePayload,
      bio: {
        ...(fallback.bio ?? {}),
        ...(basePayload.bio ?? {}),
      },
      per_game: {
        ...(fallback.per_game ?? {}),
        ...(basePayload.per_game ?? {}),
      },
      shot_chart: {
        ...(fallback.shot_chart ?? {}),
        ...(basePayload.shot_chart ?? {}),
      },
      sections_html: {
        ...(fallback.sections_html ?? {}),
        ...(basePayload.sections_html ?? {}),
      },
      section_bundles: basePayload.section_bundles ?? fallback.section_bundles,
    };
  }
  const payload: CardPayload = {
    ...basePayload,
    destinationConference,
  };
  return await enrichPayloadBio(await enrichPayloadCaches(payload, cfg, gender), cfg, gender);
}
