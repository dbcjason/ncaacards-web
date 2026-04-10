import fs from "node:fs/promises";
import path from "node:path";
import type {
  LineupOptionPayload,
  LineupOptionSummary,
} from "@/lib/lineup-analysis-types";

type FallbackFile = {
  gender?: string;
  season?: number;
  options?: LineupOptionPayload[];
};

const cache = new Map<string, FallbackFile>();

async function readFallbackFile(gender: string, season: number): Promise<FallbackFile> {
  const key = `${gender}:${season}`;
  if (cache.has(key)) return cache.get(key) as FallbackFile;
  const filePath = path.join(process.cwd(), "public", "data", `lineups-${gender}-${season}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as FallbackFile;
    cache.set(key, parsed);
    return parsed;
  } catch {
    const empty = { gender, season, options: [] };
    cache.set(key, empty);
    return empty;
  }
}

export async function getFallbackLineupOptions(
  gender: string,
  season: number,
): Promise<LineupOptionSummary[]> {
  const data = await readFallbackFile(gender, season);
  const options = Array.isArray(data.options) ? data.options : [];
  return options.map((option) => ({
    key: option.key,
    label: option.label,
    season: option.season,
    team: option.team,
    lineupCount: Array.isArray(option.lineups) ? option.lineups.length : 0,
  }));
}

export async function getFallbackLineupOptionByKey(
  gender: string,
  season: number,
  key: string,
): Promise<LineupOptionPayload | null> {
  const data = await readFallbackFile(gender, season);
  const options = Array.isArray(data.options) ? data.options : [];
  return options.find((option) => option.key === key) ?? null;
}
