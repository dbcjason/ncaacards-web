import { NextRequest, NextResponse } from "next/server";
import { assertGenderAccess, requireUser } from "@/lib/auth";
import { dbQuery, withDbTransaction } from "@/lib/db";
import { fetchWatchlistStats, parseLeaderboardGender } from "@/lib/leaderboard";

function parseSeason(raw: string | null, fallback = 2026): number {
  const season = Number(raw ?? fallback);
  return Number.isFinite(season) ? season : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const gender = parseLeaderboardGender(req.nextUrl.searchParams.get("gender") ?? "men");
    const season = parseSeason(req.nextUrl.searchParams.get("season"));
    assertGenderAccess(user, gender);
    const items = await fetchWatchlistStats({ userId: user.id, gender, season });
    return NextResponse.json({ ok: true, items });
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

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      gender?: string;
      season?: number | string;
      team?: string;
      player?: string;
    };
    const gender = parseLeaderboardGender(body.gender);
    const season = parseSeason(String(body.season ?? "2026"));
    const team = String(body.team ?? "").trim();
    const player = String(body.player ?? "").trim();
    assertGenderAccess(user, gender);
    if (!team || !player) {
      return NextResponse.json({ ok: false, error: "Missing team/player" }, { status: 400 });
    }

    const maxRow = await dbQuery<{ max_sort_order: number | null }>(
      `select max(sort_order) as max_sort_order
       from public.watchlist_items
       where user_id = $1 and gender = $2 and season = $3`,
      [user.id, gender, season],
    );
    const sortOrder = Number(maxRow[0]?.max_sort_order ?? -1) + 1;

    await dbQuery(
      `insert into public.watchlist_items (user_id, gender, season, team, player, sort_order, updated_at)
       values ($1,$2,$3,$4,$5,$6,now())
       on conflict (user_id, gender, season, team, player)
       do update set updated_at = now()`,
      [user.id, gender, season, team, player, sortOrder],
    );

    const items = await fetchWatchlistStats({ userId: user.id, gender, season });
    return NextResponse.json({ ok: true, items });
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

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      gender?: string;
      season?: number | string;
      orderedIds?: string[];
    };
    const gender = parseLeaderboardGender(body.gender);
    const season = parseSeason(String(body.season ?? "2026"));
    assertGenderAccess(user, gender);
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String).filter(Boolean) : [];

    await withDbTransaction(async (client) => {
      for (const [index, id] of orderedIds.entries()) {
        await client.query(
          `update public.watchlist_items
              set sort_order = $1, updated_at = now()
            where id = $2
              and user_id = $3
              and gender = $4
              and season = $5`,
          [index, id, user.id, gender, season],
        );
      }
    });

    const items = await fetchWatchlistStats({ userId: user.id, gender, season });
    return NextResponse.json({ ok: true, items });
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

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const gender = parseLeaderboardGender(req.nextUrl.searchParams.get("gender") ?? "men");
    const season = parseSeason(req.nextUrl.searchParams.get("season"));
    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    assertGenderAccess(user, gender);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    await dbQuery(
      `delete from public.watchlist_items
       where id = $1 and user_id = $2 and gender = $3 and season = $4`,
      [id, user.id, gender, season],
    );
    const items = await fetchWatchlistStats({ userId: user.id, gender, season });
    return NextResponse.json({ ok: true, items });
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

