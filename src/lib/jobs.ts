import { dbQuery } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { buildCardPayload, buildRosterPayload } from "@/lib/mock";

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
  const season = Number(req.season ?? 0);
  const team = String(req.team ?? "");
  const player = String(req.player ?? "");
  const mode = String(req.mode ?? "draft");
  const destinationConference = String(req.destinationConference ?? "");
  const key = `card:${season}:${team}:${player}:${mode}:${destinationConference}`;

  const cached = await cacheGet<Record<string, unknown>>(key);
  if (cached) return { ...cached, cache: "hit" };

  let payload: Record<string, unknown> | null = null;
  try {
    const rows = await dbQuery<{ payload: Record<string, unknown> }>(
      `SELECT payload
       FROM card_payloads
       WHERE season = $1 AND team = $2 AND player = $3 AND mode = $4 AND destination_conference = $5
       LIMIT 1`,
      [season, team, player, mode, destinationConference],
    );
    if (rows[0]?.payload) payload = rows[0].payload;
  } catch {
    payload = null;
  }

  if (!payload) {
    payload = buildCardPayload({
      season,
      team,
      player,
      mode: mode === "transfer" ? "transfer" : "draft",
      destinationConference,
    }) as Record<string, unknown>;
  }

  await cacheSet(key, payload, 60 * 60 * 24);
  return { ...payload, cache: "miss" };
}

async function getRosterPayloadFromStore(req: Record<string, unknown>) {
  const season = Number(req.season ?? 0);
  const team = String(req.team ?? "");
  const addPlayers = Array.isArray(req.addPlayers) ? req.addPlayers.map(String) : [];
  const removePlayers = Array.isArray(req.removePlayers) ? req.removePlayers.map(String) : [];
  const inHash = addPlayers.slice().sort().join("|");
  const outHash = removePlayers.slice().sort().join("|");
  const key = `roster:${season}:${team}:in=${inHash}:out=${outHash}`;

  const cached = await cacheGet<Record<string, unknown>>(key);
  if (cached) return { ...cached, cache: "hit" };

  let payload: Record<string, unknown> | null = null;
  try {
    const rows = await dbQuery<{ payload: Record<string, unknown> }>(
      `SELECT payload
       FROM roster_payloads
       WHERE season = $1 AND team = $2 AND add_hash = $3 AND remove_hash = $4
       LIMIT 1`,
      [season, team, inHash, outHash],
    );
    if (rows[0]?.payload) payload = rows[0].payload;
  } catch {
    payload = null;
  }

  if (!payload) {
    payload = buildRosterPayload({
      season,
      team,
      addPlayers,
      removePlayers,
    }) as Record<string, unknown>;
  }

  await cacheSet(key, payload, 60 * 30);
  return { ...payload, cache: "miss" };
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
  const elapsedMs = Date.now() - new Date(job.created_at).getTime();

  if (job.status === "queued") {
    await updateJob(job.id, { status: "running", progress: 20, message: "Loading payload" });
    const next = await loadJob(job.id);
    if (next) return next;
  }

  if (elapsedMs < 1000) {
    const p = Math.max(20, Math.min(60, Math.floor(elapsedMs / 20)));
    await updateJob(job.id, { status: "running", progress: p, message: "Computing" });
    const next = await loadJob(job.id);
    return next ?? job;
  }

  try {
    const req = (job.request_json ?? {}) as Record<string, unknown>;
    const payload =
      job.job_type === "card"
        ? await getCardPayloadFromStore(req)
        : await getRosterPayloadFromStore(req);
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
