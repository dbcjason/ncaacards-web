import "server-only";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hashPassword } from "@/lib/auth";

const COOKIE_NAME = "dbcjason_pending_signup";
const TTL_SECONDS = 60 * 30;

type PendingSignupPayload = {
  email: string;
  passwordHash: string;
  accessCode: string;
  createdAt: number;
};

function secret(): string {
  const value = String(process.env.APP_AUTH_SECRET || process.env.PAYLOAD_SYNC_TOKEN || "").trim();
  if (!value) {
    throw new Error("APP_AUTH_SECRET or PAYLOAD_SYNC_TOKEN must be configured for signup flows.");
  }
  return value;
}

function encode(payload: PendingSignupPayload): string {
  const json = JSON.stringify(payload);
  const base = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret()).update(base).digest("base64url");
  return `${base}.${sig}`;
}

function decode(token: string): PendingSignupPayload | null {
  const [base, sig] = token.split(".");
  if (!base || !sig) return null;
  const expected = createHmac("sha256", secret()).update(base).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(base, "base64url").toString("utf8")) as PendingSignupPayload;
    if (!parsed?.email || !parsed?.passwordHash || !parsed?.accessCode || !parsed?.createdAt) return null;
    if (Date.now() - Number(parsed.createdAt) > TTL_SECONDS * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setPendingSignup(input: { email: string; password: string; accessCode: string }) {
  const jar = await cookies();
  const token = encode({
    email: input.email.trim().toLowerCase(),
    passwordHash: hashPassword(input.password),
    accessCode: input.accessCode.trim(),
    createdAt: Date.now(),
  });
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function getPendingSignup() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value?.trim();
  if (!token) return null;
  return decode(token);
}

export async function clearPendingSignup() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
