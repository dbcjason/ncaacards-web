"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Row = Record<string, string>;
type ApiResp = {
  ok?: boolean;
  error?: string;
  rows?: Row[];
  seasons?: string[];
  classes?: string[];
  teams?: string[];
  players?: string[];
};

function toNum(v: string | undefined): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

export default function JasonCreatedStatsPage() {
  return (
    <Suspense fallback={null}>
      <JasonCreatedStatsPageInner />
    </Suspense>
  );
}

function JasonCreatedStatsPageInner() {
  const searchParams = useSearchParams();
  const [gender, setGender] = useState<"men" | "women">("men");
  const [season, setSeason] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [playerFilter, setPlayerFilter] = useState("");
  const [minMpg, setMinMpg] = useState("10");
  const [draftedOnly, setDraftedOnly] = useState(false);
  const [highMajorOnly, setHighMajorOnly] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [sortCol, setSortCol] = useState<string>("feel_plus");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function conferenceKey(raw: string): string {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function isHighMajorConference(raw: string): boolean {
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

  function isHighMajorRow(r: Row): boolean {
    const team = String(r.team || "").trim().toLowerCase();
    if (team === "gonzaga") return true;
    const confRaw = String(r.conference || r.conf || r.source_conference || "").trim();
    return isHighMajorConference(confRaw);
  }

  const onSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSortCol(col);
    setSortDir("desc");
  };

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
    const s = searchParams.get("season");
    if (s) setSeason(s);
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const r = await fetch(`/api/jason-stats?gender=${gender}`, { cache: "no-store" });
        const j = (await r.json()) as ApiResp;
        if (!active) return;
        if (!j.ok) throw new Error(j.error || "Failed to load Jason Created Stats");
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setSeasons(Array.isArray(j.seasons) ? j.seasons : []);
        setClasses(Array.isArray(j.classes) ? j.classes : []);
        setTeams(Array.isArray(j.teams) ? j.teams : []);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load Jason Created Stats");
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [gender]);

  const filtered = useMemo(() => {
    const needle = playerFilter.trim().toLowerCase();
    const minMpgNum = Number(minMpg);
    const out = rows.filter((r) => {
      if (season !== "All" && String(r.season || "").trim() !== season) return false;
      if (classFilter !== "All" && String(r.class || "").trim() !== classFilter) return false;
      if (teamFilter !== "All" && String(r.team || "").trim() !== teamFilter) return false;
      if (needle && !String(r.player_name || "").toLowerCase().includes(needle)) return false;
      if (draftedOnly && !String(r.draft_pick || "").trim()) return false;
      if (highMajorOnly && !isHighMajorRow(r)) return false;
      if (Number.isFinite(minMpgNum) && minMpgNum > 0) {
        const mpg = Number(String(r.mpg ?? "").trim());
        if (!Number.isFinite(mpg) || mpg < minMpgNum) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      const avNum = toNum(a[sortCol]);
      const bvNum = toNum(b[sortCol]);
      const aIsNum = Number.isFinite(avNum);
      const bIsNum = Number.isFinite(bvNum);
      if (aIsNum && bIsNum && avNum !== bvNum) return sortDir === "desc" ? bvNum - avNum : avNum - bvNum;
      const av = String(a[sortCol] ?? "");
      const bv = String(b[sortCol] ?? "");
      if (av !== bv) return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      return String(a.player_name || "").localeCompare(String(b.player_name || ""));
    });

    return out;
  }, [rows, season, classFilter, teamFilter, playerFilter, draftedOnly, highMajorOnly, minMpg, sortCol, sortDir]);

  const seasonOptions = useMemo(() => ["All", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019"], []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href={`/cards?gender=${gender}`} className="text-zinc-300">Player Profiles</Link>
            <Link href={`/roster?gender=${gender}`} className="text-zinc-300">Roster Construction</Link>
            <Link href={`/transfer-grades?gender=${gender}&season=${season}`} className="text-zinc-300">Transfer Grades</Link>
            <Link href={`/jason-created-stats?gender=${gender}&season=${season}`} className="text-red-400">Jason Created Stats</Link>
            <Link href={`/leaderboard?gender=${gender}&season=${season}`} className="text-zinc-300">Leaderboard</Link>
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Jason Created Stats</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <select className="rounded bg-zinc-800 p-2" value={season} onChange={(e) => setSeason(e.target.value)}>
              {seasonOptions.map((s) => (
                <option key={s} value={s}>{s === "All" ? "Combined (All years)" : s}</option>
              ))}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option>All</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option>All</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="rounded bg-zinc-800 p-2" placeholder="Filter player" value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Min MPG</span>
              <input
                className="rounded bg-zinc-800 p-2"
                placeholder="10"
                value={minMpg}
                onChange={(e) => setMinMpg(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
            <span>{loading ? "Loading..." : `Rows: ${filtered.length}`}</span>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={draftedOnly} onChange={(e) => setDraftedOnly(e.target.checked)} />
              Drafted
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={highMajorOnly} onChange={(e) => setHighMajorOnly(e.target.checked)} />
              High Major
            </label>
            <button
              className="rounded bg-zinc-800 px-2 py-1"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              type="button"
            >
              {sortDir === "desc" ? "High to Low" : "Low to High"}
            </button>
          </div>
          {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
        </div>

        <div className="overflow-auto rounded-xl border border-zinc-700 bg-zinc-900">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-800 text-zinc-100">
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-left" onClick={() => onSort("season")}>Season</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-left" onClick={() => onSort("player_name")}>Player</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-left" onClick={() => onSort("team")}>Team</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-left" onClick={() => onSort("position")}>Pos</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-left" onClick={() => onSort("class")}>Class</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("mpg")}>MPG</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("listed_height")}>Listed Ht</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("statistical_height")}>Statistical Height</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("height_delta_inches")}>Delta (in)</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("height_delta_percentile")}>Delta %ile</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("feel_plus")}>Feel+</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("feel_plus_percentile")}>Feel+ %ile</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("rimfluence")}>Rimfluence</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("rimfluence_off")}>Off Rimfluence</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("rimfluence_def")}>Def Rimfluence</th>
                <th className="cursor-pointer border-b border-zinc-700 p-2 text-center" onClick={() => onSort("rimfluence_percentile")}>Rimfluence %ile</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={`${r.season}-${r.player_name}-${r.team}-${idx}`} className="odd:bg-zinc-900 even:bg-zinc-950">
                  <td className="border-b border-zinc-800 p-2 text-left">{r.season}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.player_name}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.team}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.position}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.class}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.mpg}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.listed_height}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.statistical_height}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.height_delta_inches}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.height_delta_percentile}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.feel_plus}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.feel_plus_percentile}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence_off}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence_def}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence_percentile}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={16} className="p-8 text-center text-zinc-400">
                    {loading ? "Loading Jason Created Stats..." : "No rows for the current filters."}
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
