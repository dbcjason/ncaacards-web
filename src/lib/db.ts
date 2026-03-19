import { Pool } from "pg";

type DbQueryResult = { rows: unknown[] };
type DbPool = { query: (text: string, params?: unknown[]) => Promise<DbQueryResult> };

let pool: DbPool | null = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  const res = await p.query(text, params);
  return res.rows;
}
