import pg from "pg";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const { Client } = pg;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function parseYears(spec) {
  const out = new Set();
  for (const part of String(spec || "").split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes("-")) {
      const [a, b] = p.split("-", 2).map(Number);
      const step = b >= a ? 1 : -1;
      for (let year = a; step > 0 ? year <= b : year >= b; year += step) out.add(year);
    } else {
      out.add(Number(p));
    }
  }
  return [...out].filter(Number.isFinite).sort((a, b) => a - b);
}

function genderConfig(gender) {
  if (gender === "women") {
    return {
      owner: env("GITHUB_DATA_OWNER_WOMEN", env("GITHUB_DATA_OWNER", "dbcjason")),
      repo: env("GITHUB_DATA_REPO_WOMEN", "NCAAWCards"),
      ref: env("GITHUB_DATA_REF_WOMEN", env("GITHUB_DATA_REF", "main")),
      token: env("GITHUB_TOKEN_WOMEN", env("GITHUB_TOKEN")),
      staticRoot: env("GITHUB_STATIC_PAYLOAD_ROOT_WOMEN", env("GITHUB_STATIC_PAYLOAD_ROOT", "player_cards_pipeline/public/cards")),
    };
  }
  return {
    owner: env("GITHUB_DATA_OWNER", "dbcjason"),
    repo: env("GITHUB_DATA_REPO", "NCAACards"),
    ref: env("GITHUB_DATA_REF", "main"),
    token: env("GITHUB_TOKEN"),
    staticRoot: env("GITHUB_STATIC_PAYLOAD_ROOT", "player_cards_pipeline/public/cards"),
  };
}

function payloadPrimaryStorage() {
  const raw = env("PAYLOAD_PRIMARY_STORAGE", "github").toLowerCase();
  if (raw === "r2" || raw === "supabase") return raw;
  return "github";
}

function getR2Config() {
  return {
    accountId: env("R2_ACCOUNT_ID"),
    bucket: env("R2_BUCKET"),
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    publicBaseUrl: env("R2_PUBLIC_BASE_URL").replace(/\/+$/, ""),
  };
}

function hasR2Config() {
  const cfg = getR2Config();
  return Boolean(cfg.accountId && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

let r2Client = null;
function getR2Client() {
  const cfg = getR2Config();
  if (!hasR2Config()) throw new Error("R2 config missing");
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return { client: r2Client, cfg };
}

async function fetchRepoJson(path, cfg) {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.ref)}`;
  const headers = { Accept: "application/vnd.github+json" };
  if (cfg.token) {
    headers.Authorization = `Bearer ${cfg.token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  const res = await fetch(apiUrl, { headers, cache: "no-store" });
  if (res.ok) {
    const body = await res.json();
    if (body?.content && body.encoding === "base64") {
      return JSON.parse(Buffer.from(body.content, "base64").toString("utf-8"));
    }
    if (body?.download_url) {
      const rawRes = await fetch(body.download_url, { cache: "no-store" });
      if (!rawRes.ok) throw new Error(`Raw GitHub download failed (${rawRes.status})`);
      return await rawRes.json();
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.ref}/${path}`;
  const rawRes = await fetch(rawUrl, { cache: "no-store" });
  if (!rawRes.ok) throw new Error(`GitHub raw fetch failed (${rawRes.status}) for ${path}`);
  return await rawRes.json();
}

function githubRawUrl(path, cfg) {
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.ref}/${path}`;
}

async function main() {
  const dbUrl =
    env("SUPABASE_DB_URL") ||
    env("DIRECT_DATABASE_URL") ||
    env("DATABASE_URL") ||
    env("POSTGRES_URL");
  if (!dbUrl) throw new Error("Missing SUPABASE_DB_URL");

  const genders = String(env("GENDERS", "men,women"))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === "men" || value === "women");
  const years = parseYears(env("YEARS", "2026"));
  if (!years.length) throw new Error("No valid YEARS provided");
  const primaryStorage = payloadPrimaryStorage();

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let total = 0;
  for (const gender of genders) {
    const cfg = genderConfig(gender);
    for (const year of years) {
      const indexPath = `${cfg.staticRoot}/${year}/index.json`;
      const manifestPath = `${cfg.staticRoot}/${year}/manifest.json`;
      const rows = await fetchRepoJson(indexPath, cfg);
      const manifest = await fetchRepoJson(manifestPath, cfg).catch(() => ({}));
      if (!Array.isArray(rows)) continue;

      for (const row of rows) {
        const player = String(row?.player ?? "").trim();
        const team = String(row?.team ?? "").trim();
        const season = Number(row?.season ?? year);
        const relativePath = String(row?.path ?? "").trim();
        const cacheKey = String(row?.cache_key ?? "").trim();
        if (!player || !team || !relativePath || !Number.isFinite(season)) continue;

        const storageKey = `${cfg.staticRoot}/${season}/${relativePath}`;
        const publicUrl = githubRawUrl(storageKey, cfg);
        const sourceHash = String(manifest?.[cacheKey] ?? row?.source_hash ?? "").trim();
        let storageProvider = "github";
        let storageKeyValue = storageKey;
        let publicUrlValue = publicUrl;
        let payloadJson = null;

        if (primaryStorage !== "github") {
          const payload = await fetchRepoJson(storageKey, cfg);
          if (primaryStorage === "supabase") {
            storageProvider = "supabase";
            payloadJson = payload;
            storageKeyValue = `${gender}/${season}/${relativePath}`;
            publicUrlValue = null;
          } else if (primaryStorage === "r2") {
            if (!hasR2Config()) {
              throw new Error("PAYLOAD_PRIMARY_STORAGE=r2 but R2 env vars are missing");
            }
            const { client: s3, cfg: r2 } = getR2Client();
            const r2Key = `cards/${gender}/${season}/${relativePath}`;
            const body = JSON.stringify(payload);
            await s3.send(
              new PutObjectCommand({
                Bucket: r2.bucket,
                Key: r2Key,
                Body: body,
                ContentType: "application/json",
              }),
            );
            storageProvider = "r2";
            storageKeyValue = r2Key;
            publicUrlValue = r2.publicBaseUrl ? `${r2.publicBaseUrl}/${r2Key}` : null;
          }
        }

        await client.query(
          `insert into public.player_payload_index
            (gender, season, team, player, cache_key, source_hash, storage_provider, storage_key, public_url, payload_json, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
           on conflict (gender, season, team, player)
           do update set
             cache_key = excluded.cache_key,
             source_hash = excluded.source_hash,
             storage_provider = excluded.storage_provider,
             storage_key = excluded.storage_key,
             public_url = excluded.public_url,
             payload_json = excluded.payload_json,
             updated_at = now()`,
          [
            gender,
            season,
            team,
            player,
            cacheKey,
            sourceHash,
            storageProvider,
            storageKeyValue,
            publicUrlValue,
            payloadJson ? JSON.stringify(payloadJson) : null,
          ],
        );
        total += 1;
      }
      console.log(`[sync] ${gender} ${year}: upserted ${rows.length} payload index rows`);
    }
  }

  await client.end();
  console.log(`[sync] total rows processed: ${total}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
