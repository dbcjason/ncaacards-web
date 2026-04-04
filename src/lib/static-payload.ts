import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dbQuery } from "@/lib/db";
import { loadJsonPayloadFromObjectKey } from "@/lib/object-store";

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

const SECTION_KEYS = [
  "grade_boxes_html",
  "bt_percentiles_html",
  "self_creation_html",
  "playstyles_html",
  "team_impact_html",
  "shot_diet_html",
  "player_comparisons_html",
  "draft_projection_html",
] as const;

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

type PayloadIndexRow = {
  storage_provider: "github" | "r2" | "supabase";
  storage_key: string;
  public_url: string | null;
  payload_json: CardPayload | null;
};

type PhaseSummaryRow = {
  phase: string;
  chunk_rows: number;
  min_chunk_count: number;
  max_chunk_count: number;
  chunk_indexes: number[];
};

type BackupChunkRow = {
  chunk_index: number;
  chunk_count: number;
  row_count: number;
  payload_gzip_base64: string;
};

type BackedUpPayloadRow = {
  player: string;
  team: string;
  season: string | number;
  payload_json: CardPayload;
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

const PHASE_ORDER = [
  "base_metadata",
  "per_game_percentiles",
  "grade_boxes_html",
  "bt_percentiles_html",
  "self_creation_html",
  "playstyles_html",
  "team_impact_html",
  "shot_diet_html",
  "player_comparisons_html",
  "draft_projection_html",
  "finalize",
] as const;

const WOMEN_AGE_GATED_COMPS_MESSAGE = "Missing target age for strict +/-1 year age comps.";
const bundledBioLookupMemo = new Map<string, Promise<Record<string, BundledBioLookupRow>>>();

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

function phaseRank(phase: string): number {
  const index = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
  return index === -1 ? -1 : index;
}

function isContiguousChunkSet(indexes: number[], expectedCount: number): boolean {
  if (indexes.length !== expectedCount) return false;
  const sorted = [...indexes].sort((a, b) => a - b);
  for (let i = 0; i < expectedCount; i += 1) {
    if (sorted[i] !== i) return false;
  }
  return true;
}

function decodeChunkPayload(payloadGzipBase64: string): BackedUpPayloadRow[] {
  const compressed = Buffer.from(payloadGzipBase64, "base64");
  const json = gunzipSync(compressed).toString("utf-8");
  const parsed = JSON.parse(json) as { rows?: unknown };
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  return rows.filter((row): row is BackedUpPayloadRow => {
    if (!row || typeof row !== "object") return false;
    const value = row as Record<string, unknown>;
    return (
      typeof value.player === "string" &&
      typeof value.team === "string" &&
      (typeof value.season === "string" || typeof value.season === "number") &&
      typeof value.payload_json === "object" &&
      value.payload_json !== null
    );
  });
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

async function findIndexedPayload(
  season: number,
  team: string,
  player: string,
  gender: Gender,
): Promise<PayloadIndexRow | null> {
  try {
    const rows = await dbQuery<PayloadIndexRow>(
      `SELECT storage_provider, storage_key, public_url
              , payload_json
       FROM player_payload_index
       WHERE gender = $1 AND season = $2 AND lower(team) = lower($3) AND lower(player) = lower($4)
       LIMIT 1`,
      [gender, season, team, player],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function loadFromIndexRow(row: PayloadIndexRow, cfg: SourceCfg): Promise<CardPayload | null> {
  if (row.storage_provider === "supabase") {
    return row.payload_json ?? null;
  }
  if (row.storage_provider === "r2") {
    return await loadJsonPayloadFromObjectKey<CardPayload>(row.storage_key);
  }
  if (row.public_url) {
    return await fetchAbsoluteJson<CardPayload>(row.public_url, cfg);
  }
  return await fetchRepoJson<CardPayload>(row.storage_key, cfg);
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

async function loadFromLatestPhaseBackup(
  season: number,
  team: string,
  player: string,
  gender: Gender,
): Promise<CardPayload | null> {
  try {
    const summaries = await dbQuery<PhaseSummaryRow>(
      `select
         phase,
         count(*)::int as chunk_rows,
         min(chunk_count)::int as min_chunk_count,
         max(chunk_count)::int as max_chunk_count,
         array_agg(chunk_index order by chunk_index) as chunk_indexes
       from public.player_payload_phase_backup
       where gender = $1 and season = $2
       group by phase`,
      [gender, season],
    );

    const complete = summaries
      .filter((summary) => {
        if (!summary.phase || summary.min_chunk_count !== summary.max_chunk_count) return false;
        if (summary.min_chunk_count < 1) return false;
        return isContiguousChunkSet(summary.chunk_indexes ?? [], summary.min_chunk_count);
      })
      .sort((a, b) => phaseRank(b.phase) - phaseRank(a.phase));

    if (!complete.length) return null;

    const nt = normTeam(team);
    const np = normPlayer(player);

    for (const summary of complete) {
      const chunks = await dbQuery<BackupChunkRow>(
        `select chunk_index, chunk_count, row_count, payload_gzip_base64
         from public.player_payload_phase_backup
         where gender = $1 and season = $2 and phase = $3
         order by chunk_index asc`,
        [gender, season, summary.phase],
      );

      for (const chunk of chunks) {
        const rows = decodeChunkPayload(chunk.payload_gzip_base64);
        const match =
          rows.find((row) => normTeam(row.team) === nt && normPlayer(row.player) === np) ||
          rows.find((row) => normPlayer(row.player) === np);
        if (match?.payload_json) return match.payload_json;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function mergedSectionsHtml(payload: CardPayload): Record<string, string> {
  const merged: Record<string, string> = {};
  const sections = payload.sections_html ?? {};
  for (const [key, value] of Object.entries(sections)) {
    if (typeof value === "string") merged[key] = value;
  }
  const bundles = payload.section_bundles ?? {};
  for (const bundle of [bundles.core ?? {}, bundles.heavy ?? {}]) {
    for (const [key, value] of Object.entries(bundle)) {
      if (typeof value === "string") merged[key] = value;
    }
  }
  return merged;
}

function mergeSectionMaps(
  primary?: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = {
    ...(fallback ?? {}),
    ...(primary ?? {}),
  };
  return Object.keys(merged).length ? merged : undefined;
}

function mergePayloadWithFallback(primary: CardPayload, fallback: CardPayload, gender: Gender): CardPayload {
  const primarySections = {
    ...(primary.sections_html ?? {}),
  } as Record<string, unknown>;
  const fallbackSections = {
    ...(fallback.sections_html ?? {}),
  } as Record<string, unknown>;

  if (
    gender === "women" &&
    String(primarySections.player_comparisons_html ?? "").includes(WOMEN_AGE_GATED_COMPS_MESSAGE) &&
    String(fallbackSections.player_comparisons_html ?? "").trim()
  ) {
    primarySections.player_comparisons_html = fallbackSections.player_comparisons_html;
  }

  return {
    ...fallback,
    ...primary,
    bio: {
      ...(fallback.bio ?? {}),
      ...(primary.bio ?? {}),
    },
    per_game: {
      ...(fallback.per_game ?? {}),
      ...(primary.per_game ?? {}),
    },
    shot_chart: {
      ...(fallback.shot_chart ?? {}),
      ...(primary.shot_chart ?? {}),
    },
    sections_html: mergeSectionMaps(primarySections, fallbackSections) as CardSections | undefined,
    section_bundles: {
      core: mergeSectionMaps(primary.section_bundles?.core, fallback.section_bundles?.core),
      heavy: mergeSectionMaps(primary.section_bundles?.heavy, fallback.section_bundles?.heavy),
    },
  };
}

function isMissingAnyCriticalSection(payload: CardPayload): boolean {
  const sections = mergedSectionsHtml(payload);
  return SECTION_KEYS.some((key) => !String(sections[key] ?? "").trim());
}

export async function loadStaticPayload(
  season: number,
  team: string,
  player: string,
  genderRaw?: string,
): Promise<CardPayload> {
  const gender = parseGender(genderRaw);
  const cfg = getSourceCfg(gender);
  const backedUp = await loadFromLatestPhaseBackup(season, team, player, gender);

  if (backedUp) {
    try {
      const fallback = await loadFromStaticIndex(season, team, player, cfg);
      return await enrichPayloadBio(mergePayloadWithFallback(backedUp, fallback, gender), cfg, gender);
    } catch {
      return await enrichPayloadBio(backedUp, cfg, gender);
    }
  }

  const indexed = await findIndexedPayload(season, team, player, gender);
  if (indexed) {
    try {
      const payload = await loadFromIndexRow(indexed, cfg);
      if (payload) {
        if (!isMissingAnyCriticalSection(payload)) return await enrichPayloadBio(payload, cfg, gender);
        try {
          const fallback = await loadFromStaticIndex(season, team, player, cfg);
          return await enrichPayloadBio(mergePayloadWithFallback(payload, fallback, gender), cfg, gender);
        } catch {
          return await enrichPayloadBio(payload, cfg, gender);
        }
      }
    } catch {
      // Fall back to the existing GitHub static index path if index metadata is stale.
    }
  }

  return await enrichPayloadBio(await loadFromStaticIndex(season, team, player, cfg), cfg, gender);
}
