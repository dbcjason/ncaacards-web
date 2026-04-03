import { dbQuery } from "@/lib/db";
import { loadJsonPayloadFromObjectKey } from "@/lib/object-store";

type CardPayload = {
  player: string;
  team: string;
  season: string;
  bio?: Record<string, unknown>;
  per_game?: Record<string, unknown>;
  shot_chart?: Record<string, unknown>;
  sections_html?: Record<string, unknown>;
};

type Gender = "men" | "women";

type SourceCfg = {
  dataOwner: string;
  dataRepo: string;
  dataRef: string;
  dataToken: string;
  staticRoot: string;
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
    };
  }
  return {
    dataOwner: process.env.GITHUB_DATA_OWNER || "dbcjason",
    dataRepo: process.env.GITHUB_DATA_REPO || "NCAACards",
    dataRef: process.env.GITHUB_DATA_REF || "main",
    dataToken: (process.env.GITHUB_TOKEN || "").trim(),
    staticRoot: process.env.GITHUB_STATIC_PAYLOAD_ROOT || "player_cards_pipeline/public/cards",
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

export async function loadStaticPayload(
  season: number,
  team: string,
  player: string,
  genderRaw?: string,
): Promise<CardPayload> {
  const gender = parseGender(genderRaw);
  const cfg = getSourceCfg(gender);

  const indexed = await findIndexedPayload(season, team, player, gender);
  if (indexed) {
    try {
      const payload = await loadFromIndexRow(indexed, cfg);
      if (payload) return payload;
    } catch {
      // Fall back to the existing GitHub static index path if index metadata is stale.
    }
  }

  return await loadFromStaticIndex(season, team, player, cfg);
}
