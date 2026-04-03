import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";

type SyncRow = {
  gender: "men" | "women";
  season: number;
  team: string;
  player: string;
  cache_key: string;
  source_hash: string;
  path: string;
  payload_json: unknown;
};

function authToken(): string {
  return String(process.env.PAYLOAD_SYNC_TOKEN ?? "").trim();
}

function isValidRow(row: unknown): row is SyncRow {
  if (!row || typeof row !== "object") return false;
  const value = row as Record<string, unknown>;
  return (
    (value.gender === "men" || value.gender === "women") &&
    Number.isFinite(Number(value.season)) &&
    typeof value.team === "string" &&
    typeof value.player === "string" &&
    typeof value.cache_key === "string" &&
    typeof value.source_hash === "string" &&
    typeof value.path === "string" &&
    "payload_json" in value
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

    for (const row of rows) {
      const storageKey = `${row.gender}/${row.season}/${row.path}`;
      await dbQuery(
        `insert into public.player_payload_index
          (gender, season, team, player, cache_key, source_hash, storage_provider, storage_key, public_url, payload_json, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
         on conflict (gender, season, team, player)
         do update set
           cache_key = excluded.cache_key,
           source_hash = excluded.source_hash,
           storage_provider = excluded.storage_provider,
           storage_key = excluded.storage_key,
           public_url = excluded.public_url,
           payload_json = excluded.payload_json,
           updated_at = now()`,
        [
          row.gender,
          row.season,
          row.team,
          row.player,
          row.cache_key,
          row.source_hash,
          "supabase",
          storageKey,
          null,
          JSON.stringify(row.payload_json ?? {}),
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
