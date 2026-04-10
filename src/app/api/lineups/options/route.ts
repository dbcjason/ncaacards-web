import { NextRequest, NextResponse } from "next/server";
import { canAccessGenderScope, requireUser } from "@/lib/auth";
import { parseLineupGender, queryLineupOptions } from "@/lib/lineup-analysis-db";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { gender?: string; season?: number | string };
    const gender = parseLineupGender(body.gender);
    if (
      !canAccessGenderScope(user.access_scope, gender) ||
      !canAccessGenderScope(user.organization_access_scope, gender)
    ) {
      throw new Error("FORBIDDEN_SCOPE");
    }

    const seasonRaw = body.season;
    const season =
      seasonRaw === null || seasonRaw === undefined || String(seasonRaw).trim() === ""
        ? 2026
        : Number.isFinite(Number(seasonRaw))
          ? Number(seasonRaw)
          : 2026;

    const options = await queryLineupOptions({ gender, season });
    return NextResponse.json({ ok: true, options });
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
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
