import { Pool } from "pg";
import { resolveDatabaseUrl } from "@/lib/env";

type DbQueryResult = { rows: unknown[]; rowCount?: number };
type DbClient = { query: (text: string, params?: unknown[]) => Promise<DbQueryResult>; release: () => void };
type DbPool = { query: (text: string, params?: unknown[]) => Promise<DbQueryResult>; connect?: () => Promise<DbClient> };

let pool: DbPool | null = null;

function getPool(): DbPool {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    throw new Error(
      "Database connection string is not set. Expected SUPABASE_DB_URL, DIRECT_DATABASE_URL, DATABASE_URL, or POSTGRES_URL.",
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      // Supabase shared pooler in session mode has a low client cap.
      // Keep this tiny per server instance to avoid EMAXCONNSESSION spikes.
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool as DbPool;
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  const res = await p.query(text, params);
  return res.rows as T[];
}

export async function dbQueryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await dbQuery<T>(text, params);
  return rows[0] ?? null;
}

export async function withDbClient<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const p = getPool();
  if (typeof p.connect !== "function") {
    throw new Error("Database transaction support is unavailable.");
  }
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withDbTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withDbClient(async (client) => {
    await client.query("begin");
    try {
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}
