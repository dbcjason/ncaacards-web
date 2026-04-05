"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SEASONS } from "@/lib/ui-options";

type GradeRow = Record<string, string>;

type ApiResp = {
  ok?: boolean;
  error?: string;
  rows?: GradeRow[];
  gradeColumns?: string[];
  classes?: string[];
  teams?: string[];
  players?: string[];
};

export default function TransferGradesPage() {
  return (
    <Suspense fallback={null}>
      <TransferGradesPageInner />
    </Suspense>
  );
}

function TransferGradesPageInner() {
  const searchParams = useSearchParams();
  const MANUAL_EXCLUDE_PLAYERS = new Set([
    "jake shapiro",
    "tj drain",
  ]);
  const [gender, setGender] = useState<"men" | "women">("men");
  const [season, setSeason] = useState<number>(2026);
  const [classFilter, setClassFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [playerFilter, setPlayerFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "mid_major">("all");
  const [sortCol, setSortCol] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [rows, setRows] = useState<GradeRow[]>([]);
  const [gradeColumns, setGradeColumns] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
    const s = Number(searchParams.get("season"));
    if (Number.isFinite(s) && s > 2000) setSeason(s);
  }, [searchParams]);

  function gradeScore(raw: string): number {
    const v = String(raw || "").trim().toUpperCase();
    const map: Record<string, number> = {
      "A+": 12, A: 11, "A-": 10,
      "B+": 9, B: 8, "B-": 7,
      "C+": 6, C: 5, "C-": 4,
      "D+": 3, D: 2, "D-": 1,
      F: 0,
    };
    return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : -1;
  }

  function conferenceKey(raw: string): string {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function isHighMajorSourceConference(raw: string): boolean {
    const k = conferenceKey(raw);
    const exact = new Set([
      "sec",
      "acc",
      "b10",
      "b1g",
      "big10",
      "bigten",
      "b12",
      "big12",
      "be",
      "bigeast",
    ]);
    if (exact.has(k)) return true;
    return (
      k.includes("bigten") ||
      k.includes("b1g") ||
      k.includes("big12") ||
      k.includes("bigeast") ||
      k.includes("acc") ||
      k.includes("sec")
    );
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const r = await fetch(`/api/transfer-grades?gender=${gender}&season=${season}`, { cache: "no-store" });
        const j = (await r.json()) as ApiResp;
        if (!active) return;
        if (!j.ok) throw new Error(j.error || "Failed to load transfer grades");
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setGradeColumns(Array.isArray(j.gradeColumns) ? j.gradeColumns : []);
        setClasses(Array.isArray(j.classes) ? j.classes : []);
        setTeams(Array.isArray(j.teams) ? j.teams : []);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load transfer grades");
        setRows([]);
        setGradeColumns([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [gender, season]);

  useEffect(() => {
    const q = playerFilter.trim();
    if (q.length < 2) return;
    const t = window.setTimeout(() => {
      void fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "transfer_search",
          gender,
          season,
          queryText: q,
          source: "transfer_grades_filter",
        }),
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [playerFilter, gender, season]);

  const filtered = useMemo(() => {
    const needle = playerFilter.trim().toLowerCase();
    const base = rows.filter((r) => {
      const playerNorm = String(r.player || "").trim().toLowerCase();
      if (MANUAL_EXCLUDE_PLAYERS.has(playerNorm)) return false;
      if (classFilter !== "All" && String(r.class || "").trim() !== classFilter) return false;
      if (teamFilter !== "All" && String(r.team || "").trim() !== teamFilter) return false;
      if (scopeFilter === "mid_major" && isHighMajorSourceConference(String(r.source_conference || ""))) return false;
      if (needle && !String(r.player || "").toLowerCase().includes(needle)) return false;
      return true;
    });
    if (!sortCol || !gradeColumns.includes(sortCol)) return base;
    const out = [...base];
    out.sort((a, b) => {
      const av = gradeScore(String(a[sortCol] || ""));
      const bv = gradeScore(String(b[sortCol] || ""));
      if (av !== bv) return sortDir === "desc" ? bv - av : av - bv;
      return String(a.player || "").localeCompare(String(b.player || ""));
    });
    return out;
  }, [rows, classFilter, teamFilter, scopeFilter, playerFilter, sortCol, sortDir, gradeColumns]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href={`/cards?gender=${gender}`} className="text-zinc-300">Player Profiles</Link>
            <Link href={`/roster?gender=${gender}`} className="text-zinc-300">Roster Construction</Link>
            <Link href={`/transfer-grades?gender=${gender}&season=${season}`} className="text-red-400">Transfer Grades</Link>
            <Link href={`/jason-created-stats?gender=${gender}&season=${season}`} className="text-zinc-300">Jason Created Stats</Link>
            <Link href={`/leaderboard?gender=${gender}&season=${season}`} className="text-zinc-300">Leaderboard</Link>
            <Link href={`/watchlist?gender=${gender}&season=${season}`} className="text-zinc-300">Watchlist</Link>
            {gender === "men" && <Link href="/lineup-analysis" className="text-zinc-300">Lineup Analysis</Link>}
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Transfer Grades</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <select className="rounded bg-zinc-800 p-2" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {SEASONS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option>All</option>
              {classes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option>All</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              className="rounded bg-zinc-800 p-2"
              placeholder="Filter player"
              value={playerFilter}
              onChange={(e) => setPlayerFilter(e.target.value)}
            />
            <select
              className="rounded bg-zinc-800 p-2"
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value === "mid_major" ? "mid_major" : "all")}
            >
              <option value="all">All Players</option>
              <option value="mid_major">Mid Major Only</option>
            </select>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            {loading ? "Loading..." : `Rows: ${filtered.length}`}
          </div>
          {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
        </div>

        <div className="overflow-auto rounded-xl border border-zinc-700 bg-zinc-900">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-800 text-zinc-100">
                <th className="border-b border-zinc-700 p-2 text-left">Season</th>
                <th className="border-b border-zinc-700 p-2 text-left">Player</th>
                <th className="border-b border-zinc-700 p-2 text-left">Team</th>
                <th className="border-b border-zinc-700 p-2 text-left">Source Conference</th>
                <th className="border-b border-zinc-700 p-2 text-left">Class</th>
                {gradeColumns.map((c) => (
                  <th
                    key={c}
                    className="cursor-pointer border-b border-zinc-700 p-2 text-center"
                    onClick={() => {
                      if (sortCol === c) {
                        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                      } else {
                        setSortCol(c);
                        setSortDir("desc");
                      }
                    }}
                  >
                    {c}{sortCol === c ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={`${r.season}-${r.player}-${r.team}-${idx}`} className="odd:bg-zinc-900 even:bg-zinc-950">
                  <td className="border-b border-zinc-800 p-2 text-left">{r.season}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.player}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.team}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.source_conference}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.class}</td>
                  {gradeColumns.map((c) => (
                    <td key={c} className="border-b border-zinc-800 p-2 text-center">{r[c] || ""}</td>
                  ))}
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5 + gradeColumns.length} className="p-8 text-center text-zinc-400">
                    {loading ? "Loading transfer grades..." : "No rows for the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
