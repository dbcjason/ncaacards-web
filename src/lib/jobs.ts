import { dbQuery } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { resolveTeamPlayerForSeason } from "@/lib/options";
import { buildRosterPayload } from "@/lib/mock";
import { loadJsonPayload, storeJsonPayload } from "@/lib/object-store";
import { loadStaticPayload } from "@/lib/static-payload";
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
type CardBuildProvider = "github" | "precomputed";
type RuntimeCfg = {
  ghOwner: string;
  ghRepo: string;
  ghWorkflow: string;
  ghRef: string;
  ghToken: string;
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
      ghOwner: (process.env.GITHUB_OWNER_WOMEN || process.env.GITHUB_OWNER || "").trim(),
      ghRepo: (process.env.GITHUB_REPO_WOMEN || "NCAAWCards").trim(),
      ghWorkflow: (process.env.GITHUB_WORKFLOW_FILE_WOMEN || process.env.GITHUB_WORKFLOW_FILE || "").trim(),
      ghRef: (process.env.GITHUB_REF_WOMEN || process.env.GITHUB_REF || "main").trim(),
      ghToken: (process.env.GITHUB_TOKEN_WOMEN || process.env.GITHUB_TOKEN || "").trim(),
      dataOwner: (process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason").trim(),
      dataRepo: (process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards").trim(),
      dataRef: (process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main").trim(),
      dataBt2026Path: (process.env.GITHUB_BT_2026_PATH_WOMEN || process.env.GITHUB_BT_2026_PATH || "player_cards_pipeline/data/bt/bt_advstats_2026.csv").trim(),
      dataEnrichedManifestPath: (process.env.GITHUB_ENRICHED_MANIFEST_PATH_WOMEN || process.env.GITHUB_ENRICHED_MANIFEST_PATH || "player_cards_pipeline/data/manual/enriched_players/manifest.json").trim(),
    };
  }
  return {
    ghOwner: (process.env.GITHUB_OWNER ?? "").trim(),
    ghRepo: (process.env.GITHUB_REPO ?? "").trim(),
    ghWorkflow: (process.env.GITHUB_WORKFLOW_FILE ?? "").trim(),
    ghRef: (process.env.GITHUB_REF ?? "main").trim(),
    ghToken: (process.env.GITHUB_TOKEN ?? "").trim(),
    dataOwner: (process.env.GITHUB_DATA_OWNER || "dbcjason").trim(),
    dataRepo: (process.env.GITHUB_DATA_REPO || "NCAACards").trim(),
    dataRef: (process.env.GITHUB_DATA_REF || "main").trim(),
    dataBt2026Path: (process.env.GITHUB_BT_2026_PATH || "player_cards_pipeline/data/bt/bt_advstats_2026.csv").trim(),
    dataEnrichedManifestPath: (process.env.GITHUB_ENRICHED_MANIFEST_PATH || "player_cards_pipeline/data/manual/enriched_players/manifest.json").trim(),
  };
}

function parseCardBuildProvider(raw: string | undefined, fallback: CardBuildProvider): CardBuildProvider {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "precomputed") return "precomputed";
  if (normalized === "github") return "github";
  return fallback;
}

function cardBuildProvider(gender: Gender): CardBuildProvider {
  if (gender === "women") {
    return parseCardBuildProvider(process.env.CARD_BUILD_PROVIDER_WOMEN, "precomputed");
  }
  return parseCardBuildProvider(process.env.CARD_BUILD_PROVIDER, "github");
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

async function getCardPayloadFromStore(req: Record<string, unknown>) {
  const gender = parseGender(req.gender);
  const cfg = runtimeCfg(gender);
  const season = Number(req.season ?? 0);
  const requestedTeam = String(req.team ?? "");
  const requestedPlayer = String(req.player ?? "");
  const mode = String(req.mode ?? "draft");
  const destinationConference = String(req.destinationConference ?? "");
  const resolved = await resolveTeamPlayerForSeason(season, requestedTeam, requestedPlayer);
  const team = resolved.team;
  const player = resolved.player;
  const dataVersion = await getSeasonDataVersion(season, cfg);
  const key = cardCacheKey({
    gender,
    season,
    team,
    player,
    mode,
    destinationConference,
    dataVersion,
  });

  const cached = await cacheGet<Record<string, unknown>>(key);
  if (cached) return { ...cached, cache: "hit" };
  const legacyCached = await cacheGet<Record<string, unknown>>(
    cardCacheKey({ gender, season, team, player, mode, destinationConference }),
  );
  if (legacyCached) {
    await cacheSet(key, legacyCached, season <= 2025 ? 60 * 60 * 24 * 365 : 60 * 60 * 24);
    return { ...legacyCached, cache: "hit" };
  }

  let payload: Record<string, unknown> | null = null;
  try {
    const rows = await dbQuery<{ payload: unknown }>(
      `SELECT payload
       FROM card_payloads
       WHERE season = $1 AND team = $2 AND player = $3 AND mode = $4 AND destination_conference = $5
       LIMIT 1`,
      [season, team, player, mode, destinationConference],
    );
    if (rows[0]?.payload) payload = await loadJsonPayload<Record<string, unknown>>(rows[0].payload);
  } catch {
    payload = null;
  }

  if (
    payload &&
    season === 2026 &&
    String((payload as Record<string, unknown>).dataVersion ?? "") !== dataVersion
  ) {
    payload = null;
  }

  if (!payload) return null;

  await cacheSet(key, payload, season <= 2025 ? 60 * 60 * 24 * 365 : 60 * 60 * 24);
  return { ...payload, cache: "miss" };
}

async function getRosterPayloadFromStore(req: Record<string, unknown>) {
  const season = Number(req.season ?? 0);
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
  const key = `roster:${season}:${team}:in=${inHash}:out=${outHash}:mins=${minutesHash}`;

  const cached = await cacheGet<Record<string, unknown>>(key);
  if (cached) return { ...cached, cache: "hit" };

  let payload: Record<string, unknown> | null = null;
  if (!addMinutes.length && !removeMinutes.length) {
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

  if (!payload) {
    const livePayload = buildRosterPayload({
      season,
      team,
      addPlayers,
      removePlayers,
      addMinutes: Object.fromEntries(addMinutes),
      removeMinutes: Object.fromEntries(removeMinutes),
    }) as Record<string, unknown>;
    if (!addMinutes.length && !removeMinutes.length) {
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
    await cacheSet(key, livePayload, 60 * 10);
    return { ...livePayload, cache: "live" };
  }

  await cacheSet(key, payload, 60 * 30);
  return { ...payload, cache: "miss" };
}

function githubReady(cfg: RuntimeCfg): boolean {
  return Boolean(cfg.ghOwner && cfg.ghRepo && cfg.ghWorkflow && cfg.ghRef && cfg.ghToken);
}

function safeFilePart(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cardCacheKey(input: {
  gender?: string;
  season: number;
  team: string;
  player: string;
  mode: string;
  destinationConference: string;
  dataVersion?: string;
}) {
  const suffix = input.dataVersion ? `:v=${input.dataVersion}` : "";
  const g = parseGender(input.gender);
  return `card:${g}:${input.season}:${input.team}:${input.player}:${input.mode}:${input.destinationConference}${suffix}`;
}

async function ghApi(cfg: RuntimeCfg, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.ghToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function dispatchCardWorkflow(input: {
  cfg: RuntimeCfg;
  year: number;
  player: string;
  team: string;
  mode: string;
  destinationConference: string;
  outputFilename: string;
}) {
  const body = {
    ref: input.cfg.ghRef,
    inputs: {
      year: String(input.year),
      player: input.player,
      team: input.team,
      output_filename: input.outputFilename,
      commit_to_repo: true,
      transfer_up: input.mode === "transfer",
      destination_conference: input.mode === "transfer" ? input.destinationConference : "",
    },
  };
  const r = await ghApi(
    input.cfg,
    `/repos/${encodeURIComponent(input.cfg.ghOwner)}/${encodeURIComponent(
      input.cfg.ghRepo,
    )}/actions/workflows/${encodeURIComponent(input.cfg.ghWorkflow)}/dispatches`,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Workflow dispatch failed (${r.status}): ${t.slice(0, 300)}`);
  }
}

async function findDispatchedRunId(cfg: RuntimeCfg, dispatchedAtIso: string): Promise<number | null> {
  const r = await ghApi(
    cfg,
    `/repos/${encodeURIComponent(cfg.ghOwner)}/${encodeURIComponent(
      cfg.ghRepo,
    )}/actions/workflows/${encodeURIComponent(cfg.ghWorkflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(
      cfg.ghRef,
    )}&per_page=20`,
  );
  if (!r.ok) return null;
  const j = (await r.json()) as { workflow_runs?: Array<{ id: number; created_at: string }> };
  const runs = Array.isArray(j.workflow_runs) ? j.workflow_runs : [];
  const cutoff = Date.parse(dispatchedAtIso) - 30_000;
  for (const run of runs) {
    const ts = Date.parse(run.created_at);
    if (Number.isFinite(ts) && ts >= cutoff) return run.id;
  }
  return null;
}

async function getRun(cfg: RuntimeCfg, runId: number): Promise<{ status: string; conclusion: string | null } | null> {
  const r = await ghApi(
    cfg,
    `/repos/${encodeURIComponent(cfg.ghOwner)}/${encodeURIComponent(cfg.ghRepo)}/actions/runs/${runId}`,
  );
  if (!r.ok) return null;
  const j = (await r.json()) as { status?: string; conclusion?: string | null };
  return { status: String(j.status ?? ""), conclusion: j.conclusion ?? null };
}

async function fetchCommittedCardHtml(cfg: RuntimeCfg, outputFilename: string): Promise<string> {
  const path = `player_cards_pipeline/output/${outputFilename}`;
  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const r = await ghApi(
    cfg,
    `/repos/${encodeURIComponent(cfg.ghOwner)}/${encodeURIComponent(
      cfg.ghRepo,
    )}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.ghRef)}`,
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Failed to fetch committed HTML (${r.status}): ${t.slice(0, 300)}`);
  }
  const j = (await r.json()) as { content?: string; encoding?: string };
  if (j.encoding !== "base64" || !j.content) throw new Error("Committed HTML content missing");
  const b64 = j.content.replace(/\s+/g, "");
  return Buffer.from(b64, "base64").toString("utf-8");
}

async function upsertCardPayload(payloadKey: {
  season: number;
  team: string;
  player: string;
  mode: string;
  destinationConference: string;
  payload: Record<string, unknown>;
}) {
  const storedPayload = await storeJsonPayload(payloadKey.payload, [
    "cards",
    String(payloadKey.season),
    payloadKey.team,
    payloadKey.player,
    payloadKey.mode,
    payloadKey.destinationConference || "na",
  ]);
  await dbQuery(
    `INSERT INTO card_payloads (season, team, player, mode, destination_conference, payload, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (season, team, player, mode, destination_conference)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
    [
      payloadKey.season,
      payloadKey.team,
      payloadKey.player,
      payloadKey.mode,
      payloadKey.destinationConference,
      JSON.stringify(storedPayload),
    ],
  );
}

async function upsertRosterPayload(payloadKey: {
  season: number;
  team: string;
  addHash: string;
  removeHash: string;
  payload: Record<string, unknown>;
}) {
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
    const [btTag, enrichedTag] = await Promise.all([
      fetchRawFileEtag(cfg, cfg.dataBt2026Path),
      fetchRawFileEtag(cfg, cfg.dataEnrichedManifestPath),
    ]);
    const value = `bt:${btTag}|en:${enrichedTag}`.slice(0, 180);
    seasonVersionMemo.set(memoKey, { value, ts: now });
    return value;
  } catch {
    const fallback = `day:${new Date().toISOString().slice(0, 10)}`;
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

  const existing = await getCardPayloadFromStore({
    ...req,
    gender,
    season,
    team,
    player,
    mode,
    destinationConference,
  });
  if (existing) {
    await updateJob(job.id, {
      status: "done",
      progress: 100,
      message: "Completed",
      result_json: existing,
    });
    return (await loadJob(job.id)) ?? job;
  }

  const provider = cardBuildProvider(gender);
  if (provider === "precomputed") {
    const staticPayload = await loadStaticPayload(season, team, player, gender);
    const cardHtml = renderCardHtmlFromPayload(staticPayload, {
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
      cardHtml,
      staticPayload,
    };
    await upsertCardPayload({
      season,
      team,
      player,
      mode,
      destinationConference,
      payload,
    });
    const cacheKey = cardCacheKey({
      gender,
      season,
      team,
      player,
      mode,
      destinationConference,
      dataVersion,
    });
    await cacheSet(cacheKey, payload, season <= 2025 ? 60 * 60 * 24 * 365 : 60 * 60 * 24);
    await updateJob(job.id, {
      status: "done",
      progress: 100,
      message: "Completed from precomputed sections",
      result_json: { ...payload, cache: "miss" },
    });
    return (await loadJob(job.id)) ?? job;
  }

  if (!githubReady(cfg)) {
    throw new Error("GitHub workflow env vars missing (GITHUB_OWNER/REPO/WORKFLOW_FILE/REF/TOKEN).");
  }

  const state = (req.__cardState ?? {}) as Record<string, unknown>;
  const outputFilename =
    String(state.outputFilename ?? "").trim() ||
    `web_${season}_${safeFilePart(team)}_${safeFilePart(player)}_${mode}_${safeFilePart(
      destinationConference || "na",
    )}.html`;

  let dispatchedAt = String(state.dispatchedAt ?? "").trim();
  let runId = Number(state.runId ?? 0);

  if (!dispatchedAt) {
    await dispatchCardWorkflow({
      cfg,
      year: season,
      player,
      team,
      mode,
      destinationConference,
      outputFilename,
    });
    dispatchedAt = new Date().toISOString();
    await updateJob(job.id, {
      progress: 30,
      message: "Dispatched GitHub build",
      request_json: {
        ...req,
        team,
        player,
        __cardState: { outputFilename, dispatchedAt },
      },
    } as Partial<JobRow>);
    return (await loadJob(job.id)) ?? job;
  }

  if (!Number.isFinite(runId) || runId <= 0) {
    const found = await findDispatchedRunId(cfg, dispatchedAt);
    if (!found) {
      await updateJob(job.id, {
        progress: 40,
        message: "Waiting for GitHub run to appear",
      });
      return (await loadJob(job.id)) ?? job;
    }
    runId = found;
    await updateJob(job.id, {
      progress: 50,
      message: `GitHub run detected (#${runId})`,
      request_json: {
        ...req,
        team,
        player,
        __cardState: { outputFilename, dispatchedAt, runId },
      },
    } as Partial<JobRow>);
    return (await loadJob(job.id)) ?? job;
  }

  const run = await getRun(cfg, runId);
  if (!run) {
    await updateJob(job.id, { progress: 55, message: "Checking GitHub run status" });
    return (await loadJob(job.id)) ?? job;
  }
  if (run.status !== "completed") {
    await updateJob(job.id, { progress: 70, message: `GitHub run ${run.status}` });
    return (await loadJob(job.id)) ?? job;
  }
  if (run.conclusion !== "success") {
    throw new Error(`GitHub run failed (conclusion=${run.conclusion ?? "unknown"})`);
  }

  await updateJob(job.id, { progress: 85, message: "Fetching generated card" });
  const cardHtml = await fetchCommittedCardHtml(cfg, outputFilename);
  const payload: Record<string, unknown> = {
    ok: true,
    source: "github_action",
    generatedAt: new Date().toISOString(),
    input: {
      gender,
      season,
      team,
      player,
      mode: mode === "transfer" ? "transfer" : "draft",
      destinationConference: mode === "transfer" ? destinationConference : "",
    },
    dataVersion,
    cardHtml,
  };
  await upsertCardPayload({
    season,
    team,
    player,
    mode,
    destinationConference,
    payload,
  });
  const cacheKey = cardCacheKey({
    gender,
    season,
    team,
    player,
    mode,
    destinationConference,
    dataVersion,
  });
  await cacheSet(cacheKey, payload, season <= 2025 ? 60 * 60 * 24 * 365 : 60 * 60 * 24);
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
