import { Pool } from "pg";
import { resolveDatabaseUrl } from "@/lib/env";

type DbQueryResult = { rows: unknown[] };
type DbPool = { query: (text: string, params?: unknown[]) => Promise<DbQueryResult> };

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
      max: 5,
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
