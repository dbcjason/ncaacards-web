"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  const [gender, setGender] = useState<"men" | "women">("men");
  const [season, setSeason] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [playerFilter, setPlayerFilter] = useState("");
  const [minMpg, setMinMpg] = useState("10");

  const [rows, setRows] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [sortCol, setSortCol] = useState<"feel_plus" | "rimfluence" | "height_delta_inches">("feel_plus");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const g = qs.get("gender");
    setGender(g === "women" ? "women" : "men");
    const s = qs.get("season");
    if (s) setSeason(s);
  }, []);

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
      if (Number.isFinite(minMpgNum) && minMpgNum > 0) {
        const mpg = Number(String(r.mpg ?? "").trim());
        if (!Number.isFinite(mpg) || mpg < minMpgNum) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      const av = toNum(a[sortCol]);
      const bv = toNum(b[sortCol]);
      if (av !== bv) return sortDir === "desc" ? bv - av : av - bv;
      return String(a.player_name || "").localeCompare(String(b.player_name || ""));
    });

    return out;
  }, [rows, season, classFilter, teamFilter, playerFilter, minMpg, sortCol, sortDir]);

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
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Jason Created Stats</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
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
            <input
              className="rounded bg-zinc-800 p-2"
              placeholder="Min MPG"
              value={minMpg}
              onChange={(e) => setMinMpg(e.target.value)}
            />
            <select
              className="rounded bg-zinc-800 p-2"
              value={sortCol}
              onChange={(e) => setSortCol(e.target.value as "feel_plus" | "rimfluence" | "height_delta_inches")}
            >
              <option value="feel_plus">Sort: Feel+</option>
              <option value="rimfluence">Sort: Rimfluence</option>
              <option value="height_delta_inches">Sort: Statistical Height</option>
            </select>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
            <span>{loading ? "Loading..." : `Rows: ${filtered.length}`}</span>
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
                <th className="border-b border-zinc-700 p-2 text-left">Season</th>
                <th className="border-b border-zinc-700 p-2 text-left">Player</th>
                <th className="border-b border-zinc-700 p-2 text-left">Team</th>
                <th className="border-b border-zinc-700 p-2 text-left">Pos</th>
                <th className="border-b border-zinc-700 p-2 text-left">Class</th>
                <th className="border-b border-zinc-700 p-2 text-center">Feel+</th>
                <th className="border-b border-zinc-700 p-2 text-center">Feel+ %ile</th>
                <th className="border-b border-zinc-700 p-2 text-center">Rimfluence</th>
                <th className="border-b border-zinc-700 p-2 text-center">Off Rimfluence</th>
                <th className="border-b border-zinc-700 p-2 text-center">Def Rimfluence</th>
                <th className="border-b border-zinc-700 p-2 text-center">Rimfluence %ile</th>
                <th className="border-b border-zinc-700 p-2 text-center">MPG</th>
                <th className="border-b border-zinc-700 p-2 text-center">Listed Ht</th>
                <th className="border-b border-zinc-700 p-2 text-center">Statistical Height</th>
                <th className="border-b border-zinc-700 p-2 text-center">Delta (in)</th>
                <th className="border-b border-zinc-700 p-2 text-center">Delta %ile</th>
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
                  <td className="border-b border-zinc-800 p-2 text-center">{r.feel_plus}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.feel_plus_percentile}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence_off}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence_def}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.rimfluence_percentile}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.mpg}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.listed_height}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.statistical_height}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.height_delta_inches}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.height_delta_percentile}</td>
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
