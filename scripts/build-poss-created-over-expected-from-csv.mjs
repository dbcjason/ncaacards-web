import fs from "node:fs/promises";
import path from "node:path";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function toNum(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseHeightToInches(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const feetInches = text.match(/(\d+)\s*'\s*(\d{1,2})/);
  if (feetInches) return Number(feetInches[1]) * 12 + Number(feetInches[2]);
  const dashed = text.match(/(\d+)\s*[- ]\s*(\d{1,2})/);
  if (dashed) return Number(dashed[1]) * 12 + Number(dashed[2]);
  return toNum(text.replace(/[^0-9.-]+/g, ""));
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

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function findIndex(header, aliases) {
  const normalized = header.map((h) => normalizeKey(h));
  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeKey(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function readFromRow(rowObj, aliases) {
  const map = new Map();
  for (const [key, value] of Object.entries(rowObj)) {
    map.set(normalizeKey(key), value);
  }
  for (const alias of aliases) {
    const aliasKey = normalizeKey(alias);
    if (map.has(aliasKey)) return toNum(map.get(aliasKey));
    for (const [key, value] of map.entries()) {
      if (key.includes(aliasKey)) return toNum(value);
    }
  }
  return null;
}

function possCreatedBase100(rowObj) {
  const stl100 = readFromRow(rowObj, ["stl100", "stl_per_100", "stlper100"]);
  const blk100 = readFromRow(rowObj, ["blk100", "blk_per_100", "blkper100", "blocks100", "blocks_per_100"]);
  const oreb100 = readFromRow(rowObj, ["oreb100", "orb100", "oreb_per_100"]);
  const to100 = readFromRow(rowObj, ["to100", "tov100", "to_per_100", "turnovers100", "turnovers_per_100"]);
  if ((stl100 != null || blk100 != null || oreb100 != null) && to100 != null) {
    return (blk100 ?? 0) * 0.6 + (stl100 ?? 0) + (oreb100 ?? 0) - (to100 ?? 0);
  }

  const spg = readFromRow(rowObj, ["spg", "stl"]);
  const bpg = readFromRow(rowObj, ["bpg", "blk", "blocks"]);
  const orebPg = readFromRow(rowObj, ["oreb", "orb", "orebpg", "oreb_per_game"]);
  const mpg = readFromRow(rowObj, ["mpg", "mp", "min_per", "minper"]);
  const toPg = readFromRow(rowObj, ["topg", "tov", "to_pg", "turnovers"]);
  if (mpg != null && mpg > 0 && toPg != null) {
    const stl100FromPg = spg != null ? (spg / mpg) * 100 : 0;
    const blk100FromPg = bpg != null ? (bpg / mpg) * 100 : 0;
    const oreb100FromPg = orebPg != null ? (orebPg / mpg) * 100 : 0;
    const to100FromPg = (toPg / mpg) * 100;
    return (blk100FromPg * 0.6) + stl100FromPg + oreb100FromPg - to100FromPg;
  }
  return null;
}

async function main() {
  const inPath = process.env.POSS_BT_CSV || "";
  if (!inPath) throw new Error("Set POSS_BT_CSV to the source CSV path");
  const outPath = process.env.POSS_OUT || path.join(process.cwd(), "poss_created_over_expected.csv");
  const seasonFilterRaw = String(process.env.POSS_SEASON || "").trim();
  const seasonFilter = seasonFilterRaw ? Number(seasonFilterRaw) : null;

  const text = await fs.readFile(inPath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV is empty");
  const header = parseCsvLine(lines[0]).map((v) => v.trim().replace(/^\uFEFF/, ""));

  const seasonIdx = findIndex(header, ["season", "year"]);
  const teamIdx = findIndex(header, ["team", "team_name", "school"]);
  const playerIdx = findIndex(header, ["player_name", "player"]);
  const heightIdx = findIndex(header, ["height", "ht", "listed_height"]);
  const statHeightIdx = findIndex(header, ["statistical_height", "stat_height", "predicted_profile_height"]);

  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const rowObj = Object.fromEntries(header.map((h, idx) => [h, cols[idx] ?? ""]));
    const season = seasonIdx >= 0 ? Number(cols[seasonIdx]) : null;
    const team = teamIdx >= 0 ? String(cols[teamIdx] ?? "").trim() : "";
    const player = playerIdx >= 0 ? String(cols[playerIdx] ?? "").trim() : "";
    if (!player || !team || !Number.isFinite(season)) continue;
    if (Number.isFinite(seasonFilter) && season !== seasonFilter) continue;
    const base = possCreatedBase100(rowObj);
    const heightText = heightIdx >= 0 ? String(cols[heightIdx] ?? "").trim() : "";
    const statHeightText = statHeightIdx >= 0 ? String(cols[statHeightIdx] ?? "").trim() : "";
    const heightInches = parseHeightToInches(statHeightText) ?? parseHeightToInches(heightText);
    records.push({
      season,
      team,
      player,
      height: heightText,
      statistical_height: statHeightText,
      height_inches: heightInches,
      base_poss_created_100: base,
      expected_poss_created_100: null,
      poss_created_over_expected_100: null,
      poss_created_over_expected_percentile: null,
    });
  }

  const bySeason = new Map();
  for (const record of records) {
    const bucket = bySeason.get(record.season) ?? [];
    bucket.push(record);
    bySeason.set(record.season, bucket);
  }

  for (const bucket of bySeason.values()) {
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

  const outHeader = [
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
  const outLines = [outHeader.join(",")];
  for (const rec of records) {
    outLines.push(
      [
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
      ].map(csvEscape).join(","),
    );
  }

  await fs.writeFile(outPath, `${outLines.join("\n")}\n`, "utf8");
  console.log(`[poss-created-csv] wrote ${records.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error("[poss-created-csv] failed", err);
  process.exitCode = 1;
});
