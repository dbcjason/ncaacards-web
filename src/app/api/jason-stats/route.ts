import { NextRequest, NextResponse } from "next/server";

type StatRow = Record<string, string>;

const CACHE_TTL_MS = 1000 * 60 * 30;
const memo = new Map<string, { ts: number; data: { rows: StatRow[]; columns: string[]; csvPath: string } }>();

function parseGender(raw?: string): "men" | "women" {
  return String(raw || "").toLowerCase() === "women" ? "women" : "men";
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

type SourceCfg = { owner: string; repo: string; ref: string; csvPaths: string[] };

function csvCandidates(explicitPath?: string): string[] {
  const base = [
    "player_cards_pipeline/output/jason_created_stats.csv",
    "jason_created_stats.csv",
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

function sourceCfgs(gender: "men" | "women"): SourceCfg[] {
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
    const csvPaths = csvCandidates(process.env.GITHUB_JASON_STATS_CSV_PATH_WOMEN);
    add(owner, repo, ref, csvPaths);
    add("dbcjason", "NCAAWCards", "main", csvPaths);
    return out;
  }

  const owner = process.env.GITHUB_DATA_OWNER || "dbcjason";
  const repo = process.env.GITHUB_DATA_REPO || "NCAACards";
  const ref = process.env.GITHUB_DATA_REF || "main";
  const csvPaths = csvCandidates(process.env.GITHUB_JASON_STATS_CSV_PATH);
  add(owner, repo, ref, csvPaths);
  add("dbcjason", "NCAACards", "main", csvPaths);
  return out;
}

async function fetchRows(owner: string, repo: string, ref: string, csvPath: string): Promise<{ rows: StatRow[]; columns: string[]; csvPath: string }> {
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
  if (!res.ok) throw new Error(`Failed to fetch Jason stats CSV (${res.status})`);

  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    const data = { rows: [], columns: [], csvPath };
    memo.set(key, { ts: now, data });
    return data;
  }

  const header = parseCsvLine(lines[0]).map((s) => s.trim().replace(/^\uFEFF/, ""));
  const rows: StatRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row: StatRow = {};
    for (let c = 0; c < header.length; c += 1) {
      row[header[c]] = String(cols[c] ?? "").trim();
    }
    rows.push(row);
  }

  const data = { rows, columns: header, csvPath };
  memo.set(key, { ts: now, data });
  return data;
}

async function fetchRowsWithFallback(cfgs: SourceCfg[]): Promise<{ rows: StatRow[]; columns: string[]; csvPath: string }> {
  let lastErr = "not found";
  let tries = 0;
  for (const cfg of cfgs) {
    for (const p of cfg.csvPaths) {
      tries += 1;
      try {
        return await fetchRows(cfg.owner, cfg.repo, cfg.ref, p);
      } catch (e) {
        lastErr = `${cfg.owner}/${cfg.repo}@${cfg.ref}:${p} -> ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  throw new Error(`Failed to fetch Jason stats CSV (tried ${tries} paths): ${lastErr}`);
}

export async function GET(req: NextRequest) {
  try {
    const gender = parseGender(req.nextUrl.searchParams.get("gender") ?? "men");
    const seasonRaw = String(req.nextUrl.searchParams.get("season") ?? "").trim();
    const cfgs = sourceCfgs(gender);
    const loaded = await fetchRowsWithFallback(cfgs);

    let rows = loaded.rows;
    if (seasonRaw && seasonRaw !== "All") {
      rows = rows.filter((r) => String(r.season || "").trim() === seasonRaw);
    }

    const seasons = Array.from(new Set(rows.map((r) => String(r.season || "").trim()).filter(Boolean))).sort();
    const classes = Array.from(new Set(rows.map((r) => String(r.class || "").trim()).filter(Boolean))).sort();
    const teams = Array.from(new Set(rows.map((r) => String(r.team || "").trim()).filter(Boolean))).sort();
    const players = Array.from(new Set(rows.map((r) => String(r.player_name || "").trim()).filter(Boolean))).sort();

    return NextResponse.json({
      ok: true,
      gender,
      rows,
      seasons,
      classes,
      teams,
      players,
      source: loaded.csvPath,
      columns: loaded.columns,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
