import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";

type PhaseBackupRow = {
  gender: "men" | "women";
  season: number;
  phase: string;
  chunk_index: number;
  chunk_count: number;
  row_count: number;
  payload_gzip_base64: string;
  metadata_json?: unknown;
};

function authToken(): string {
  return String(process.env.PAYLOAD_SYNC_TOKEN ?? "").trim();
}

let ensureTablePromise: Promise<void> | null = null;

async function ensurePhaseBackupTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await dbQuery(
        `create table if not exists public.player_payload_phase_backup (
          gender text not null check (gender in ('men', 'women')),
          season integer not null,
          phase text not null,
          chunk_index integer not null check (chunk_index >= 0),
          chunk_count integer not null check (chunk_count >= 1),
          row_count integer not null default 0 check (row_count >= 0),
          payload_gzip_base64 text not null,
          metadata_json jsonb not null default '{}'::jsonb,
          updated_at timestamptz not null default now(),
          primary key (gender, season, phase, chunk_index)
        )`,
      );
      await dbQuery(
        `create index if not exists idx_player_payload_phase_backup_lookup
         on public.player_payload_phase_backup (gender, season, phase)`,
      );
    })();
  }
  await ensureTablePromise;
}

function isValidRow(row: unknown): row is PhaseBackupRow {
  if (!row || typeof row !== "object") return false;
  const value = row as Record<string, unknown>;
  return (
    (value.gender === "men" || value.gender === "women") &&
    Number.isFinite(Number(value.season)) &&
    typeof value.phase === "string" &&
    value.phase.trim().length > 0 &&
    Number.isInteger(Number(value.chunk_index)) &&
    Number(value.chunk_index) >= 0 &&
    Number.isInteger(Number(value.chunk_count)) &&
    Number(value.chunk_count) >= 1 &&
    Number.isInteger(Number(value.row_count)) &&
    Number(value.row_count) >= 0 &&
    typeof value.payload_gzip_base64 === "string" &&
    value.payload_gzip_base64.length > 0
  );
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

    const body = (await req.json()) as { rows?: unknown[] };
    const rawRows = Array.isArray(body?.rows) ? body.rows : [];
    const rows = rawRows.filter(isValidRow);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "Missing valid rows" }, { status: 400 });
    }

    await ensurePhaseBackupTable();

    for (const row of rows) {
      await dbQuery(
        `insert into public.player_payload_phase_backup
          (gender, season, phase, chunk_index, chunk_count, row_count, payload_gzip_base64, metadata_json, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
         on conflict (gender, season, phase, chunk_index)
         do update set
           chunk_count = excluded.chunk_count,
           row_count = excluded.row_count,
           payload_gzip_base64 = excluded.payload_gzip_base64,
           metadata_json = excluded.metadata_json,
           updated_at = now()`,
        [
          row.gender,
          row.season,
          row.phase,
          row.chunk_index,
          row.chunk_count,
          row.row_count,
          row.payload_gzip_base64,
          JSON.stringify(row.metadata_json ?? {}),
        ],
      );
    }

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
