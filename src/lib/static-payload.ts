type CardPayload = {
  player: string;
  team: string;
  season: string;
  bio?: Record<string, unknown>;
  per_game?: Record<string, unknown>;
  shot_chart?: Record<string, unknown>;
  sections_html?: Record<string, unknown>;
};

const DATA_OWNER = process.env.GITHUB_DATA_OWNER || "dbcjason";
const DATA_REPO = process.env.GITHUB_DATA_REPO || "NCAACards";
const DATA_REF = process.env.GITHUB_DATA_REF || "main";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const STATIC_ROOT =
  process.env.GITHUB_STATIC_PAYLOAD_ROOT || "player_cards_pipeline/public/cards";

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

async function fetchJson<T>(path: string): Promise<T> {
  const url = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_REF}/${path}`;
  const headers: Record<string, string> = {};
  if (GH_TOKEN) {
    headers.Authorization = `Bearer ${GH_TOKEN}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw new Error(`Static payload fetch failed (${res.status})`);
  return (await res.json()) as T;
}

type IndexRow = {
  player: string;
  team: string;
  season: string;
  path: string;
};

export async function loadStaticPayload(season: number, team: string, player: string): Promise<CardPayload> {
  const idxPath = `${STATIC_ROOT}/${season}/index.json`;
  const rows = await fetchJson<IndexRow[]>(idxPath);
  const nt = normTeam(team);
  const np = normPlayer(player);
  const row =
    rows.find((r) => normTeam(r.team) === nt && normPlayer(r.player) === np) ||
    rows.find((r) => normPlayer(r.player) === np);
  if (!row) {
    throw new Error(`Static payload not found for ${player} (${season})`);
  }
  const payloadPath = `${STATIC_ROOT}/${season}/${row.path}`;
  return await fetchJson<CardPayload>(payloadPath);
}
