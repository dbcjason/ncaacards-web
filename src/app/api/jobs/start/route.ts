import { NextRequest, NextResponse } from "next/server";
import { createJob, loadJob } from "@/lib/jobs";
import { logTelemetryEvent } from "@/lib/telemetry";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      jobType: "card" | "roster";
      request: Record<string, unknown>;
    };
    if (!body?.jobType || !body?.request) {
      return NextResponse.json({ ok: false, error: "Missing jobType/request" }, { status: 400 });
    }
    if (body.jobType === "card") {
      const r = body.request ?? {};
      await logTelemetryEvent(req, {
        eventType: "card_run",
        path: "/cards",
        gender: String(r.gender ?? ""),
        season: Number(r.season ?? 0) || null,
        team: String(r.team ?? ""),
        player: String(r.player ?? ""),
        source: "job_start",
      });
    }
    const id = await createJob(body.jobType, body.request);
    const job = await loadJob(id);
    return NextResponse.json({ ok: true, id, job });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
