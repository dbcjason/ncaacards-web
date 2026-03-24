import { NextRequest, NextResponse } from "next/server";
import { logTelemetryEvent } from "@/lib/telemetry";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      eventType?: "transfer_search";
      gender?: string;
      season?: number;
      queryText?: string;
      source?: string;
    };
    if (body?.eventType !== "transfer_search") {
      return NextResponse.json({ ok: false, error: "Unsupported telemetry event type" }, { status: 400 });
    }
    const q = String(body.queryText || "").trim();
    if (q.length < 2) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    await logTelemetryEvent(req, {
      eventType: "transfer_search",
      path: "/transfer-grades",
      gender: String(body.gender || ""),
      season: Number(body.season || 0) || null,
      queryText: q,
      source: String(body.source || "transfer_grades_filter"),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

