import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
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
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeColName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function joinKey(...parts) {
  return parts.map((part) => normalizeKey(part)).join('::');
}

function findCol(header, names) {
  const normalized = header.map((value) => normalizeColName(value));
  for (const name of names) {
    const idx = normalized.findIndex((value) => value === normalizeColName(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

function findRsciCol(header) {
  const normalized = header.map((value) => normalizeColName(value));
  const strongMatches = ['rsci', 'rscirank', 'rsci_rank', 'rscirating'];
  for (const key of strongMatches) {
    const idx = normalized.findIndex((value) => value === key);
    if (idx >= 0) return idx;
  }
  return findCol(header, ['rec rank', 'rec_rank', 'recruiting rank', 'rsci']);
}

function toNum(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function percentile(values, value) {
  if (!values.length || typeof value !== 'number' || !Number.isFinite(value)) return null;
  let le = 0;
  for (const current of values) if (current <= value) le += 1;
  return Math.max(0, Math.min(100, Math.round((le / values.length) * 100)));
}

function calcAgeOnJune25(dob, seasonYear) {
  const d = new Date(dob);
  if (!Number.isFinite(d.getTime())) return null;
  const ref = new Date(Date.UTC(seasonYear, 5, 25));
  let age = ref.getUTCFullYear() - d.getUTCFullYear();
  const m = ref.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) age -= 1;
  return Number.isFinite(age) ? age : null;
}

function dominantPosition(posFreqs) {
  if (!posFreqs || typeof posFreqs !== 'object') return '';
  const order = [
    ['pg', 'PG'],
    ['sg', 'SG'],
    ['sf', 'SF'],
    ['pf', 'PF'],
    ['c', 'C'],
  ];
  let best = ['', -1];
  for (const [key, label] of order) {
    const value = Number(posFreqs[key]);
    if (Number.isFinite(value) && value > best[1]) best = [label, value];
  }
  return best[0];
}

const METRIC_ALIASES = {
  ppg: ['pts', 'ppg'],
  rpg: ['treb', 'reb', 'rpg'],
  apg: ['ast', 'apg'],
  spg: ['stl', 'spg'],
  bpg: ['blk', 'bpg'],
  usg: ['usg', 'usage', 'usage%'],
  fg_pct: ['efg', 'fg%'],
  ts_pct: ['ts_per', 'ts%'],
  twop_pct: ['2p%', '2pt%', '2ptpct', 'twop_pct'],
  rim_pct: ['rim%', 'rimfg%'],
  rim_att_100: ['rimatt100', 'rimatt/100', 'rimfga100', 'rimfga/100'],
  dunks_100: ['dunks100', 'dunks/100'],
  mid_pct: ['mid%', 'midfg%'],
  tp_pct: ['tp_per', '3p%', '3pt%'],
  tpa_100: ['3pa100', '3p100', '3pa/100', '3p/100'],
  ftr: ['ftr'],
  ast_pct: ['ast_per', 'ast%'],
  rim_assts_100: ['rimassts100', 'rimassts/100', 'rimast100', 'rimast/100'],
  ato: ['ast/tov', 'a/to'],
  to_pct: ['to_per', 'to%'],
  uasst_dunks_100: ['uasstdunks100', 'uasstdunks/100'],
  uasst_rim_fgm_100: ['uasstrimfgm100', 'uasstrimfgm/100'],
  uasst_mid_fgm_100: ['uasstmidfgm100', 'uasstmidfgm/100'],
  uasst_3pm_100: ['uasst3pm100', 'uasst3pm/100'],
  unassisted_pts_100: ['unassistedpts100', 'unassistedpts/100'],
  stl_pct: ['stl_per', 'stl%'],
  blk_pct: ['blk_per', 'blk%'],
  oreb_pct: ['orb_per', 'oreb%'],
  dreb_pct: ['drb_per', 'dreb%'],
  bpm: ['gbpm', 'bpm'],
  rapm: ['rapm', 'epm', 'rpm'],
  obpm: ['obpm', 'ogbpm'],
  dbpm: ['dbpm', 'dgbpm'],
  net_points: ['net points', 'net_points', 'netrating', 'netrtg', 'net'],
  onoff_net: ['on/off net', 'onoff_net', 'onoff', 'onoffrating', 'onoffrtg'],
  rimfluence: ['rimfluence'],
  rimfluence_off: ['rimfluence_off', 'off_rimfluence', 'rimfluenceoff', 'offrimfluence'],
  rimfluence_def: ['rimfluence_def', 'def_rimfluence', 'rimfluencedef', 'defrimfluence'],
};

const METRIC_KEYS = Object.keys(METRIC_ALIASES);

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = parseCsvLine(lines[0]).map((value) => value.trim().replace(/^\uFEFF/, ''));
  return { header, lines: lines.slice(1).map(parseCsvLine) };
}

async function loadBioLookup(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function loadHeightMap(filePath) {
  try {
    const { header, lines } = await readCsv(filePath);
    const seasonIdx = findCol(header, ['season']);
    const playerIdx = findCol(header, ['player_name', 'player']);
    const teamIdx = findCol(header, ['team']);
    const map = new Map();
    for (const row of lines) {
      const season = Number(row[seasonIdx]);
      const team = String(row[teamIdx] ?? '').trim();
      const player = String(row[playerIdx] ?? '').trim();
      if (!player || !team || !Number.isFinite(season)) continue;
      const raw = Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']));
      map.set(joinKey(season, team, player), raw);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadEnrichedMap(filePath) {
  try {
    const obj = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const players = Array.isArray(obj?.players) ? obj.players : [];
    const map = new Map();
    for (const player of players) {
      const seasonMatch = String(player.year || '').match(/^(\d{4})/);
      const season = seasonMatch ? Number(seasonMatch[1]) + 1 : null;
      const team = String(player.team ?? '').trim();
      const name = String(player.key ?? '').replace(/\s+/g, ' ').trim();
      if (!season || !team || !name) continue;
      map.set(joinKey(season, team, name), player);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadGenderRows(source) {
  const { header, lines } = await readCsv(source.btPath);
  const heightMap = await loadHeightMap(source.heightPath);
  const enrichedMap = await loadEnrichedMap(source.enrichedPath);
  const bioLookup = await loadBioLookup(source.bioLookupPath);
  const idx = {
    player: findCol(header, ['player_name', 'player']),
    team: findCol(header, ['team', 'school']),
    conference: findCol(header, ['conf', 'conference']),
    class: findCol(header, ['yr', 'class']),
    season: findCol(header, ['year', 'season']),
    role: findCol(header, ['role', 'pos', 'position']),
    height: findCol(header, ['ht', 'height']),
    rsci: findRsciCol(header),
    dob: findCol(header, ['dob']),
  };
  const metricIdx = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, findCol(header, METRIC_ALIASES[key])]),
  );

  const rows = [];
  for (const line of lines) {
    const player = String(line[idx.player] ?? '').trim();
    const team = String(line[idx.team] ?? '').trim();
    const season = Number(line[idx.season]);
    if (!player || !team || !Number.isFinite(season)) continue;

    const btRow = Object.fromEntries(header.map((name, index) => [name, line[index] ?? '']));
    const lookupKey = joinKey(team, player);
    const sourceKey = joinKey(season, team, player);
    const heightProfile = heightMap.get(sourceKey) || {};
    const enrichedRow = enrichedMap.get(sourceKey) || {};
    const bioExtras = bioLookup[lookupKey] || {};

    const values = {};
    for (const key of METRIC_KEYS) {
      values[key] = metricIdx[key] >= 0 ? toNum(line[metricIdx[key]]) : null;
    }

    const rsci = toNum(bioExtras.rsci) ?? toNum(line[idx.rsci]);
    const age = calcAgeOnJune25(String(line[idx.dob] ?? '').trim(), season) ?? toNum(bioExtras.age_june25);
    const pos =
      dominantPosition(enrichedRow.posFreqs) ||
      String(bioExtras.enriched_position || bioExtras.jason_position || line[idx.role] || '').trim();
    const listedHeight =
      String(
        heightProfile.listed_height ||
          bioExtras.bt_height ||
          bioExtras.listed_height ||
          line[idx.height] ||
          '',
      ).trim();
    const statisticalHeight = String(
      heightProfile.predicted_profile_height ||
        bioExtras.statistical_height ||
        '',
    ).trim();
    const statisticalHeightDelta =
      toNum(heightProfile.height_delta_inches) ?? toNum(bioExtras.statistical_height_delta);

    rows.push({
      gender: source.gender,
      season,
      team,
      player,
      conference: String(line[idx.conference] ?? enrichedRow.conf ?? '').trim(),
      class: String(line[idx.class] ?? '').trim(),
      pos,
      age,
      height: listedHeight,
      statistical_height: statisticalHeight,
      statistical_height_delta: statisticalHeightDelta,
      rsci,
      values,
      percentiles: {},
      bt_row: btRow,
      enriched_row: enrichedRow,
      height_profile: heightProfile,
      bio_extras: bioExtras,
    });
  }

  const bySeason = new Map();
  for (const row of rows) {
    const key = `${row.gender}:${row.season}`;
    if (!bySeason.has(key)) bySeason.set(key, []);
    bySeason.get(key).push(row);
  }

  for (const seasonRows of bySeason.values()) {
    const metricValues = {};
    for (const key of METRIC_KEYS) {
      metricValues[key] = seasonRows
        .map((row) => row.values[key])
        .filter((value) => typeof value === 'number' && Number.isFinite(value));
    }
    for (const row of seasonRows) {
      const percentiles = {};
      for (const key of METRIC_KEYS) {
        percentiles[key] = percentile(metricValues[key], row.values[key]);
      }
      row.percentiles = percentiles;
    }
  }

  return rows;
}

async function main() {
  const dbUrl = env('SUPABASE_DB_URL') || env('DIRECT_DATABASE_URL') || env('DATABASE_URL') || env('POSTGRES_URL');
  if (!dbUrl) throw new Error('Missing database URL');

  const root = path.resolve(process.cwd(), '..');
  const sources = [
    {
      gender: 'men',
      btPath: env('MEN_BT_CSV', path.join(root, 'NCAACards_clean/player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv')),
      heightPath: env('MEN_HEIGHT_CSV', path.join(root, 'NCAACards_clean/player_cards_pipeline/output/height_profile_scores_2026.csv')),
      enrichedPath: env('MEN_ENRICHED_JSON', path.join(root, 'NCAACards_clean/player_cards_pipeline/data/manual/enriched_players/by_script_season/players_all_Men_scriptSeason_2026_fromJsonYear_2025.json')),
      bioLookupPath: env('MEN_BIO_LOOKUP_JSON', ''),
    },
    {
      gender: 'women',
      btPath: env('WOMEN_BT_CSV', path.join(root, 'NCAAWCards_clean/player_cards_pipeline/data/bt/bt_advstats_2010_2026.csv')),
      heightPath: env('WOMEN_HEIGHT_CSV', path.join(root, 'NCAAWCards_clean/player_cards_pipeline/output/height_profile_scores_2026.csv')),
      enrichedPath: env('WOMEN_ENRICHED_JSON', path.join(root, 'NCAAWCards_clean/player_cards_pipeline/data/manual/enriched_players/by_script_season/players_all_Women_scriptSeason_2026_fromJsonYear_2025.json')),
      bioLookupPath: env('WOMEN_BIO_LOOKUP_JSON', path.join(process.cwd(), 'src/data/card-bio-lookups/women-2026.json')),
    },
  ];

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const source of sources) {
      const rows = await loadGenderRows(source);
      console.log(`[leaderboard-import] ${source.gender} rows=${rows.length}`);
      await client.query('begin');
      await client.query('delete from public.leaderboard_player_stats where gender = $1', [source.gender]);
      const batchSize = Number(env('LEADERBOARD_BATCH_SIZE', '500'));
      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        await client.query(
          `insert into public.leaderboard_player_stats
            (gender, season, team, player, conference, class, pos, age, height, statistical_height, statistical_height_delta, rsci, values, percentiles, bt_row, enriched_row, height_profile, bio_extras, source_updated_at, updated_at)
           select
             x.gender,
             x.season,
             x.team,
             x.player,
             x.conference,
             x.class,
             x.pos,
             x.age,
             x.height,
             x.statistical_height,
             x.statistical_height_delta,
             x.rsci,
             x.values,
             x.percentiles,
             x.bt_row,
             x.enriched_row,
             x.height_profile,
             x.bio_extras,
             now(),
             now()
           from jsonb_to_recordset($1::jsonb) as x(
             gender text,
             season int,
             team text,
             player text,
             conference text,
             class text,
             pos text,
             age numeric,
             height text,
             statistical_height text,
             statistical_height_delta numeric,
             rsci numeric,
             values jsonb,
             percentiles jsonb,
             bt_row jsonb,
             enriched_row jsonb,
             height_profile jsonb,
             bio_extras jsonb
           )
           on conflict (gender, season, team, player)
           do update set
             conference = excluded.conference,
             class = excluded.class,
             pos = excluded.pos,
             age = excluded.age,
             height = excluded.height,
             statistical_height = excluded.statistical_height,
             statistical_height_delta = excluded.statistical_height_delta,
             rsci = excluded.rsci,
             values = excluded.values,
             percentiles = excluded.percentiles,
             bt_row = excluded.bt_row,
             enriched_row = excluded.enriched_row,
             height_profile = excluded.height_profile,
             bio_extras = excluded.bio_extras,
             source_updated_at = now(),
             updated_at = now()`,
          [JSON.stringify(batch)],
        );
        if ((start / batchSize) % 20 === 0 || start + batch.length >= rows.length) {
          console.log(`[leaderboard-import] ${source.gender} upserted ${Math.min(start + batch.length, rows.length)}/${rows.length}`);
        }
      }
      await client.query('commit');
    }
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[leaderboard-import] failed', error);
  process.exitCode = 1;
});
