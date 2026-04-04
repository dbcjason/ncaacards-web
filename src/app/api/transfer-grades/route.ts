import { NextRequest, NextResponse } from "next/server";
import { assertGenderAccess, requireUser } from "@/lib/auth";

type GradeRow = Record<string, string>;

const CACHE_TTL_MS = 1000 * 60 * 30;
const memo = new Map<string, { ts: number; data: { rows: GradeRow[]; columns: string[] } }>();

function parseGender(raw?: string): "men" | "women" {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
}

function buildCandidatePaths(season: string, explicitPath?: string): string[] {
  const base = [
    `player_cards_pipeline/output/transfer_projection_${season}_all_conferences.csv`,
    `transfer_projection_${season}_all_conferences.csv`,
    "player_cards_pipeline/output/transfer_projection_2026_all_conferences.csv",
    "player_cards_pipeline/output/transfer_projection_all_conferences.csv",
    "player_cards_pipeline/output/transfer_projection_2026_all_conferences_matrix.csv",
    "player_cards_pipeline/output/transfer_projection_2026_all_conference_grades.csv",
    "transfer_projection_2026_all_conferences.csv",
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p?: string) => {
    const v = String(p || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  if (explicitPath) {
    add(explicitPath);
    if (!explicitPath.includes("/")) add(`player_cards_pipeline/output/${explicitPath}`);
  }
  for (const p of base) add(p);
  return out;
}

type SourceCfg = { owner: string; repo: string; ref: string; csvPaths: string[] };

function sourceCfgs(gender: "men" | "women", season: string): SourceCfg[] {
  const out: SourceCfg[] = [];
  const seen = new Set<string>();
  const add = (owner: string, repo: string, ref: string, csvPaths: string[]) => {
    const key = `${owner}/${repo}@${ref}`;
    if (!owner || !repo || !ref || seen.has(key)) return;
    seen.add(key);
    out.push({ owner, repo, ref, csvPaths });
  };

  if (gender === "women") {
    const owner = process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason";
    const repo = process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards";
    const ref = process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main";
    const csvPaths = buildCandidatePaths(season, process.env.GITHUB_TRANSFER_GRADES_CSV_PATH_WOMEN);
    add(owner, repo, ref, csvPaths);
    add("dbcjason", "NCAAWCards", "main", csvPaths);
    return out;
  }

  const owner = process.env.GITHUB_DATA_OWNER || "dbcjason";
  const repo = process.env.GITHUB_DATA_REPO || "NCAACards";
  const ref = process.env.GITHUB_DATA_REF || "main";
  const csvPaths = buildCandidatePaths(season, process.env.GITHUB_TRANSFER_GRADES_CSV_PATH);
  add(owner, repo, ref, csvPaths);
  add("dbcjason", "NCAACards", "main", csvPaths);
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
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

async function fetchTransferRows(
  owner: string,
  repo: string,
  ref: string,
  csvPath: string,
): Promise<{ rows: GradeRow[]; columns: string[]; csvPath: string }> {
  const key = `${owner}/${repo}@${ref}:${csvPath}`;
  const now = Date.now();
  const cached = memo.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return { ...cached.data, csvPath };

  const headers: Record<string, string> = {};
  const token = process.env.GITHUB_TOKEN || "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${csvPath}`;
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw new Error(`Failed to fetch transfer grades CSV (${res.status})`);

  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], columns: [], csvPath };
  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));

  const rows: GradeRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row: GradeRow = {};
    for (let c = 0; c < header.length; c += 1) {
      row[header[c]] = String(cols[c] ?? "").trim();
    }
    rows.push(row);
  }

  const data = { rows, columns: header };
  memo.set(key, { ts: now, data });
  return { ...data, csvPath };
}

async function fetchTransferRowsWithFallback(
  cfgs: SourceCfg[],
): Promise<{ rows: GradeRow[]; columns: string[]; csvPath: string }> {
  let lastErr = "not found";
  let tries = 0;
  for (const cfg of cfgs) {
    for (const p of cfg.csvPaths) {
      tries += 1;
      try {
        return await fetchTransferRows(cfg.owner, cfg.repo, cfg.ref, p);
      } catch (e) {
        lastErr = `${cfg.owner}/${cfg.repo}@${cfg.ref}:${p} -> ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  throw new Error(`Failed to fetch transfer grades CSV (tried ${tries} paths): ${lastErr}`);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const gender = parseGender(req.nextUrl.searchParams.get("gender") ?? "men");
    assertGenderAccess(user, gender);
    const season = String(req.nextUrl.searchParams.get("season") ?? "2026").trim();
    const cfgs = sourceCfgs(gender, season);
    const loaded = await fetchTransferRowsWithFallback(cfgs);

    let rows = loaded.rows;
    if (season) rows = rows.filter((r) => String(r.season || "").trim() === season);

    const baseCols = ["season", "player", "team", "source_conference", "class"];
    const gradeColumns = loaded.columns.filter((c) => !baseCols.includes(c));
    const classes = Array.from(new Set(rows.map((r) => String(r.class || "").trim()).filter(Boolean))).sort();
    const teams = Array.from(new Set(rows.map((r) => String(r.team || "").trim()).filter(Boolean))).sort();
    const players = Array.from(new Set(rows.map((r) => String(r.player || "").trim()).filter(Boolean))).sort();

    return NextResponse.json({
      ok: true,
      gender,
      season,
      rows,
      gradeColumns,
      classes,
      teams,
      players,
      source: loaded.csvPath,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
