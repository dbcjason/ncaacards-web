"use client";

import { SEASONS } from "@/lib/ui-options";

type Gender = "men" | "women";
type AccessScope = "men" | "women" | "both";
type CardMode = "draft" | "transfer";

type StartJobResponse = {
  ok?: boolean;
  id?: string;
  error?: string;
};

type PollJobResponse = {
  ok?: boolean;
  error?: string;
  job?: {
    status?: string;
    result_json?: { cardHtml?: string } | null;
    error_text?: string | null;
  };
};

type WatchlistResponse = {
  ok?: boolean;
  items?: Array<{
    season?: number;
    team?: string;
    player?: string;
  }>;
};

type WarmRequest = {
  gender: Gender;
  season: number;
  team: string;
  player: string;
  mode: CardMode;
  destinationConference: string;
};

type SessionCacheRecord = Record<string, string>;

const STORAGE_KEY = "ncaacards:watchlist:profile-cache:v1";
const SESSION_WARMED_KEY = "ncaacards:watchlist:session-warmed:v1";
const SESSION_WARMING_KEY = "ncaacards:watchlist:session-warming:v1";
const MAX_CACHE_ENTRIES = 300;
const POLL_MS = 900;

function normalizedString(value: unknown): string {
  return String(value ?? "").trim();
}

function keyForRequest(req: WarmRequest): string {
  return [
    req.gender,
    String(req.season),
    req.team.trim().toLowerCase(),
    req.player.trim().toLowerCase(),
    req.mode,
    req.destinationConference.trim().toLowerCase(),
  ].join("::");
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function readStorageCache(): SessionCacheRecord {
  if (!canUseStorage()) return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SessionCacheRecord;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeStorageCache(cache: SessionCacheRecord) {
  if (!canUseStorage()) return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

function trimCache(cache: SessionCacheRecord): SessionCacheRecord {
  const entries = Object.entries(cache);
  if (entries.length <= MAX_CACHE_ENTRIES) return cache;
  const keep = entries.slice(entries.length - MAX_CACHE_ENTRIES);
  return Object.fromEntries(keep);
}

function sessionCacheMemory(): SessionCacheRecord {
  if (typeof window === "undefined") return {};
  const state = window as typeof window & {
    __ncaacardsWatchlistSessionCache?: SessionCacheRecord;
    __ncaacardsWatchlistInflight?: Map<string, Promise<string>>;
    __ncaacardsWatchlistWarmupPromise?: Promise<void>;
  };
  if (!state.__ncaacardsWatchlistSessionCache) {
    state.__ncaacardsWatchlistSessionCache = readStorageCache();
  }
  return state.__ncaacardsWatchlistSessionCache;
}

function inflightMap(): Map<string, Promise<string>> {
  if (typeof window === "undefined") return new Map<string, Promise<string>>();
  const state = window as typeof window & {
    __ncaacardsWatchlistInflight?: Map<string, Promise<string>>;
  };
  if (!state.__ncaacardsWatchlistInflight) {
    state.__ncaacardsWatchlistInflight = new Map<string, Promise<string>>();
  }
  return state.__ncaacardsWatchlistInflight;
}

export function buildWatchlistWarmRequest(input: {
  gender: Gender;
  season: number;
  team: string;
  player: string;
  mode: CardMode;
  destinationConference?: string;
}): WarmRequest {
  return {
    gender: input.gender,
    season: Number(input.season),
    team: normalizedString(input.team),
    player: normalizedString(input.player),
    mode: input.mode,
    destinationConference: input.mode === "transfer" ? normalizedString(input.destinationConference || "SEC") : "",
  };
}

export function getCachedWatchlistProfile(req: WarmRequest): string {
  const key = keyForRequest(req);
  const cache = sessionCacheMemory();
  return String(cache[key] || "");
}

function setCachedWatchlistProfile(req: WarmRequest, html: string) {
  const key = keyForRequest(req);
  const cache = sessionCacheMemory();
  cache[key] = html;
  const trimmed = trimCache(cache);
  const state = window as typeof window & { __ncaacardsWatchlistSessionCache?: SessionCacheRecord };
  state.__ncaacardsWatchlistSessionCache = trimmed;
  writeStorageCache(trimmed);
}

async function startCardJob(req: WarmRequest): Promise<string> {
  const res = await fetch("/api/jobs/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobType: "card",
      request: {
        gender: req.gender,
        season: req.season,
        team: req.team,
        player: req.player,
        mode: req.mode,
        destinationConference: req.mode === "transfer" ? req.destinationConference : "",
      },
    }),
  });
  const data = (await res.json()) as StartJobResponse;
  if (!res.ok || !data.ok || !data.id) {
    throw new Error(data.error || "Failed to start card build");
  }
  return data.id;
}

async function pollCardJob(id: string): Promise<string> {
  while (true) {
    const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
    const data = (await res.json()) as PollJobResponse;
    if (!res.ok || !data.ok || !data.job) {
      throw new Error(data.error || "Failed to poll card build");
    }
    const status = String(data.job.status || "");
    if (status === "done") {
      const html = String(data.job.result_json?.cardHtml || "");
      if (!html.trim()) throw new Error("Card HTML missing from job result");
      return html;
    }
    if (status === "error") {
      throw new Error(String(data.job.error_text || "Card build failed"));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function warmWatchlistProfile(req: WarmRequest): Promise<string> {
  const cached = getCachedWatchlistProfile(req);
  if (cached) return cached;
  if (typeof window === "undefined") return "";

  const key = keyForRequest(req);
  const inflight = inflightMap();
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const id = await startCardJob(req);
    const html = await pollCardJob(id);
    setCachedWatchlistProfile(req, html);
    return html;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

async function fetchWatchlistItems(gender: Gender, season: number) {
  const res = await fetch(`/api/watchlist?gender=${gender}&season=${season}`, { cache: "no-store" });
  if (!res.ok) return [] as WatchlistResponse["items"];
  const data = (await res.json()) as WatchlistResponse;
  if (!data.ok || !Array.isArray(data.items)) return [] as WatchlistResponse["items"];
  return data.items;
}

function gendersForScope(scope: AccessScope): Gender[] {
  if (scope === "both") return ["men", "women"];
  if (scope === "women") return ["women"];
  return ["men"];
}

async function runQueueWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
}

export async function warmAllWatchlistsForSession(input: {
  accessScope: AccessScope;
  favoriteConference?: string;
}) {
  if (!canUseStorage()) return;
  if (window.sessionStorage.getItem(SESSION_WARMED_KEY) === "1") return;

  const state = window as typeof window & {
    __ncaacardsWatchlistWarmupPromise?: Promise<void>;
  };
  if (state.__ncaacardsWatchlistWarmupPromise) {
    await state.__ncaacardsWatchlistWarmupPromise;
    return;
  }

  const promise = (async () => {
    window.sessionStorage.setItem(SESSION_WARMING_KEY, "1");
    const destinationConference = normalizedString(input.favoriteConference || "SEC") || "SEC";
    const keys = new Set<string>();
    const tasks: Array<() => Promise<void>> = [];

    for (const gender of gendersForScope(input.accessScope)) {
      for (const season of SEASONS) {
        let items: WatchlistResponse["items"] = [];
        try {
          items = await fetchWatchlistItems(gender, season);
        } catch {
          items = [];
        }
        for (const item of items ?? []) {
          const req = buildWatchlistWarmRequest({
            gender,
            season: Number(item?.season ?? season),
            team: normalizedString(item?.team),
            player: normalizedString(item?.player),
            mode: "transfer",
            destinationConference,
          });
          if (!req.team || !req.player) continue;
          const key = keyForRequest(req);
          if (keys.has(key)) continue;
          keys.add(key);
          tasks.push(async () => {
            try {
              await warmWatchlistProfile(req);
            } catch {}
          });
        }
      }
    }

    await runQueueWithConcurrency(tasks, 2);
    window.sessionStorage.setItem(SESSION_WARMED_KEY, "1");
    window.sessionStorage.removeItem(SESSION_WARMING_KEY);
  })();

  state.__ncaacardsWatchlistWarmupPromise = promise;
  try {
    await promise;
  } finally {
    state.__ncaacardsWatchlistWarmupPromise = undefined;
  }
}
