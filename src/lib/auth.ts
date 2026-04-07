import "server-only";

import { cookies, headers } from "next/headers";
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { dbQuery, dbQueryOne, withDbTransaction } from "@/lib/db";

export const SESSION_COOKIE_NAME = "dbcjason_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type AccessScope = "men" | "women" | "both";
export type UserRole = "admin" | "member";
export type AccountType = "paid" | "free" | "trial" | "expired";
export type UsageEventType = "login" | "logout" | "card_build" | "transfer_search";
export type GenderScope = "men" | "women";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  access_scope: AccessScope;
  status: string;
  expires_at: string | null;
  organization_id: string;
  organization_name: string;
  organization_access_scope: AccessScope;
  organization_account_type: AccountType;
  organization_status: string;
  favorite_team: string | null;
  favorite_conference: string | null;
  organization_favorite_team: string | null;
  organization_favorite_conference: string | null;
  effective_favorite_team: string | null;
  effective_favorite_conference: string | null;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split(":");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const actual = Buffer.from(hashHex, "hex");
  const expected = scryptSync(password, salt, actual.length);
  return timingSafeEqual(expected, actual);
}

export function normalizeAccessScope(raw: string): AccessScope {
  if (raw === "men" || raw === "women" || raw === "both") return raw;
  return "both";
}

export function normalizeAccountType(raw: string): AccountType {
  if (raw === "paid" || raw === "free" || raw === "trial" || raw === "expired") return raw;
  return "paid";
}

export function canAccessGenderScope(accessScope: AccessScope, gender: GenderScope): boolean {
  return accessScope === "both" || accessScope === gender;
}

export function assertGenderAccess(user: AuthUser, gender: GenderScope): void {
  if (!canAccessGenderScope(user.access_scope, gender) || !canAccessGenderScope(user.organization_access_scope, gender)) {
    throw new Error("FORBIDDEN_SCOPE");
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowPlus(ms: number): Date {
  return new Date(Date.now() + ms);
}

function geoFromHeaders(h: Headers): { country: string | null; region: string | null; city: string | null } {
  const get = (key: string) => {
    const value = String(h.get(key) ?? "").trim();
    return value ? value.slice(0, 120) : null;
  };
  return {
    country: get("x-vercel-ip-country"),
    region: get("x-vercel-ip-country-region"),
    city: get("x-vercel-ip-city"),
  };
}

async function setSessionCookie(rawToken: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);
  // Clean up legacy domain-scoped variants from previous deployments.
  jar.delete({ name: SESSION_COOKIE_NAME, path: "/", domain: ".dbcjason.com" });
  jar.delete({ name: SESSION_COOKIE_NAME, path: "/", domain: "dbcjason.com" });
}

export async function createSessionForUser(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = nowPlus(SESSION_TTL_MS);
  const h = await headers();
  const geo = geoFromHeaders(h);
  await withDbTransaction(async (client) => {
    await client.query(
      `insert into public.user_sessions
        (user_id, token_hash, expires_at, ip_address, country, region, city, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId,
        tokenHash,
        expiresAt.toISOString(),
        String(h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
        geo.country,
        geo.region,
        geo.city,
        String(h.get("user-agent") ?? "").trim().slice(0, 500) || null,
      ],
    );
    await client.query(
      `update public.app_users
         set last_login_at = now(), updated_at = now()
       where id = $1`,
      [userId],
    );
  });
  await setSessionCookie(rawToken, expiresAt);
  return { token: rawToken, expiresAt };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const jar = await cookies();
    const tokenCandidates = new Set<string>();
    const primary = jar.get(SESSION_COOKIE_NAME)?.value?.trim() || "";
    if (primary) tokenCandidates.add(primary);

    // If multiple cookies with the same name are present (legacy domain + host-only),
    // try each value and accept whichever maps to a live DB session.
    for (const cookie of jar.getAll(SESSION_COOKIE_NAME)) {
      const value = String(cookie?.value ?? "").trim();
      if (value) tokenCandidates.add(value);
    }

    const tokenHashes = Array.from(tokenCandidates)
      .map((token) => token.trim())
      .filter((token) => /^[a-f0-9]{64}$/i.test(token))
      .map((token) => sha256(token));
    if (!tokenHashes.length) return null;

    const user = await dbQueryOne<AuthUser>(
      `select
          u.id,
          u.email,
          u.role,
          u.access_scope,
          u.status,
          u.expires_at,
          u.organization_id,
          o.name as organization_name,
          o.access_scope as organization_access_scope,
          o.account_type as organization_account_type,
          o.status as organization_status,
          nullif(trim(u.favorite_team), '') as favorite_team,
          nullif(trim(u.favorite_conference), '') as favorite_conference,
          nullif(trim(o.favorite_team), '') as organization_favorite_team,
          nullif(trim(o.favorite_conference), '') as organization_favorite_conference,
          coalesce(nullif(trim(u.favorite_team), ''), nullif(trim(o.favorite_team), '')) as effective_favorite_team,
          coalesce(nullif(trim(u.favorite_conference), ''), nullif(trim(o.favorite_conference), '')) as effective_favorite_conference
        from public.user_sessions s
        join public.app_users u on u.id = s.user_id
        join public.organizations o on o.id = u.organization_id
        where s.token_hash = any($1::text[])
          and s.expires_at > now()
          and u.status = 'active'
          and o.status = 'active'
        order by s.created_at desc
        limit 1`,
      [tokenHashes],
    );
    return user;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Dynamic server usage")) {
      console.error("[auth] getCurrentUser failed", error);
    }
    return null;
  }
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  if (user.expires_at && new Date(user.expires_at).getTime() < Date.now()) {
    throw new Error("ACCOUNT_EXPIRED");
  }
  return user;
}

export async function requireAdminUser(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return user;
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const user = await dbQueryOne<{
    id: string;
    email: string;
    password_hash: string;
    role: UserRole;
    access_scope: AccessScope;
    status: string;
    expires_at: string | null;
    organization_id: string;
    organization_name: string;
    organization_access_scope: AccessScope;
    organization_account_type: AccountType;
    organization_status: string;
    favorite_team: string | null;
    favorite_conference: string | null;
    organization_favorite_team: string | null;
    organization_favorite_conference: string | null;
    effective_favorite_team: string | null;
    effective_favorite_conference: string | null;
  }>(
    `select
        u.id,
        u.email,
        u.password_hash,
        u.role,
        u.access_scope,
        u.status,
        u.expires_at,
        u.organization_id,
        o.name as organization_name,
        o.access_scope as organization_access_scope,
        o.account_type as organization_account_type,
        o.status as organization_status,
        nullif(trim(u.favorite_team), '') as favorite_team,
        nullif(trim(u.favorite_conference), '') as favorite_conference,
        nullif(trim(o.favorite_team), '') as organization_favorite_team,
        nullif(trim(o.favorite_conference), '') as organization_favorite_conference,
        coalesce(nullif(trim(u.favorite_team), ''), nullif(trim(o.favorite_team), '')) as effective_favorite_team,
        coalesce(nullif(trim(u.favorite_conference), ''), nullif(trim(o.favorite_conference), '')) as effective_favorite_conference
      from public.app_users u
      join public.organizations o on o.id = u.organization_id
      where lower(u.email) = $1
      limit 1`,
    [cleanEmail(email)],
  );
  if (!user) return null;
  if (user.status !== "active" || user.organization_status !== "active") return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  const { password_hash: _omit, ...safeUser } = user;
  return safeUser as AuthUser;
}

export async function findAccessCode(code: string) {
  return dbQueryOne<{
    id: string;
    organization_id: string;
    code: string;
    account_type: AccountType;
    access_scope: AccessScope;
    status: string;
    requires_payment: boolean;
    max_uses: number;
    used_count: number;
    expires_at: string | null;
    organization_name: string;
    organization_status: string;
  }>(
    `select
        ac.id,
        ac.organization_id,
        ac.code,
        ac.account_type,
        ac.access_scope,
        ac.status,
        ac.requires_payment,
        ac.max_uses,
        ac.used_count,
        ac.expires_at,
        o.name as organization_name,
        o.status as organization_status
      from public.access_codes ac
      join public.organizations o on o.id = ac.organization_id
      where ac.code = $1
      limit 1`,
    [code.trim()],
  );
}

export async function createUserFromAccessCode(params: {
  email: string;
  password: string;
  accessCode: string;
  paymentConfirmed?: boolean;
  passwordHash?: string;
}): Promise<{ userId: string; requiresPayment?: boolean; organizationName: string }> {
  const email = cleanEmail(params.email);
  const accessCode = params.accessCode.trim();
  return withDbTransaction(async (client) => {
    const existing = await client.query(`select id from public.app_users where lower(email) = $1 limit 1`, [email]);
    if (existing.rowCount) {
      throw new Error("An account with that email already exists.");
    }

    const codeResult = await client.query(
      `select
          ac.id,
          ac.organization_id,
          ac.account_type,
          ac.access_scope,
          ac.status,
          ac.requires_payment,
          ac.max_uses,
          ac.used_count,
          ac.expires_at,
          o.name as organization_name,
          o.status as organization_status,
          o.expires_at as organization_expires_at
        from public.access_codes ac
        join public.organizations o on o.id = ac.organization_id
        where ac.code = $1
        limit 1`,
      [accessCode],
    );
    const code = codeResult.rows[0] as {
      id: string;
      organization_id: string;
      account_type: AccountType;
      access_scope: AccessScope;
      status: string;
      requires_payment: boolean;
      max_uses: number;
      used_count: number;
      expires_at: string | null;
      organization_name: string;
      organization_status: string;
      organization_expires_at: string | null;
    } | undefined;
    if (!code) throw new Error("Invalid access code.");
    if (code.status !== "active" || code.organization_status !== "active") {
      throw new Error("That access code is not active.");
    }
    if (code.expires_at && new Date(code.expires_at).getTime() < Date.now()) {
      throw new Error("That access code has expired.");
    }
    if (Number(code.used_count) >= Number(code.max_uses)) {
      throw new Error("That access code has already been fully used.");
    }
    const needsPayment = Boolean(code.requires_payment) && code.account_type === "paid";
    if (needsPayment && !params.paymentConfirmed) {
      return {
        userId: "",
        requiresPayment: true,
        organizationName: String(code.organization_name),
      };
    }

    const passwordHash = params.passwordHash || hashPassword(params.password);
    const expiresAt = code.organization_expires_at ?? code.expires_at ?? null;
    const insert = await client.query(
      `insert into public.app_users
        (organization_id, email, password_hash, role, access_scope, status, expires_at, created_via_access_code_id)
       values ($1,$2,$3,'member',$4,'active',$5,$6)
       returning id`,
      [code.organization_id, email, passwordHash, code.access_scope, expiresAt, code.id],
    );
    const insertedRow = insert.rows[0] as { id: string } | undefined;
    await client.query(
      `update public.access_codes
         set used_count = used_count + 1,
             status = case when used_count + 1 >= max_uses then 'expired' else status end,
             updated_at = now()
       where id = $1`,
      [code.id],
    );
    return {
      userId: String(insertedRow?.id || ""),
      organizationName: String(code.organization_name),
    };
  });
}

export async function createOrganizationAccount(params: {
  organizationName: string;
  accountType: AccountType;
  accessScope: AccessScope;
  requiresPayment: boolean;
  favoriteTeam?: string | null;
  favoriteConference?: string | null;
  notes?: string;
  contractStartsAt?: string | null;
  contractEndsAt?: string | null;
  expiresAt?: string | null;
}): Promise<{ id: string; name: string }> {
  return withDbTransaction(async (client) => {
    const insert = await client.query(
      `insert into public.organizations
        (name, account_type, access_scope, status, requires_payment, favorite_team, favorite_conference, notes, contract_starts_at, contract_ends_at, expires_at)
       values ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10)
       on conflict (name) do update
         set account_type = excluded.account_type,
             access_scope = excluded.access_scope,
             status = 'active',
             requires_payment = excluded.requires_payment,
             favorite_team = excluded.favorite_team,
             favorite_conference = excluded.favorite_conference,
             notes = excluded.notes,
             contract_starts_at = excluded.contract_starts_at,
             contract_ends_at = excluded.contract_ends_at,
             expires_at = excluded.expires_at,
             updated_at = now()
       returning id, name`,
      [
        params.organizationName.trim(),
        params.accountType,
        params.accessScope,
        params.requiresPayment,
        params.favoriteTeam?.trim() || null,
        params.favoriteConference?.trim() || null,
        params.notes?.trim() || null,
        params.contractStartsAt || null,
        params.contractEndsAt || null,
        params.expiresAt || null,
      ],
    );
    const row = insert.rows[0] as { id: string; name: string } | undefined;
    return { id: String(row?.id || ""), name: String(row?.name || "") };
  });
}

export async function createAccessCode(params: {
  organizationId: string;
  code: string;
  accountType: AccountType;
  accessScope: AccessScope;
  requiresPayment: boolean;
  maxUses: number;
  expiresAt?: string | null;
}): Promise<{ id: string; code: string }> {
  return withDbTransaction(async (client) => {
    const code = params.code.trim();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("Access codes must be exactly 6 digits.");
    }
    const insert = await client.query(
      `insert into public.access_codes
        (organization_id, code, account_type, access_scope, status, requires_payment, max_uses, expires_at)
       values ($1,$2,$3,$4,'active',$5,$6,$7)
       returning id, code`,
      [
        params.organizationId,
        code,
        params.accountType,
        params.accessScope,
        params.requiresPayment,
        Math.max(1, params.maxUses),
        params.expiresAt || null,
      ],
    );
    const row = insert.rows[0] as { id: string; code: string } | undefined;
    return { id: String(row?.id || ""), code: String(row?.code || "") };
  });
}

export async function createFreeUser(params: {
  organizationId: string;
  email: string;
  password: string;
  accessScope: AccessScope;
  favoriteTeam?: string | null;
  favoriteConference?: string | null;
  expiresAt?: string | null;
}): Promise<{ id: string }> {
  return withDbTransaction(async (client) => {
    const email = cleanEmail(params.email);
    const existing = await client.query(`select id from public.app_users where lower(email) = $1 limit 1`, [email]);
    if (existing.rowCount) throw new Error("That email is already in use.");
    const insert = await client.query(
      `insert into public.app_users
        (organization_id, email, password_hash, role, access_scope, status, favorite_team, favorite_conference, expires_at)
       values ($1,$2,$3,'member',$4,'active',$5,$6,$7)
       returning id`,
      [
        params.organizationId,
        email,
        hashPassword(params.password),
        params.accessScope,
        params.favoriteTeam?.trim() || null,
        params.favoriteConference?.trim() || null,
        params.expiresAt || null,
      ],
    );
    return { id: String((insert.rows[0] as { id: string } | undefined)?.id || "") };
  });
}

export async function resolveFavoriteConference(team: string): Promise<string> {
  const trimmed = String(team || "").trim();
  if (!trimmed) return "SEC";

  const leaderboardMatch = await dbQueryOne<{ conference: string | null }>(
    `select nullif(trim(conference), '') as conference
       from public.leaderboard_player_stats
      where lower(team) = lower($1)
        and nullif(trim(conference), '') is not null
      order by season desc, updated_at desc
      limit 1`,
    [trimmed],
  );
  if (leaderboardMatch?.conference) return String(leaderboardMatch.conference);

  const payloadMatch = await dbQueryOne<{ conference: string | null }>(
    `select nullif(trim(payload_json -> 'bio' ->> 'conference'), '') as conference
       from public.player_payload_index
      where lower(team) = lower($1)
        and nullif(trim(payload_json -> 'bio' ->> 'conference'), '') is not null
      order by season desc, updated_at desc nulls last
      limit 1`,
    [trimmed],
  );
  return payloadMatch?.conference ? String(payloadMatch.conference) : "SEC";
}

export async function updateUserFavoriteTeam(userId: string, favoriteTeam?: string | null) {
  const team = String(favoriteTeam || "").trim();
  const conference = team ? await resolveFavoriteConference(team) : null;
  await dbQueryOne(
    `update public.app_users
        set favorite_team = $2,
            favorite_conference = $3,
            updated_at = now()
      where id = $1
      returning id`,
    [userId, team || null, conference],
  );
  return { favoriteTeam: team || null, favoriteConference: conference };
}

export async function updateOrganizationFavoriteTeam(organizationId: string, favoriteTeam?: string | null) {
  const team = String(favoriteTeam || "").trim();
  const conference = team ? await resolveFavoriteConference(team) : null;
  await dbQueryOne(
    `update public.organizations
        set favorite_team = $2,
            favorite_conference = $3,
            updated_at = now()
      where id = $1
      returning id`,
    [organizationId, team || null, conference],
  );
  return { favoriteTeam: team || null, favoriteConference: conference };
}

export async function listAllKnownTeams(): Promise<string[]> {
  const rows = await dbQuery<{ team: string }>(
    `select team
       from (
         select distinct team from public.leaderboard_player_stats
         union
         select distinct team from public.player_payload_index
       ) teams
      where nullif(trim(team), '') is not null
      order by lower(team) asc`,
  );
  return rows.map((row) => String(row.team || "").trim()).filter(Boolean);
}

export async function logUsageEvent(event: {
  organizationId: string;
  userId?: string | null;
  eventType: UsageEventType;
  email?: string | null;
  gender?: string | null;
  season?: number | null;
  team?: string | null;
  player?: string | null;
  queryText?: string | null;
  path?: string | null;
  source?: string | null;
}) {
  const h = await headers();
  const geo = geoFromHeaders(h);
  await withDbTransaction(async (client) => {
    await client.query(
      `insert into public.usage_events
        (organization_id, user_id, event_type, email, gender, season, team, player, query_text, path, source, ip_address, country, region, city, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        event.organizationId,
        event.userId || null,
        event.eventType,
        event.email || null,
        event.gender || null,
        event.season ?? null,
        event.team || null,
        event.player || null,
        event.queryText || null,
        event.path || null,
        event.source || null,
        String(h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
        geo.country,
        geo.region,
        geo.city,
        String(h.get("user-agent") ?? "").trim().slice(0, 500) || null,
      ],
    );
  });
}

export async function createBillingRecord(params: {
  organizationId: string;
  provider?: "manual" | "stripe";
  status?: "not_required" | "pending" | "paid" | "past_due" | "cancelled" | "refunded";
  amountCents?: number | null;
  currency?: string | null;
  billingInterval?: string | null;
  currentPeriodEnd?: string | null;
  notes?: string | null;
}) {
  return withDbTransaction(async (client) => {
    const result = await client.query(
      `insert into public.billing_records
        (organization_id, provider, status, amount_cents, currency, billing_interval, current_period_end, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id`,
      [
        params.organizationId,
        params.provider || "manual",
        params.status || "pending",
        params.amountCents ?? null,
        params.currency || "usd",
        params.billingInterval || null,
        params.currentPeriodEnd || null,
        params.notes || null,
      ],
    );
    return String((result.rows[0] as { id: string } | undefined)?.id || "");
  });
}

export async function generateUniqueAccessCode(length = 6): Promise<string> {
  if (length !== 6) {
    throw new Error("Access codes must be 6 digits.");
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const existing = await findAccessCode(code);
    if (!existing) return code;
  }
  throw new Error("Unable to generate a unique access code. Please try again.");
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (rawToken) {
    await withDbTransaction(async (client) => {
      await client.query(`delete from public.user_sessions where token_hash = $1`, [sha256(rawToken)]);
    });
  }
  await clearSessionCookie();
}

export async function insertAdminUser(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, params: {
  organizationId: string;
  email: string;
  password: string;
  accessScope: AccessScope;
  expiresAt?: string | null;
}) {
  const result = await client.query(
    `insert into public.app_users
      (organization_id, email, password_hash, role, access_scope, status, expires_at)
     values ($1,$2,$3,'admin',$4,'active',$5)
     on conflict (email) do update
       set password_hash = excluded.password_hash,
           role = 'admin',
           access_scope = excluded.access_scope,
           organization_id = excluded.organization_id,
           expires_at = excluded.expires_at,
           status = 'active',
           updated_at = now()
     returning id`,
    [params.organizationId, cleanEmail(params.email), hashPassword(params.password), params.accessScope, params.expiresAt || null],
  );
  return String((result.rows[0] as { id: string } | undefined)?.id || "");
}
