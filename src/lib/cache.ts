type Json = Record<string, unknown>;

const REDIS_URL = process.env.REDIS_URL ?? "";
const REDIS_TOKEN = process.env.REDIS_TOKEN ?? "";

function ready() {
  const url = REDIS_URL.trim();
  const token = REDIS_TOKEN.trim();
  if (!url || !token) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  const lowerToken = token.toLowerCase();
  if (lowerToken === "placeholder" || lowerToken === "changeme") return false;
  if (/placeholder/i.test(url)) return false;
  return true;
}

export async function cacheGet<T = Json>(key: string): Promise<T | null> {
  if (!ready()) return null;
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: T | null };
    return body?.result ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, exSeconds = 3600): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value, ex: exSeconds }),
      cache: "no-store",
    });
  } catch {
    // Cache write failures should never break the request path.
  }
}
