import type { NextRequest } from "next/server";
import { dbQuery } from "@/lib/db";

type TelemetryPayload = {
  eventType: "card_run" | "transfer_search";
  path?: string;
  gender?: string;
  season?: number | null;
  team?: string | null;
  player?: string | null;
  queryText?: string | null;
  source?: string | null;
};

let schemaReady = false;

async function ensureTelemetrySchema() {
  if (schemaReady) return;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS site_telemetry_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      path TEXT,
      gender TEXT,
      season INT,
      team TEXT,
      player TEXT,
      query_text TEXT,
      source TEXT,
      country TEXT,
      region TEXT,
      city TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_site_telemetry_events_created_at ON site_telemetry_events(created_at DESC)`,
  );
  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_site_telemetry_events_type_created ON site_telemetry_events(event_type, created_at DESC)`,
  );
  schemaReady = true;
}

function geoFromReq(req: NextRequest): { country: string; region: string; city: string } {
  const h = req.headers;
  return {
    country: String(h.get("x-vercel-ip-country") || "").trim(),
    region: String(h.get("x-vercel-ip-country-region") || "").trim(),
    city: String(h.get("x-vercel-ip-city") || "").trim(),
  };
}

function clean(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 300) : null;
}

export async function logTelemetryEvent(req: NextRequest, payload: TelemetryPayload): Promise<void> {
  try {
    await ensureTelemetrySchema();
    const geo = geoFromReq(req);
    await dbQuery(
      `INSERT INTO site_telemetry_events
      (event_type, path, gender, season, team, player, query_text, source, country, region, city)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        payload.eventType,
        clean(payload.path),
        clean(payload.gender),
        payload.season ?? null,
        clean(payload.team),
        clean(payload.player),
        clean(payload.queryText),
        clean(payload.source),
        clean(geo.country),
        clean(geo.region),
        clean(geo.city),
      ],
    );
  } catch {
    // Best-effort telemetry only; never fail user flows.
  }
}

