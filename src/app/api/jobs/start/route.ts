import { NextRequest, NextResponse } from "next/server";
import { createJob, loadJob } from "@/lib/jobs";
import { assertGenderAccess, logUsageEvent, requireUser } from "@/lib/auth";
import { logTelemetryEvent } from "@/lib/telemetry";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      jobType: "card" | "roster";
      request: Record<string, unknown>;
    };
    if (!body?.jobType || !body?.request) {
      return NextResponse.json({ ok: false, error: "Missing jobType/request" }, { status: 400 });
    }
    if (body.jobType === "card") {
      const r = body.request ?? {};
      const gender = String(r.gender ?? "").toLowerCase() === "women" ? "women" : "men";
      assertGenderAccess(user, gender);
      await logTelemetryEvent(req, {
        eventType: "card_run",
        path: "/cards",
        gender,
        season: Number(r.season ?? 0) || null,
        team: String(r.team ?? ""),
        player: String(r.player ?? ""),
        source: "job_start",
      });
      await logUsageEvent({
        organizationId: user.organization_id,
        userId: user.id,
        eventType: "card_build",
        email: user.email,
        gender,
        season: Number(r.season ?? 0) || null,
        team: String(r.team ?? ""),
        player: String(r.player ?? ""),
        path: "/cards",
        source: "job_start",
      });
    }
    const id = await createJob(body.jobType, body.request);
    const job = await loadJob(id);
    return NextResponse.json({ ok: true, id, job });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN_SCOPE" || message === "FORBIDDEN"
          ? 403
          : message === "ACCOUNT_EXPIRED"
            ? 403
            : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status },
    );
  }
}
