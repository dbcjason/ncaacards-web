import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
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

function toNum(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function joinKey(team, idHash) {
  return `${normalizeKey(team)}::${String(idHash || "").trim()}`;
}

function slugTeam(team) {
  return normalizeKey(team) || "team";
}

async function walkFiles(rootDir) {
  const out = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(rootDir);
  return out;
}

async function discoverInputFiles() {
  const explicit = env("LINEUPS_IMPORT_FILES");
  if (explicit) {
    return explicit
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const root = env(
    "LINEUPS_IMPORT_DIR",
    "/Users/henryhalverson/Documents/New project",
  );
  const includePost = env("LINEUPS_IMPORT_INCLUDE_POSTSEASON", "1") !== "0";
  const files = [];
  try {
    const all = await walkFiles(root);
    for (const file of all) {
      const base = path.basename(file).toLowerCase();
      if (base.startsWith("lineups_regular") && base.endsWith(".csv")) files.push(file);
      if (includePost && base.startsWith("lineups_postseason") && base.endsWith(".csv")) files.push(file);
    }
  } catch (error) {
    throw new Error(
      `Could not scan lineup source directory ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return files;
}

async function parseCsvRows(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().replace(/^\uFEFF/, ""));
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return Object.fromEntries(header.map((key, idx) => [key, cols[idx] ?? ""]));
  });
}

async function buildDataset(files) {
  const aggregated = new Map();

  for (const file of files) {
    const rows = await parseCsvRows(file);
    for (const row of rows) {
      const team = String(row.__team_name || row.team || "").trim();
      const idHash = String(row.idHash || "").trim();
      if (!team || !idHash) continue;

      const players = [
        String(row["athletes[0].name"] || "").trim(),
        String(row["athletes[1].name"] || "").trim(),
        String(row["athletes[2].name"] || "").trim(),
        String(row["athletes[3].name"] || "").trim(),
        String(row["athletes[4].name"] || "").trim(),
      ];
      if (players.some((name) => !name)) continue;

      const key = joinKey(team, idHash);
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          id: idHash,
          team,
          players,
          possessions: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          fgm: 0,
          fga: 0,
          tpm: 0,
          tpa: 0,
          totalSeconds: 0,
          offRimAtt: 0,
          offRimMakes: 0,
          defRimAtt: 0,
          defRimMakes: 0,
        });
      }
      const current = aggregated.get(key);
      current.possessions += toNum(row["teamStats.possessions"]);
      current.pointsFor += toNum(row["teamStats.points"]);
      current.pointsAgainst += toNum(row["opponentStats.points"]);
      current.fgm += toNum(row["teamStats.fieldGoals.made"]);
      current.fga += toNum(row["teamStats.fieldGoals.attempted"]);
      current.tpm += toNum(row["teamStats.threePointers.made"]);
      current.tpa += toNum(row["teamStats.threePointers.attempted"]);
      current.totalSeconds += toNum(row.totalSeconds);

      current.offRimAtt +=
        toNum(row["teamStats.twoPointers.layups.attempted"]) +
        toNum(row["teamStats.twoPointers.dunks.attempted"]) +
        toNum(row["teamStats.twoPointers.tipIns.attempted"]);
      current.offRimMakes +=
        toNum(row["teamStats.twoPointers.layups.made"]) +
        toNum(row["teamStats.twoPointers.dunks.made"]) +
        toNum(row["teamStats.twoPointers.tipIns.made"]);

      current.defRimAtt +=
        toNum(row["opponentStats.twoPointers.layups.attempted"]) +
        toNum(row["opponentStats.twoPointers.dunks.attempted"]) +
        toNum(row["opponentStats.twoPointers.tipIns.attempted"]);
      current.defRimMakes +=
        toNum(row["opponentStats.twoPointers.layups.made"]) +
        toNum(row["opponentStats.twoPointers.dunks.made"]) +
        toNum(row["opponentStats.twoPointers.tipIns.made"]);
    }
  }

  const byTeam = new Map();
  for (const row of aggregated.values()) {
    if (!byTeam.has(row.team)) byTeam.set(row.team, []);
    byTeam.get(row.team).push(row);
  }

  const options = [];
  for (const team of Array.from(byTeam.keys()).sort((a, b) => a.localeCompare(b))) {
    const rows = byTeam.get(team);
    const playersSet = new Set();
    const lineups = rows.map((row) => {
      const twoPtAtt = Math.max(0, row.fga - row.tpa);
      const offRimRate = twoPtAtt > 0 ? row.offRimAtt / twoPtAtt : 0;
      const offRimPct = row.offRimAtt > 0 ? row.offRimMakes / row.offRimAtt : 0;
      const defRimRate = row.possessions > 0 ? row.defRimAtt / row.possessions : 0;
      const defRimPct = row.defRimAtt > 0 ? row.defRimMakes / row.defRimAtt : 0;
      for (const player of row.players) playersSet.add(player);
      return {
        id: row.id,
        players: row.players,
        minutes: Number((row.totalSeconds / 60).toFixed(1)),
        possessions: Math.round(row.possessions),
        pointsFor: Math.round(row.pointsFor),
        pointsAgainst: Math.round(row.pointsAgainst),
        fgm: Math.round(row.fgm),
        fga: Math.round(row.fga),
        tpm: Math.round(row.tpm),
        tpa: Math.round(row.tpa),
        offRimRate,
        offRimPct,
        defRimRate,
        defRimPct,
      };
    });
    lineups.sort((a, b) => b.possessions - a.possessions || b.minutes - a.minutes || a.id.localeCompare(b.id));
    options.push({
      key: `${slugTeam(team)}-2026`,
      label: `${team} 2026`,
      team,
      players: Array.from(playersSet).sort((a, b) => a.localeCompare(b)),
      lineups,
    });
  }
  return options;
}

async function main() {
  const dbUrl =
    env("SUPABASE_DB_URL") ||
    env("DIRECT_DATABASE_URL") ||
    env("DATABASE_URL") ||
    env("POSTGRES_URL");
  if (!dbUrl) {
    throw new Error(
      "Missing database URL. Set SUPABASE_DB_URL, DIRECT_DATABASE_URL, DATABASE_URL, or POSTGRES_URL.",
    );
  }

  const gender = env("LINEUPS_IMPORT_GENDER", "men").toLowerCase() === "women" ? "women" : "men";
  const season = Number(env("LINEUPS_IMPORT_SEASON", "2026")) || 2026;
  const files = await discoverInputFiles();
  if (!files.length) {
    throw new Error("No lineup CSV files found. Set LINEUPS_IMPORT_FILES or LINEUPS_IMPORT_DIR.");
  }

  console.log(`Discovered ${files.length} lineup CSV file(s). Building aggregated team payloads...`);
  const options = await buildDataset(files);
  console.log(`Prepared ${options.length} team option row(s). Writing to DB...`);

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from lineup_team_options
        where gender = $1 and season = $2`,
      [gender, season],
    );

    for (const option of options) {
      await client.query(
        `insert into lineup_team_options
          (gender, season, option_key, option_label, team, players, lineups, lineup_count, source, updated_at)
         values
          ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
         on conflict (gender, season, option_key)
         do update set
          option_label = excluded.option_label,
          team = excluded.team,
          players = excluded.players,
          lineups = excluded.lineups,
          lineup_count = excluded.lineup_count,
          source = excluded.source,
          updated_at = now()`,
        [
          gender,
          season,
          option.key,
          option.label,
          option.team,
          JSON.stringify(option.players),
          JSON.stringify(option.lineups),
          option.lineups.length,
          "import-lineups.mjs",
        ],
      );
    }

    await client.query("commit");
    const totalLineups = options.reduce((sum, option) => sum + option.lineups.length, 0);
    console.log(
      `Upserted lineup_team_options rows: teams=${options.length}, total_lineups=${totalLineups}, gender=${gender}, season=${season}`,
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
