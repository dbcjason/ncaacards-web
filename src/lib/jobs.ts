import { dbQuery } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { cacheVersionTag, isSeasonCacheable } from "@/lib/cache-policy";
import { resolveTeamPlayerForSeason } from "@/lib/options";
import { buildRosterPayload } from "@/lib/mock";
import { loadJsonPayload, storeJsonPayload } from "@/lib/object-store";
import { loadStaticPayload, loadTransferProjectionHtml } from "@/lib/static-payload";
import { renderCardHtmlFromPayload } from "@/lib/render-card";

export type JobType = "card" | "roster";
export type JobStatus = "queued" | "running" | "done" | "error";

export type JobRow = {
  id: string;
  job_type: JobType;
  status: JobStatus;
  progress: number;
  message: string;
  request_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
};

const inMemoryJobs = new Map<string, JobRow>();
let warnedNoDb = false;
type Gender = "men" | "women";
type RuntimeCfg = {
  dataOwner: string;
  dataRepo: string;
  dataRef: string;
  dataBt2026Path: string;
  dataEnrichedManifestPath: string;
};

function parseGender(raw?: unknown): Gender {
  return String(raw ?? "").toLowerCase() === "women" ? "women" : "men";
}

function runtimeCfg(gender: Gender): RuntimeCfg {
  if (gender === "women") {
    return {
      dataOwner: (process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason").trim(),
      dataRepo: (process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards").trim(),
      dataRef: (process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main").trim(),
      dataBt2026Path: (process.env.GITHUB_BT_2026_PATH_WOMEN || process.env.GITHUB_BT_2026_PATH || "player_cards_pipeline/data/bt/bt_advstats_2026.csv").trim(),
      dataEnrichedManifestPath: (process.env.GITHUB_ENRICHED_MANIFEST_PATH_WOMEN || process.env.GITHUB_ENRICHED_MANIFEST_PATH || "player_cards_pipeline/data/manual/enriched_players/manifest.json").trim(),
    };
  }
  return {
    dataOwner: (process.env.GITHUB_DATA_OWNER || "dbcjason").trim(),
    dataRepo: (process.env.GITHUB_DATA_REPO || "NCAACards").trim(),
    dataRef: (process.env.GITHUB_DATA_REF || "main").trim(),
    dataBt2026Path: (process.env.GITHUB_BT_2026_PATH || "player_cards_pipeline/data/bt/bt_advstats_2026.csv").trim(),
    dataEnrichedManifestPath: (process.env.GITHUB_ENRICHED_MANIFEST_PATH || "player_cards_pipeline/data/manual/enriched_players/manifest.json").trim(),
  };
}
const seasonVersionMemo = new Map<string, { value: string; ts: number }>();
const VERSION_TTL_MS = 1000 * 60 * 10;

function makeMemoryJob(jobType: JobType, request: Record<string, unknown>): JobRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    job_type: jobType,
    status: "queued",
    progress: 5,
    message: "Queued",
    request_json: request,
    result_json: null,
    error_text: null,
    created_at: now,
    updated_at: now,
  };
}

async function getRosterPayloadFromStore(req: Record<string, unknown>) {
  const season = Number(req.season ?? 0);
  const cacheAllowed = isSeasonCacheable(season);
  const cacheVersion = cacheVersionTag();
  const team = String(req.team ?? "");
  const addPlayers = Array.isArray(req.addPlayers) ? req.addPlayers.map(String) : [];
  const removePlayers = Array.isArray(req.removePlayers) ? req.removePlayers.map(String) : [];
  const addMinutesObj =
    req.addMinutes && typeof req.addMinutes === "object" ? (req.addMinutes as Record<string, unknown>) : {};
  const removeMinutesObj =
    req.removeMinutes && typeof req.removeMinutes === "object" ? (req.removeMinutes as Record<string, unknown>) : {};
  const normalizeMinutes = (obj: Record<string, unknown>) =>
    Object.entries(obj)
      .map(([k, v]) => [String(k), Number(v)] as const)
      .filter(([, v]) => Number.isFinite(v) && v >= 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
  const addMinutes = normalizeMinutes(addMinutesObj);
  const removeMinutes = normalizeMinutes(removeMinutesObj);
  const minutesHash = `inm=${addMinutes.map(([k, v]) => `${k}:${v}`).join(",")}|outm=${removeMinutes.map(([k, v]) => `${k}:${v}`).join(",")}`;
  const inHash = addPlayers.slice().sort().join("|");
  const outHash = removePlayers.slice().sort().join("|");
  const key = `roster:${season}:${team}:in=${inHash}:out=${outHash}:mins=${minutesHash}:cv=${cacheVersion}`;

  if (cacheAllowed) {
    const cached = await cacheGet<Record<string, unknown>>(key);
    if (cached) return { ...cached, cache: "hit" };
  }

  let payload: Record<string, unknown> | null = null;
  if (cacheAllowed && !addMinutes.length && !removeMinutes.length) {
    try {
      const rows = await dbQuery<{ payload: unknown }>(
        `SELECT payload
         FROM roster_payloads
         WHERE season = $1 AND team = $2 AND add_hash = $3 AND remove_hash = $4
         LIMIT 1`,
        [season, team, inHash, outHash],
      );
      if (rows[0]?.payload) payload = await loadJsonPayload<Record<string, unknown>>(rows[0].payload);
    } catch {
      payload = null;
    }
  }
  if (payload && String((payload as Record<string, unknown>).__cacheVersion ?? "") !== cacheVersion) {
    payload = null;
  }

  if (!payload) {
    const livePayload = {
      ...buildRosterPayload({
        season,
        team,
        addPlayers,
        removePlayers,
        addMinutes: Object.fromEntries(addMinutes),
        removeMinutes: Object.fromEntries(removeMinutes),
      }),
      __cacheVersion: cacheVersion,
    } as Record<string, unknown>;
    if (cacheAllowed && !addMinutes.length && !removeMinutes.length) {
      try {
        await upsertRosterPayload({
          season,
          team,
          addHash: inHash,
          removeHash: outHash,
          payload: livePayload,
        });
      } catch {
        // Keep live generation resilient even if persistence fails.
      }
    }
    if (cacheAllowed) {
      await cacheSet(key, livePayload, 60 * 10);
    }
    return { ...livePayload, cache: "live" };
  }

  if (cacheAllowed) {
    await cacheSet(key, payload, 60 * 30);
  }
  return { ...payload, cache: "miss" };
}

async function upsertRosterPayload(payloadKey: {
  season: number;
  team: string;
  addHash: string;
  removeHash: string;
  payload: Record<string, unknown>;
}) {
  if (!isSeasonCacheable(payloadKey.season)) return;
  const storedPayload = await storeJsonPayload(payloadKey.payload, [
    "rosters",
    String(payloadKey.season),
    payloadKey.team,
    payloadKey.addHash || "none",
    payloadKey.removeHash || "none",
  ]);
  await dbQuery(
    `INSERT INTO roster_payloads (season, team, add_hash, remove_hash, payload, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (season, team, add_hash, remove_hash)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
    [
      payloadKey.season,
      payloadKey.team,
      payloadKey.addHash,
      payloadKey.removeHash,
      JSON.stringify(storedPayload),
    ],
  );
}

function normalizeEtag(etag: string | null): string {
  if (!etag) return "";
  return etag.replace(/^W\//, "").replaceAll('"', "").trim();
}

async function fetchRawFileEtag(cfg: RuntimeCfg, path: string): Promise<string> {
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(cfg.dataOwner)}/${encodeURIComponent(
    cfg.dataRepo,
  )}/${encodeURIComponent(cfg.dataRef)}/${path}`;
  const res = await fetch(rawUrl, { method: "HEAD", cache: "no-store" });
  if (!res.ok) throw new Error(`HEAD ${path} failed (${res.status})`);
  return normalizeEtag(res.headers.get("etag"));
}

async function getSeasonDataVersion(season: number, cfg: RuntimeCfg): Promise<string> {
  if (season !== 2026) return "static";
  const now = Date.now();
  const memoKey = `${cfg.dataOwner}:${cfg.dataRepo}:${season}`;
  const memo = seasonVersionMemo.get(memoKey);
  if (memo && now - memo.ts < VERSION_TTL_MS) return memo.value;
  try {
    const [btTag, enrichedTag, phaseTag] = await Promise.all([
      fetchRawFileEtag(cfg, cfg.dataBt2026Path),
      fetchRawFileEtag(cfg, cfg.dataEnrichedManifestPath),
      Promise.resolve("github-cache"),
    ]);
    const value = `bt:${btTag}|en:${enrichedTag}|pb:${phaseTag}|rv:20260404c`.slice(0, 180);
    seasonVersionMemo.set(memoKey, { value, ts: now });
    return value;
  } catch {
    const fallback = `day:${new Date().toISOString().slice(0, 10)}|rv:20260404c`;
    seasonVersionMemo.set(memoKey, { value: fallback, ts: now });
    return fallback;
  }
}

async function advanceCardJob(job: JobRow): Promise<JobRow> {
  const req = { ...(job.request_json ?? {}) } as Record<string, unknown>;
  const gender = parseGender(req.gender);
  const cfg = runtimeCfg(gender);
  const season = Number(req.season ?? 0);
  const requestedTeam = String(req.team ?? "");
  const requestedPlayer = String(req.player ?? "");
  const mode = String(req.mode ?? "draft");
  const destinationConference = String(req.destinationConference ?? "");
  const resolved = await resolveTeamPlayerForSeason(season, requestedTeam, requestedPlayer, gender);
  const team = resolved.team;
  const player = resolved.player;
  const dataVersion = await getSeasonDataVersion(season, cfg);
  const cacheVersion = cacheVersionTag();
  const staticPayload = await loadStaticPayload(season, team, player, gender);
  const transferProjectionHtml =
    mode === "transfer"
      ? await loadTransferProjectionHtml(season, team, player, gender, destinationConference)
      : "";
  const renderPayload =
    mode === "transfer"
      ? {
          ...staticPayload,
          sections_html: {
            ...(staticPayload.sections_html ?? {}),
            transfer_projection_html: transferProjectionHtml,
          },
        }
      : staticPayload;
  const cardHtml = renderCardHtmlFromPayload(renderPayload, {
    gender,
    mode,
    destinationConference,
  });
  const payload: Record<string, unknown> = {
    ok: true,
    source: "precomputed_sections",
    generatedAt: new Date().toISOString(),
    input: {
      gender,
      season,
      team,
      player,
      mode,
      destinationConference,
    },
    dataVersion,
    cacheVersion,
    cardHtml,
    staticPayload: renderPayload,
  };
  await updateJob(job.id, {
    status: "done",
    progress: 100,
    message: "Completed",
    result_json: { ...payload, cache: "miss" },
  });
  return (await loadJob(job.id)) ?? job;
}

export async function createJob(jobType: JobType, request: Record<string, unknown>) {
  try {
    const rows = await dbQuery<{ id: string }>(
      `INSERT INTO jobs (job_type, status, progress, message, request_json)
       VALUES ($1, 'queued', 5, 'Queued', $2::jsonb)
       RETURNING id`,
      [jobType, JSON.stringify(request)],
    );
    return rows[0].id;
  } catch {
    const job = makeMemoryJob(jobType, request);
    inMemoryJobs.set(job.id, job);
    if (!warnedNoDb) {
      console.warn("Falling back to in-memory jobs (DB unavailable)");
      warnedNoDb = true;
    }
    return job.id;
  }
}

export async function loadJob(id: string): Promise<JobRow | null> {
  try {
    const rows = await dbQuery<JobRow>(
      `SELECT id, job_type, status, progress, message, request_json, result_json, error_text, created_at, updated_at
       FROM jobs
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  } catch {
    return inMemoryJobs.get(id) ?? null;
  }
}

export async function updateJob(id: string, patch: Partial<JobRow>) {
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = $${idx++}`);
      vals.push(v);
    }
    if (!sets.length) return;
    vals.push(id);
    await dbQuery(`UPDATE jobs SET ${sets.join(", ")}, updated_at = now() WHERE id = $${idx}`, vals);
  } catch {
    const cur = inMemoryJobs.get(id);
    if (!cur) return;
    const next: JobRow = { ...cur, ...patch, updated_at: new Date().toISOString() };
    inMemoryJobs.set(id, next);
  }
}

export async function advanceJobIfNeeded(job: JobRow): Promise<JobRow> {
  if (job.status === "done" || job.status === "error") return job;

  if (job.status === "queued") {
    await updateJob(job.id, { status: "running", progress: 15, message: "Loading payload" });
    const next = await loadJob(job.id);
    if (next) return next;
  }

  try {
    if (job.job_type === "card") {
      return await advanceCardJob(job);
    }
    const req = (job.request_json ?? {}) as Record<string, unknown>;
    const payload = await getRosterPayloadFromStore(req);
    await updateJob(job.id, {
      status: "done",
      progress: 100,
      message: "Completed",
      result_json: payload,
    });
  } catch (e) {
    await updateJob(job.id, {
      status: "error",
      progress: 100,
      message: "Failed",
      error_text: e instanceof Error ? e.message : String(e),
    });
  }

  return (await loadJob(job.id)) ?? job;
}
