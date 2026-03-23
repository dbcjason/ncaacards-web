"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  const [gender, setGender] = useState<"men" | "women">("men");
  const [season, setSeason] = useState<number>(2026);
  const [classFilter, setClassFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [playerFilter, setPlayerFilter] = useState("");
  const [rows, setRows] = useState<GradeRow[]>([]);
  const [gradeColumns, setGradeColumns] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const g = qs.get("gender");
    const s = Number(qs.get("season"));
    setGender(g === "women" ? "women" : "men");
    if (Number.isFinite(s) && s > 2000) setSeason(s);
  }, []);

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

  const filtered = useMemo(() => {
    const needle = playerFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (classFilter !== "All" && String(r.class || "").trim() !== classFilter) return false;
      if (teamFilter !== "All" && String(r.team || "").trim() !== teamFilter) return false;
      if (needle && !String(r.player || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, classFilter, teamFilter, playerFilter]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href={`/cards?gender=${gender}`} className="text-zinc-300">Player Profiles</Link>
            <Link href={`/roster?gender=${gender}`} className="text-zinc-300">Roster Construction</Link>
            <Link href={`/transfer-grades?gender=${gender}&season=${season}`} className="text-red-400">Transfer Grades</Link>
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
            <select className="rounded bg-zinc-800 p-2" value={gender} onChange={(e) => setGender(e.target.value === "women" ? "women" : "men")}>
              <option value="men">Men</option>
              <option value="women">Women</option>
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
                  <th key={c} className="border-b border-zinc-700 p-2 text-center">{c}</th>
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

