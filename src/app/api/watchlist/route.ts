import { NextRequest, NextResponse } from "next/server";
import { assertGenderAccess, requireUser } from "@/lib/auth";
import { dbQuery, withDbTransaction } from "@/lib/db";
import { fetchWatchlistStats, parseLeaderboardGender } from "@/lib/leaderboard";

type WatchlistSummary = {
  id: string;
  name: string;
  sort_order: number;
  item_count: number;
};

type WatchlistContext = {
  watchlists: WatchlistSummary[];
  activeListId: string;
};

function parseSeason(raw: string | null, fallback = 2026): number {
  const season = Number(raw ?? fallback);
  return Number.isFinite(season) ? season : fallback;
}

function sanitizeListName(raw: unknown) {
  return String(raw ?? "").trim().slice(0, 60);
}

async function getOrCreateWatchlists(params: {
  userId: string;
  gender: "men" | "women";
  season: number;
}) {
  const rows = await dbQuery<WatchlistSummary>(
    `select
        w.id,
        w.name,
        w.sort_order,
        count(i.id)::int as item_count
      from public.watchlists w
      left join public.watchlist_items i
        on i.watchlist_id = w.id
      where w.user_id = $1
        and w.gender = $2
        and w.season = $3
      group by w.id, w.name, w.sort_order
      order by w.sort_order asc, w.created_at asc`,
    [params.userId, params.gender, params.season],
  );

  if (rows.length) return rows;

  await dbQuery(
    `insert into public.watchlists (user_id, gender, season, name, sort_order, updated_at)
     values ($1, $2, $3, 'My Watchlist', 0, now())`,
    [params.userId, params.gender, params.season],
  );

  return dbQuery<WatchlistSummary>(
    `select
        w.id,
        w.name,
        w.sort_order,
        count(i.id)::int as item_count
      from public.watchlists w
      left join public.watchlist_items i
        on i.watchlist_id = w.id
      where w.user_id = $1
        and w.gender = $2
        and w.season = $3
      group by w.id, w.name, w.sort_order
      order by w.sort_order asc, w.created_at asc`,
    [params.userId, params.gender, params.season],
  );
}

async function loadWatchlistContext(params: {
  userId: string;
  gender: "men" | "women";
  season: number;
  requestedListId?: string;
}): Promise<WatchlistContext> {
  const watchlists = await getOrCreateWatchlists({
    userId: params.userId,
    gender: params.gender,
    season: params.season,
  });

  const requestedListId = String(params.requestedListId ?? "").trim();
  const active = watchlists.find((row) => row.id === requestedListId) ?? watchlists[0];
  return {
    watchlists,
    activeListId: active.id,
  };
}

async function loadWatchlistPayload(params: {
  userId: string;
  gender: "men" | "women";
  season: number;
  requestedListId?: string;
}) {
  const context = await loadWatchlistContext(params);
  const items = await fetchWatchlistStats({
    userId: params.userId,
    gender: params.gender,
    season: params.season,
    listId: context.activeListId,
  });
  return {
    ...context,
    items,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const gender = parseLeaderboardGender(req.nextUrl.searchParams.get("gender") ?? "men");
    const season = parseSeason(req.nextUrl.searchParams.get("season"));
    const listId = String(req.nextUrl.searchParams.get("listId") ?? "").trim();
    assertGenderAccess(user, gender);
    const payload = await loadWatchlistPayload({
      userId: user.id,
      gender,
      season,
      requestedListId: listId,
    });
    return NextResponse.json({ ok: true, ...payload });
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
      action?: "createList" | "renameList" | "addItem";
      gender?: string;
      season?: number | string;
      listId?: string;
      name?: string;
      team?: string;
      player?: string;
    };
    const gender = parseLeaderboardGender(body.gender);
    const season = parseSeason(String(body.season ?? "2026"));
    assertGenderAccess(user, gender);

    const action = body.action ?? "addItem";

    if (action === "createList") {
      const name = sanitizeListName(body.name);
      if (!name) {
        return NextResponse.json({ ok: false, error: "List name is required" }, { status: 400 });
      }

      const createdListId = await withDbTransaction(async (client) => {
        const maxRow = await client.query<{ max_sort_order: number | null }>(
          `select max(sort_order) as max_sort_order
           from public.watchlists
           where user_id = $1 and gender = $2 and season = $3`,
          [user.id, gender, season],
        );
        const sortOrder = Number(maxRow.rows[0]?.max_sort_order ?? -1) + 1;
        const inserted = await client.query<{ id: string }>(
          `insert into public.watchlists (user_id, gender, season, name, sort_order, updated_at)
           values ($1, $2, $3, $4, $5, now())
           returning id`,
          [user.id, gender, season, name, sortOrder],
        );
        return String(inserted.rows[0]?.id ?? "");
      });

      const payload = await loadWatchlistPayload({
        userId: user.id,
        gender,
        season,
        requestedListId: createdListId,
      });
      return NextResponse.json({ ok: true, ...payload });
    }

    if (action === "renameList") {
      const listId = String(body.listId ?? "").trim();
      const name = sanitizeListName(body.name);
      if (!listId) {
        return NextResponse.json({ ok: false, error: "Missing listId" }, { status: 400 });
      }
      if (!name) {
        return NextResponse.json({ ok: false, error: "List name is required" }, { status: 400 });
      }

      const updated = await dbQuery<{ id: string }>(
        `update public.watchlists
            set name = $1,
                updated_at = now()
          where id = $2
            and user_id = $3
            and gender = $4
            and season = $5
          returning id`,
        [name, listId, user.id, gender, season],
      );
      if (!updated.length) {
        return NextResponse.json({ ok: false, error: "Watchlist not found" }, { status: 404 });
      }

      const payload = await loadWatchlistPayload({
        userId: user.id,
        gender,
        season,
        requestedListId: listId,
      });
      return NextResponse.json({ ok: true, ...payload });
    }

    const team = String(body.team ?? "").trim();
    const player = String(body.player ?? "").trim();
    if (!team || !player) {
      return NextResponse.json({ ok: false, error: "Missing team/player" }, { status: 400 });
    }

    const context = await loadWatchlistContext({
      userId: user.id,
      gender,
      season,
      requestedListId: String(body.listId ?? "").trim(),
    });
    const listId = context.activeListId;

    const maxRow = await dbQuery<{ max_sort_order: number | null }>(
      `select max(sort_order) as max_sort_order
       from public.watchlist_items
       where watchlist_id = $1`,
      [listId],
    );
    const sortOrder = Number(maxRow[0]?.max_sort_order ?? -1) + 1;

    await dbQuery(
      `insert into public.watchlist_items (watchlist_id, user_id, gender, season, team, player, sort_order, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,now())
       on conflict (watchlist_id, team, player)
       do update set updated_at = now()`,
      [listId, user.id, gender, season, team, player, sortOrder],
    );

    const payload = await loadWatchlistPayload({
      userId: user.id,
      gender,
      season,
      requestedListId: listId,
    });
    return NextResponse.json({ ok: true, ...payload });
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
      listId?: string;
      orderedIds?: string[];
    };
    const gender = parseLeaderboardGender(body.gender);
    const season = parseSeason(String(body.season ?? "2026"));
    assertGenderAccess(user, gender);
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String).filter(Boolean) : [];

    const context = await loadWatchlistContext({
      userId: user.id,
      gender,
      season,
      requestedListId: String(body.listId ?? "").trim(),
    });

    await withDbTransaction(async (client) => {
      for (const [index, id] of orderedIds.entries()) {
        await client.query(
          `update public.watchlist_items
              set sort_order = $1, updated_at = now()
            where id = $2
              and watchlist_id = $3
              and user_id = $4
              and gender = $5
              and season = $6`,
          [index, id, context.activeListId, user.id, gender, season],
        );
      }
    });

    const payload = await loadWatchlistPayload({
      userId: user.id,
      gender,
      season,
      requestedListId: context.activeListId,
    });
    return NextResponse.json({ ok: true, ...payload });
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
    const listId = String(req.nextUrl.searchParams.get("listId") ?? "").trim();
    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    assertGenderAccess(user, gender);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const context = await loadWatchlistContext({
      userId: user.id,
      gender,
      season,
      requestedListId: listId,
    });

    await dbQuery(
      `delete from public.watchlist_items
       where id = $1
         and watchlist_id = $2
         and user_id = $3
         and gender = $4
         and season = $5`,
      [id, context.activeListId, user.id, gender, season],
    );

    const payload = await loadWatchlistPayload({
      userId: user.id,
      gender,
      season,
      requestedListId: context.activeListId,
    });
    return NextResponse.json({ ok: true, ...payload });
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
