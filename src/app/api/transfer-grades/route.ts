import { NextRequest, NextResponse } from "next/server";

type GradeRow = Record<string, string>;

const CACHE_TTL_MS = 1000 * 60 * 30;
const memo = new Map<string, { ts: number; data: { rows: GradeRow[]; columns: string[] } }>();

function parseGender(raw?: string): "men" | "women" {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
}

function sourceCfg(gender: "men" | "women") {
  if (gender === "women") {
    return {
      owner: process.env.GITHUB_DATA_OWNER_WOMEN || process.env.GITHUB_DATA_OWNER || "dbcjason",
      repo: process.env.GITHUB_DATA_REPO_WOMEN || "NCAAWCards",
      ref: process.env.GITHUB_DATA_REF_WOMEN || process.env.GITHUB_DATA_REF || "main",
      csvPath:
        process.env.GITHUB_TRANSFER_GRADES_CSV_PATH_WOMEN ||
        "player_cards_pipeline/output/transfer_projection_2026_all_conferences.csv",
    };
  }
  return {
    owner: process.env.GITHUB_DATA_OWNER || "dbcjason",
    repo: process.env.GITHUB_DATA_REPO || "NCAACards",
    ref: process.env.GITHUB_DATA_REF || "main",
    csvPath:
      process.env.GITHUB_TRANSFER_GRADES_CSV_PATH ||
      "player_cards_pipeline/output/transfer_projection_2026_all_conferences.csv",
  };
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
): Promise<{ rows: GradeRow[]; columns: string[] }> {
  const key = `${owner}/${repo}@${ref}:${csvPath}`;
  const now = Date.now();
  const cached = memo.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;

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
  if (lines.length < 2) return { rows: [], columns: [] };
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
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const gender = parseGender(req.nextUrl.searchParams.get("gender") ?? "men");
    const season = String(req.nextUrl.searchParams.get("season") ?? "2026").trim();
    const cfg = sourceCfg(gender);
    const loaded = await fetchTransferRows(cfg.owner, cfg.repo, cfg.ref, cfg.csvPath);

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
      source: `${cfg.owner}/${cfg.repo}:${cfg.csvPath}`,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

