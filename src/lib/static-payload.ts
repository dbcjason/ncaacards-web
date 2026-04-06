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
      return await fetchAbsoluteText(payload.download_url, cfg);
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${cfg.dataOwner}/${cfg.dataRepo}/${cfg.dataRef}/${path}`;
  const res = await fetch(rawUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Payload fetch failed (${res.status})`);
  return await res.text();
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

export async function loadStaticPayload(
  season: number,
  team: string,
  player: string,
  genderRaw?: string,
): Promise<CardPayload> {
  const gender = parseGender(genderRaw);
  const cfg = getSourceCfg(gender);
  return await enrichPayloadBio(await loadFromStaticIndex(season, team, player, cfg), cfg, gender);
}
