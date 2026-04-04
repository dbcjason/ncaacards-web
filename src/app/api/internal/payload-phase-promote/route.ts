import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withDbTransaction } from "@/lib/db";

export const runtime = "nodejs";

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

type Gender = "men" | "women";

type PromoteRequest = {
  gender?: Gender;
  season?: number;
  phase?: string;
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
  cache_key?: string;
  player: string;
  team: string;
  season: string | number;
  path: string;
  payload_json: unknown;
};

function authToken(): string {
  return String(process.env.PAYLOAD_SYNC_TOKEN ?? "").trim();
}

function isValidGender(value: unknown): value is Gender {
  return value === "men" || value === "women";
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
      typeof value.path === "string" &&
      "payload_json" in value
    );
  });
}

function sourceHashForRow(row: BackedUpPayloadRow, phase: string): string {
  const payload = JSON.stringify(row.payload_json ?? {});
  return createHash("sha256")
    .update(`${phase}\n${row.cache_key ?? ""}\n${row.player}\n${row.team}\n${row.season}\n${row.path}\n${payload}`)
    .digest("hex");
}

async function resolveTargetPhase(
  gender: Gender,
  season: number,
  requestedPhase?: string,
): Promise<{ phase: string; summaries: PhaseSummaryRow[] }> {
  const summaries = await withDbTransaction(async (client) => {
    const result = await client.query(
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
    return result.rows as PhaseSummaryRow[];
  });

  const completeSummaries = summaries.filter((summary) => {
    if (!summary.phase || summary.min_chunk_count !== summary.max_chunk_count) return false;
    if (summary.min_chunk_count < 1) return false;
    return isContiguousChunkSet(summary.chunk_indexes ?? [], summary.min_chunk_count);
  });

  if (requestedPhase) {
    const match = completeSummaries.find((summary) => summary.phase === requestedPhase);
    if (!match) {
      throw new Error(`Requested phase '${requestedPhase}' is not fully backed up for ${gender} ${season}.`);
    }
    return { phase: match.phase, summaries };
  }

  const sorted = [...completeSummaries].sort((a, b) => phaseRank(b.phase) - phaseRank(a.phase));
  const latest = sorted.find((summary) => phaseRank(summary.phase) >= 0);
  if (!latest) {
    throw new Error(`No fully backed up phases found for ${gender} ${season}.`);
  }
  return { phase: latest.phase, summaries };
}

export async function POST(req: NextRequest) {
  try {
    const configuredToken = authToken();
    if (!configuredToken) {
      return NextResponse.json({ ok: false, error: "PAYLOAD_SYNC_TOKEN is not configured" }, { status: 500 });
    }

    const authHeader = String(req.headers.get("authorization") ?? "");
    if (authHeader !== `Bearer ${configuredToken}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as PromoteRequest;
    const gender = isValidGender(body.gender) ? body.gender : "women";
    const season = Number(body.season ?? 2026);
    const requestedPhase = typeof body.phase === "string" && body.phase.trim() ? body.phase.trim() : undefined;
    if (!Number.isInteger(season) || season < 2000) {
      return NextResponse.json({ ok: false, error: "Invalid season" }, { status: 400 });
    }

    const { phase, summaries } = await resolveTargetPhase(gender, season, requestedPhase);
    const backupChunks = await withDbTransaction(async (client) => {
      const result = await client.query(
        `select chunk_index, chunk_count, row_count, payload_gzip_base64
         from public.player_payload_phase_backup
         where gender = $1 and season = $2 and phase = $3
         order by chunk_index asc`,
        [gender, season, phase],
      );
      return result.rows as BackupChunkRow[];
    });

    if (!backupChunks.length) {
      return NextResponse.json({ ok: false, error: `No backup chunks found for ${gender} ${season} ${phase}` }, { status: 404 });
    }

    const promotedRows: BackedUpPayloadRow[] = [];
    for (const chunk of backupChunks) {
      const rows = decodeChunkPayload(chunk.payload_gzip_base64);
      if (rows.length !== chunk.row_count) {
        throw new Error(
          `Backup chunk ${chunk.chunk_index} row count mismatch for ${gender} ${season} ${phase}: expected ${chunk.row_count}, got ${rows.length}.`,
        );
      }
      promotedRows.push(...rows);
    }

    const batchSize = 100;
    await withDbTransaction(async (client) => {
      for (let start = 0; start < promotedRows.length; start += batchSize) {
        const batch = promotedRows.slice(start, start + batchSize);
        const values: string[] = [];
        const params: unknown[] = [];

        batch.forEach((row, index) => {
          const base = index * 10;
          values.push(
            `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10}::jsonb,now())`,
          );
          params.push(
            gender,
            Number(row.season || season),
            String(row.team ?? ""),
            String(row.player ?? ""),
            String(row.cache_key ?? ""),
            sourceHashForRow(row, phase),
            "supabase",
            `${gender}/${season}/${row.path}`,
            null,
            JSON.stringify(row.payload_json ?? {}),
          );
        });

        await client.query(
          `insert into public.player_payload_index
            (gender, season, team, player, cache_key, source_hash, storage_provider, storage_key, public_url, payload_json, updated_at)
           values ${values.join(",")}
           on conflict (gender, season, team, player)
           do update set
             cache_key = excluded.cache_key,
             source_hash = excluded.source_hash,
             storage_provider = excluded.storage_provider,
             storage_key = excluded.storage_key,
             public_url = excluded.public_url,
             payload_json = excluded.payload_json,
             updated_at = now()`,
          params,
        );
      }
    });

    return NextResponse.json({
      ok: true,
      gender,
      season,
      phase,
      promoted_count: promotedRows.length,
      available_phases: summaries
        .map((summary) => summary.phase)
        .sort((a, b) => phaseRank(a) - phaseRank(b)),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
