import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function toNum(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseHeightToInches(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const feetInches = text.match(/(\d+)\s*'\s*(\d{1,2})/);
  if (feetInches) return Number(feetInches[1]) * 12 + Number(feetInches[2]);
  const dashed = text.match(/(\d+)\s*[- ]\s*(\d{1,2})/);
  if (dashed) return Number(dashed[1]) * 12 + Number(dashed[2]);
  const numeric = toNum(text.replace(/[^0-9.-]+/g, ""));
  return numeric;
}

function fitLine(samples) {
  if (samples.length < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const sample of samples) {
    sumX += sample.x;
    sumY += sample.y;
    sumXX += sample.x * sample.x;
    sumXY += sample.x * sample.y;
  }
  const n = samples.length;
  const denom = (n * sumXX) - (sumX * sumX);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) return null;
  const slope = ((n * sumXY) - (sumX * sumY)) / denom;
  const intercept = (sumY - (slope * sumX)) / n;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  return { slope, intercept };
}

function percentile(values, value) {
  if (!values.length || !Number.isFinite(value)) return null;
  let le = 0;
  for (const current of values) if (current <= value) le += 1;
  return Math.max(0, Math.min(100, Math.round((le / values.length) * 100)));
}

function readFromBt(btRow, aliases) {
  const map = new Map();
  for (const [rawKey, rawValue] of Object.entries(btRow || {})) {
    const key = normalizeKey(rawKey);
    const value = toNum(rawValue);
    if (!key || value == null) continue;
    map.set(key, value);
  }
  for (const alias of aliases) {
    const aliasKey = normalizeKey(alias);
    if (map.has(aliasKey)) return map.get(aliasKey);
    for (const [key, value] of map.entries()) {
      if (key.includes(aliasKey) || aliasKey.includes(key)) return value;
    }
  }
  return null;
}

function possCreatedBase100(btRow) {
  const stl100 = readFromBt(btRow, ["stl100", "stl_per_100", "stlper100"]);
  const blk100 = readFromBt(btRow, ["blk100", "blk_per_100", "blkper100", "blocks100", "blocks_per_100"]);
  const oreb100 = readFromBt(btRow, ["oreb100", "orb100", "oreb_per_100"]);
  const to100 = readFromBt(btRow, ["to100", "tov100", "to_per_100", "turnovers100", "turnovers_per_100"]);

  if (stl100 != null || blk100 != null || oreb100 != null || to100 != null) {
    return (blk100 ?? 0) * 6 + (stl100 ?? 0) + (oreb100 ?? 0) - (to100 ?? 0);
  }

  const spg = readFromBt(btRow, ["spg", "stl"]);
  const bpg = readFromBt(btRow, ["bpg", "blk", "blocks"]);
  const orebPg = readFromBt(btRow, ["oreb", "orb", "orebpg", "oreb_per_game"]);
  const mpg = readFromBt(btRow, ["mpg", "mp", "min_per", "minper"]);
  const toPg = readFromBt(btRow, ["topg", "to", "tov", "to_pg", "turnovers"]);
  if (mpg != null && mpg > 0) {
    const stl100FromPg = spg != null ? (spg / mpg) * 100 : 0;
    const blk100FromPg = bpg != null ? (bpg / mpg) * 100 : 0;
    const oreb100FromPg = orebPg != null ? (orebPg / mpg) * 100 : 0;
    const to100FromPg = toPg != null ? (toPg / mpg) * 100 : 0;
    return (blk100FromPg * 6) + stl100FromPg + oreb100FromPg - to100FromPg;
  }
  return null;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const dbUrl = env("SUPABASE_DB_URL") || env("DIRECT_DATABASE_URL") || env("DATABASE_URL") || env("POSTGRES_URL");
  if (!dbUrl) throw new Error("Missing database URL");

  const gender = env("POSS_GENDER", "men");
  const seasonRaw = env("POSS_SEASON", "2026");
  const season = Number.isFinite(Number(seasonRaw)) ? Number(seasonRaw) : null;
  const outPath = env(
    "POSS_OUT",
    path.join(process.cwd(), `poss_created_over_expected_${gender}_${season ?? "all"}.csv`),
  );

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const params = [];
    const where = [];
    if (gender && gender !== "all") {
      params.push(gender);
      where.push(`gender = $${params.length}`);
    }
    if (season != null) {
      params.push(season);
      where.push(`season = $${params.length}`);
    }
    const rows = (
      await client.query(
        `select gender, season, team, player, height, statistical_height, bt_row
         from public.leaderboard_player_stats
         where ${where.length ? where.join(" and ") : "true"}`,
        params,
      )
    ).rows;

    const records = rows.map((row) => {
      const base = possCreatedBase100(row.bt_row || {});
      const heightInches = parseHeightToInches(row.statistical_height) ?? parseHeightToInches(row.height);
      return {
        gender: row.gender,
        season: row.season,
        team: row.team,
        player: row.player,
        height: row.height ?? "",
        statistical_height: row.statistical_height ?? "",
        height_inches: heightInches,
        base_poss_created_100: base,
        expected_poss_created_100: null,
        poss_created_over_expected_100: null,
        poss_created_over_expected_percentile: null,
      };
    });

    const groups = new Map();
    for (const rec of records) {
      const key = `${rec.gender}:${rec.season}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(rec);
      groups.set(key, bucket);
    }

    for (const bucket of groups.values()) {
      const samples = bucket
        .filter((r) => r.base_poss_created_100 != null && r.height_inches != null)
        .map((r) => ({ x: r.height_inches, y: r.base_poss_created_100 }));
      const fit = fitLine(samples);
      const overVals = [];
      for (const rec of bucket) {
        if (!fit || rec.base_poss_created_100 == null || rec.height_inches == null) continue;
        const expected = (fit.slope * rec.height_inches) + fit.intercept;
        const over = rec.base_poss_created_100 - expected;
        rec.expected_poss_created_100 = expected;
        rec.poss_created_over_expected_100 = over;
        overVals.push(over);
      }
      for (const rec of bucket) {
        if (rec.poss_created_over_expected_100 == null) continue;
        rec.poss_created_over_expected_percentile = percentile(overVals, rec.poss_created_over_expected_100);
      }
    }

    const header = [
      "gender",
      "season",
      "team",
      "player",
      "height",
      "statistical_height",
      "height_inches",
      "base_poss_created_100",
      "expected_poss_created_100",
      "poss_created_over_expected_100",
      "poss_created_over_expected_percentile",
    ];
    const lines = [header.join(",")];
    for (const rec of records) {
      lines.push(
        [
          rec.gender,
          rec.season,
          rec.team,
          rec.player,
          rec.height,
          rec.statistical_height,
          rec.height_inches ?? "",
          rec.base_poss_created_100 ?? "",
          rec.expected_poss_created_100 ?? "",
          rec.poss_created_over_expected_100 ?? "",
          rec.poss_created_over_expected_percentile ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    await fs.writeFile(outPath, `${lines.join("\n")}\n`, "utf8");
    console.log(`[poss-created-export] wrote ${records.length} rows to ${outPath}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[poss-created-export] failed", err);
  process.exitCode = 1;
});
