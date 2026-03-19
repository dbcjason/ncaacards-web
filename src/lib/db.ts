import { Pool } from "pg";

type DbQueryResult = { rows: unknown[] };
type DbPool = { query: (text: string, params?: unknown[]) => Promise<DbQueryResult> };

let pool: DbPool | null = null;

function resolveDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    "";
  return String(url).trim();
}

function getPool(): DbPool {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set (or POSTGRES_URL)");
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
