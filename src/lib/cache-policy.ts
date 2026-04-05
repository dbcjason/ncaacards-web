function easternParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function cacheVersionTag(): string {
  return String(
    process.env.CARD_CACHE_VERSION ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      "dev",
  )
    .trim()
    .slice(0, 40);
}

export function isSeasonCacheable(season: number, now = new Date()): boolean {
  if (!Number.isInteger(season) || season < 1900) return false;
  const { year, month, day } = easternParts(now);

  if (season < year) return true;
  if (season > year) return false;

  if (month > 4) return true;
  if (month < 4) return false;
  return day >= 6;
}
