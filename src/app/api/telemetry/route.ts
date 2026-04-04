import { NextRequest, NextResponse } from "next/server";
import { logUsageEvent, requireUser } from "@/lib/auth";
import { logTelemetryEvent } from "@/lib/telemetry";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
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
    const gender = String(body.gender || "").toLowerCase() === "women" ? "women" : "men";
    await logTelemetryEvent(req, {
      eventType: "transfer_search",
      path: "/transfer-grades",
      gender,
      season: Number(body.season || 0) || null,
      queryText: q,
      source: String(body.source || "transfer_grades_filter"),
    });
    await logUsageEvent({
      organizationId: user.organization_id,
      userId: user.id,
      eventType: "transfer_search",
      email: user.email,
      gender,
      season: Number(body.season || 0) || null,
      queryText: q,
      path: "/transfer-grades",
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
