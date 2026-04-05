import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
    });
  });
}

async function main() {
  const dbUrl =
    env("SUPABASE_DB_URL") ||
    env("DIRECT_DATABASE_URL") ||
    env("DATABASE_URL") ||
    env("POSTGRES_URL");
  if (!dbUrl) throw new Error("Missing SUPABASE_DB_URL");

  const season = Number(env("SEASON", "2026"));
  if (!Number.isFinite(season)) throw new Error("Invalid SEASON");
  const fetchBatchSize = Math.max(1, Number(env("FETCH_BATCH_SIZE", "250")));
  const updateBatchSize = Math.max(1, Number(env("UPDATE_BATCH_SIZE", "100")));

  const repoRoot = env("NCAAW_REPO_ROOT", path.resolve("..", "NCAAWCards_clean"));
  const exportScript = path.resolve("scripts", "export-women-comparisons.py");

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const totalRes = await client.query(
    `select count(*)::int as total
     from public.player_payload_index
     where gender = 'women' and season = $1`,
    [season],
  );
  const total = Number(totalRes.rows[0]?.total ?? 0);
  if (!total) {
    console.log(`[refresh] no women payload rows found for season ${season}`);
    await client.end();
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "women-comparisons-"));
  const targetsFile = path.join(tmpDir, "targets.json");
  const outputFile = path.join(tmpDir, "comparisons.json");

  try {
    let processed = 0;
    for (let offset = 0; offset < total; offset += fetchBatchSize) {
      const targetRes = await client.query(
        `select player, team, season
         from public.player_payload_index
         where gender = 'women' and season = $1
         order by team asc, player asc
         limit $2 offset $3`,
        [season, fetchBatchSize, offset],
      );
      const targets = targetRes.rows;
      if (!targets.length) continue;

      await writeFile(targetsFile, JSON.stringify(targets), "utf8");
      await run("python3", [exportScript, "--repo-root", repoRoot, "--targets-file", targetsFile, "--output-file", outputFile], {
        cwd: process.cwd(),
      });

      const updates = JSON.parse(await readFile(outputFile, "utf8"));
      if (!Array.isArray(updates) || !updates.length) {
        throw new Error(`Comparison export returned no updates for offset ${offset}`);
      }

      for (let i = 0; i < updates.length; i += updateBatchSize) {
        const batch = updates.slice(i, i + updateBatchSize);
        await client.query(
          `with data as (
             select *
             from json_to_recordset($1::json) as x(
               player text,
               team text,
               season int,
               comparisons_html text
             )
           )
           update public.player_payload_index p
           set payload_json = jsonb_set(
                 coalesce(p.payload_json, '{}'::jsonb),
                 '{sections_html}',
                 coalesce(p.payload_json -> 'sections_html', '{}'::jsonb) || jsonb_build_object('player_comparisons_html', data.comparisons_html),
                 true
               ),
               updated_at = now()
           from data
           where p.gender = 'women'
             and p.season = data.season
             and p.team = data.team
             and p.player = data.player`,
          [JSON.stringify(batch)],
        );
      }
      processed += updates.length;
      console.log(`[refresh] processed ${processed}/${total}`);
    }
  } finally {
    await client.end();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
