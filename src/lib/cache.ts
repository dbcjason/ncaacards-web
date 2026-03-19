type Json = Record<string, unknown>;

const REDIS_URL = process.env.REDIS_URL ?? "";
const REDIS_TOKEN = process.env.REDIS_TOKEN ?? "";

function ready() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

export async function cacheGet<T = Json>(key: string): Promise<T | null> {
  if (!ready()) return null;
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: T | null };
  return body?.result ?? null;
}

export async function cacheSet(key: string, value: unknown, exSeconds = 3600): Promise<void> {
  if (!ready()) return;
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value, ex: exSeconds }),
    cache: "no-store",
  });
}

