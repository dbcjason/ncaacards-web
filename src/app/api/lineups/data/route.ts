import { NextRequest, NextResponse } from "next/server";
import { canAccessGenderScope, requireUser } from "@/lib/auth";
import { parseLineupGender, queryLineupOptionData } from "@/lib/lineup-analysis-db";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      gender?: string;
      season?: number | string;
      key?: string;
    };
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

    const option = await queryLineupOptionData({
      gender,
      season,
      key: body.key,
    });
    if (!option) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, option });
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
