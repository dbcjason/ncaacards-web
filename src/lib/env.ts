type R2RuntimeConfig = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  inlineLimitBytes: number;
};

function trimEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function resolveDatabaseUrl(): string {
  const url =
    process.env.SUPABASE_DB_URL ||
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    "";
  return String(url).trim();
}

export function hasDatabaseConfig(): boolean {
  return Boolean(resolveDatabaseUrl());
}

export function getR2Config(): R2RuntimeConfig {
  const raw = Number(trimEnv("R2_PAYLOAD_INLINE_LIMIT_BYTES") || "262144");
  return {
    accountId: trimEnv("R2_ACCOUNT_ID"),
    bucket: trimEnv("R2_BUCKET"),
    accessKeyId: trimEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: trimEnv("R2_SECRET_ACCESS_KEY"),
    publicBaseUrl: trimEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, ""),
    inlineLimitBytes: Number.isFinite(raw) && raw > 0 ? raw : 262144,
  };
}

export function hasR2Config(): boolean {
  const cfg = getR2Config();
  return Boolean(cfg.accountId && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

export function hasRedisConfig(): boolean {
  const url = trimEnv("REDIS_URL");
  const token = trimEnv("REDIS_TOKEN");
  if (!url || !token) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  const lowerToken = token.toLowerCase();
  if (lowerToken === "placeholder" || lowerToken === "changeme") return false;
  if (/placeholder/i.test(url)) return false;
  return true;
}

export function publicRuntimeSummary() {
  const r2 = getR2Config();
  return {
    nodeEnv: process.env.NODE_ENV || "development",
    vercelEnv: process.env.VERCEL_ENV || "",
    databaseConfigured: hasDatabaseConfig(),
    redisConfigured: hasRedisConfig(),
    r2Configured: hasR2Config(),
    r2Bucket: r2.bucket || "",
    r2InlineLimitBytes: r2.inlineLimitBytes,
    supabaseUrlConfigured: Boolean(trimEnv("NEXT_PUBLIC_SUPABASE_URL")),
    supabasePublishableKeyConfigured: Boolean(trimEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")),
  };
}
