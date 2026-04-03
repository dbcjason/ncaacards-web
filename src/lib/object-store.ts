import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getR2Config, hasR2Config } from "@/lib/env";

type JsonRecord = Record<string, unknown>;

export type StoredPayloadPointer = {
  __payloadSource: "r2";
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: "application/json";
  publicUrl?: string;
};

let client: S3Client | null = null;

function getClient() {
  const cfg = getR2Config();
  if (!hasR2Config()) throw new Error("R2 is not configured");
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return { client, cfg };
}

function payloadInlineLimitBytes() {
  return getR2Config().inlineLimitBytes;
}

export function isStoredPayloadPointer(value: unknown): value is StoredPayloadPointer {
  if (!value || typeof value !== "object") return false;
  const ptr = value as Record<string, unknown>;
  return ptr.__payloadSource === "r2" && typeof ptr.key === "string" && typeof ptr.bucket === "string";
}

function objectKey(parts: string[]) {
  return parts
    .map((part) =>
      String(part)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9/_-]+/g, "-")
        .replace(/\/+/g, "/")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
}

export async function storeJsonPayload(
  payload: JsonRecord,
  keyParts: string[],
): Promise<JsonRecord | StoredPayloadPointer> {
  const body = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(body, "utf-8");
  if (!hasR2Config() || sizeBytes <= payloadInlineLimitBytes()) {
    return payload;
  }

  const { client: s3, cfg } = getClient();
  const key = `${objectKey(keyParts)}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );

  const pointer: StoredPayloadPointer = {
    __payloadSource: "r2",
    bucket: cfg.bucket,
    key,
    sizeBytes,
    contentType: "application/json",
  };
  if (cfg.publicBaseUrl) {
    pointer.publicUrl = `${cfg.publicBaseUrl}/${key}`;
  }
  return pointer;
}

export async function loadJsonPayload<T extends JsonRecord>(
  stored: unknown,
): Promise<T | null> {
  if (!stored || typeof stored !== "object") return null;
  if (!isStoredPayloadPointer(stored)) return stored as T;

  const { client: s3 } = getClient();
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: stored.bucket,
      Key: stored.key,
    }),
  );
  const body = await res.Body?.transformToString();
  if (!body) return null;
  return JSON.parse(body) as T;
}

export async function loadJsonPayloadFromObjectKey<T extends JsonRecord>(
  key: string,
  bucketOverride?: string,
): Promise<T | null> {
  const { client: s3, cfg } = getClient();
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: bucketOverride || cfg.bucket,
      Key: key,
    }),
  );
  const body = await res.Body?.transformToString();
  if (!body) return null;
  return JSON.parse(body) as T;
}
