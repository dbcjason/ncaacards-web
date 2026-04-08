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

type SchemaMode = "multi" | "legacy";

const LEGACY_LIST_ID = "legacy-watchlist";
const SCHEMA_CACHE_TTL_MS = 60_000;
let schemaModeCache: { mode: SchemaMode; ts: number } | null = null;

function parseSeason(raw: string | null, fallback = 2026): number {
  const season = Number(raw ?? fallback);
  return Number.isFinite(season) ? season : fallback;
}

function sanitizeListName(raw: unknown) {
  return String(raw ?? "").trim().slice(0, 60);
}

async function resolveSchemaMode(): Promise<SchemaMode> {
  const now = Date.now();
  if (schemaModeCache && now - schemaModeCache.ts < SCHEMA_CACHE_TTL_MS) {
    return schemaModeCache.mode;
  }
  try {
    const rows = await dbQuery<{ has_watchlists: boolean; has_watchlist_id: boolean }>(
      `select
          exists(
            select 1
            from information_schema.tables
            where table_schema = 'public'
              and table_name = 'watchlists'
          ) as has_watchlists,
          exists(
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'watchlist_items'
              and column_name = 'watchlist_id'
          ) as has_watchlist_id`,
      [],
    );
    const mode: SchemaMode = rows[0]?.has_watchlists && rows[0]?.has_watchlist_id ? "multi" : "legacy";
    schemaModeCache = { mode, ts: now };
    return mode;
  } catch {
    schemaModeCache = { mode: "legacy", ts: now };
    return "legacy";
  }
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

async function loadLegacyWatchlistPayload(params: {
  userId: string;
  gender: "men" | "women";
  season: number;
}) {
  const items = await fetchWatchlistStats({
    userId: params.userId,
    gender: params.gender,
    season: params.season,
  });
  const watchlists: WatchlistSummary[] = [
    {
      id: LEGACY_LIST_ID,
      name: "Watchlist",
      sort_order: 0,
      item_count: items.length,
    },
  ];
  return {
    multiWatchlistsEnabled: false,
    watchlists,
    activeListId: LEGACY_LIST_ID,
    items,
  };
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
  const mode = await resolveSchemaMode();
  if (mode === "legacy") {
    return loadLegacyWatchlistPayload(params);
  }

  const context = await loadWatchlistContext(params);
  const items = await fetchWatchlistStats({
    userId: params.userId,
    gender: params.gender,
    season: params.season,
    listId: context.activeListId,
  });
  return {
    multiWatchlistsEnabled: true,
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
      action?: "createList" | "renameList" | "deleteList" | "addItem";
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

    const mode = await resolveSchemaMode();
    const action = body.action ?? "addItem";

    if (mode === "legacy" && (action === "createList" || action === "renameList" || action === "deleteList")) {
      const payload = await loadLegacyWatchlistPayload({ userId: user.id, gender, season });
      return NextResponse.json({
        ok: false,
        ...payload,
        error: "Multiple watchlists will activate after database migration runs.",
      }, { status: 409 });
    }

    if (action === "createList") {
      const name = sanitizeListName(body.name);
      if (!name) {
        return NextResponse.json({ ok: false, error: "List name is required" }, { status: 400 });
      }

      const createdListId = await withDbTransaction(async (client) => {
        const maxRow = await client.query(
          `select max(sort_order) as max_sort_order
           from public.watchlists
           where user_id = $1 and gender = $2 and season = $3`,
          [user.id, gender, season],
        );
        const maxRows = maxRow.rows as Array<{ max_sort_order: number | null }>;
        const sortOrder = Number(maxRows[0]?.max_sort_order ?? -1) + 1;
        const inserted = await client.query(
          `insert into public.watchlists (user_id, gender, season, name, sort_order, updated_at)
           values ($1, $2, $3, $4, $5, now())
           returning id`,
          [user.id, gender, season, name, sortOrder],
        );
        const insertedRows = inserted.rows as Array<{ id: string }>;
        return String(insertedRows[0]?.id ?? "");
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

    if (action === "deleteList") {
      const listId = String(body.listId ?? "").trim();
      if (!listId) {
        return NextResponse.json({ ok: false, error: "Missing listId" }, { status: 400 });
      }

      const nextActiveListId = await withDbTransaction(async (client) => {
        const deleted = await client.query(
          `delete from public.watchlists
            where id = $1
              and user_id = $2
              and gender = $3
              and season = $4
          returning id`,
          [listId, user.id, gender, season],
        );
        if (!deleted.rowCount) {
          throw new Error("Watchlist not found");
        }

        const remaining = await client.query(
          `select id
             from public.watchlists
            where user_id = $1
              and gender = $2
              and season = $3
            order by sort_order asc, created_at asc
            limit 1`,
          [user.id, gender, season],
        );
        const remainingRows = remaining.rows as Array<{ id: string }>;
        const firstRemaining = String(remainingRows[0]?.id ?? "");
        if (firstRemaining) return firstRemaining;

        const inserted = await client.query(
          `insert into public.watchlists (user_id, gender, season, name, sort_order, updated_at)
           values ($1, $2, $3, 'Watchlist', 0, now())
           returning id`,
          [user.id, gender, season],
        );
        const insertedRows = inserted.rows as Array<{ id: string }>;
        return String(insertedRows[0]?.id ?? "");
      });

      const payload = await loadWatchlistPayload({
        userId: user.id,
        gender,
        season,
        requestedListId: nextActiveListId,
      });
      return NextResponse.json({ ok: true, ...payload });
    }

    const team = String(body.team ?? "").trim();
    const player = String(body.player ?? "").trim();
    if (!team || !player) {
      return NextResponse.json({ ok: false, error: "Missing team/player" }, { status: 400 });
    }

    if (mode === "legacy") {
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

      const payload = await loadLegacyWatchlistPayload({ userId: user.id, gender, season });
      return NextResponse.json({ ok: true, ...payload });
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

    const mode = await resolveSchemaMode();

    if (mode === "legacy") {
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

      const payload = await loadLegacyWatchlistPayload({ userId: user.id, gender, season });
      return NextResponse.json({ ok: true, ...payload });
    }

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

    const mode = await resolveSchemaMode();

    if (mode === "legacy") {
      await dbQuery(
        `delete from public.watchlist_items
         where id = $1
           and user_id = $2
           and gender = $3
           and season = $4`,
        [id, user.id, gender, season],
      );
      const payload = await loadLegacyWatchlistPayload({ userId: user.id, gender, season });
      return NextResponse.json({ ok: true, ...payload });
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
