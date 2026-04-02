import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import pg from "pg";

const { Client } = pg;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

const dbUrl =
  env("SUPABASE_DB_URL") ||
  env("DIRECT_DATABASE_URL") ||
  env("DATABASE_URL") ||
  env("POSTGRES_URL");

const accountId = env("R2_ACCOUNT_ID");
const bucket = env("R2_BUCKET");
const accessKeyId = env("R2_ACCESS_KEY_ID");
const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
const publicBaseUrl = env("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
const inlineLimit = Number(env("R2_PAYLOAD_INLINE_LIMIT_BYTES", "262144"));
const dryRun = env("DRY_RUN", "true").toLowerCase() !== "false";

if (!dbUrl) throw new Error("Missing database connection string");
if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Missing Cloudflare R2 credentials");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

function keyPart(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "");
}

function objectKey(parts) {
  return `${parts.map(keyPart).filter(Boolean).join("/")}.json`;
}

function isPointer(payload) {
  return payload && typeof payload === "object" && payload.__payloadSource === "r2";
}

async function offloadRow(client, table, row, keyParts) {
  const payload = row.payload;
  if (!payload || isPointer(payload)) return { skipped: true, reason: "already_offloaded" };

  const body = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(body, "utf-8");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= inlineLimit) {
    return { skipped: true, reason: "below_threshold", sizeBytes };
  }

  const key = objectKey(keyParts);
  const pointer = {
    __payloadSource: "r2",
    bucket,
    key,
    sizeBytes,
    contentType: "application/json",
    ...(publicBaseUrl ? { publicUrl: `${publicBaseUrl}/${key}` } : {}),
  };

  if (!dryRun) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }),
    );
    await client.query(`update ${table} set payload = $1::jsonb, updated_at = now() where ctid = $2`, [
      JSON.stringify(pointer),
      row.ctid,
    ]);
  }

  return { skipped: false, sizeBytes, key };
}

async function main() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const summary = {
    dryRun,
    cardPayloads: { processed: 0, offloaded: 0, skipped: 0 },
    rosterPayloads: { processed: 0, offloaded: 0, skipped: 0 },
  };

  const cardRows = await client.query(
    "select ctid, season, team, player, mode, destination_conference, payload from public.card_payloads",
  );
  for (const row of cardRows.rows) {
    summary.cardPayloads.processed += 1;
    const result = await offloadRow(client, "public.card_payloads", row, [
      "cards",
      row.season,
      row.team,
      row.player,
      row.mode,
      row.destination_conference || "na",
    ]);
    if (result.skipped) summary.cardPayloads.skipped += 1;
    else summary.cardPayloads.offloaded += 1;
  }

  const rosterRows = await client.query(
    "select ctid, season, team, add_hash, remove_hash, payload from public.roster_payloads",
  );
  for (const row of rosterRows.rows) {
    summary.rosterPayloads.processed += 1;
    const result = await offloadRow(client, "public.roster_payloads", row, [
      "rosters",
      row.season,
      row.team,
      row.add_hash || "none",
      row.remove_hash || "none",
    ]);
    if (result.skipped) summary.rosterPayloads.skipped += 1;
    else summary.rosterPayloads.offloaded += 1;
  }

  await client.end();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
