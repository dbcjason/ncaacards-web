import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { advanceJobIfNeeded, loadJob } from "@/lib/jobs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const job = await loadJob(id);
    if (!job) return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
    const advanced = await advanceJobIfNeeded(job);
    return NextResponse.json({ ok: true, job: advanced });
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
