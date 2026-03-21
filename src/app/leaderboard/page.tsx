"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SEASONS } from "@/lib/ui-options";

type FilterRow = {
  metric: string;
  comparator: ">=" | "<=";
  value: string;
  mode: "stat" | "percentile";
};

type LbRow = {
  player: string;
  team: string;
  season: number;
  pos: string;
  age: number | null;
  height: string;
  rsci: number | null;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
};

const METRIC_OPTIONS = [
  ["ppg", "PPG"],
  ["rpg", "RPG"],
  ["apg", "APG"],
  ["spg", "SPG"],
  ["bpg", "BPG"],
  ["fg_pct", "FG%"],
  ["ts_pct", "TS%"],
  ["tp_pct", "3P%"],
  ["tpa_100", "3PA/100"],
  ["ftr", "FTr"],
  ["ast_pct", "AST%"],
  ["ato", "A/TO"],
  ["to_pct", "TO%"],
  ["stl_pct", "STL%"],
  ["blk_pct", "BLK%"],
  ["oreb_pct", "OREB%"],
  ["dreb_pct", "DREB%"],
  ["bpm", "BPM"],
  ["rapm", "RAPM"],
  ["obpm", "OBPM"],
  ["dbpm", "DBPM"],
] as const;

function fmt(v: number | null | undefined, d = 1): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  return v.toFixed(d);
}

export default function LeaderboardPage() {
  const [year, setYear] = useState<string>("All");
  const [age, setAge] = useState("All");
  const [team, setTeam] = useState("All");
  const [height, setHeight] = useState("All");
  const [rsci, setRsci] = useState("All");
  const [position, setPosition] = useState("All");
  const [allRows, setAllRows] = useState<LbRow[]>([]);
  const [rows, setRows] = useState<LbRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<string>("bpm");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [draftMetric, setDraftMetric] = useState<string>("ppg");
  const [draftComparator, setDraftComparator] = useState<">=" | "<=">(">=");
  const [draftValue, setDraftValue] = useState<string>("15");
  const [draftMode, setDraftMode] = useState<"stat" | "percentile">("stat");

  const metricMap = useMemo(
    () => Object.fromEntries(METRIC_OPTIONS.map(([k, v]) => [k, v])),
    [],
  );

  function sortClick(metric: string) {
    if (sortBy === metric) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(metric);
    setSortDir("desc");
  }

  function applyLocalQuery(baseRows: LbRow[]) {
    let next = [...baseRows];

    if (year && year !== "All") {
      const y = Number(year);
      if (Number.isFinite(y)) next = next.filter((r) => r.season === y);
    }
    if (age && age !== "All") {
      const a = Number(age);
      if (Number.isFinite(a)) next = next.filter((r) => r.age !== null && r.age === a);
    }
    if (team && team !== "All") {
      const needle = team.toLowerCase();
      next = next.filter((r) => r.team.toLowerCase().includes(needle));
    }
    if (height && height !== "All") {
      const needle = height.toLowerCase();
      next = next.filter((r) => r.height.toLowerCase().includes(needle));
    }
    if (position && position !== "All") {
      const p = position.toLowerCase();
      next = next.filter((r) => r.pos.toLowerCase().includes(p));
    }
    if (rsci && rsci !== "All") {
      const r = Number(rsci);
      if (Number.isFinite(r)) next = next.filter((x) => x.rsci !== null && x.rsci <= r);
    }

    for (const f of filters) {
      if (!f.metric || !METRIC_OPTIONS.find(([k]) => k === f.metric)) continue;
      const target = Number(f.value);
      if (!Number.isFinite(target)) continue;
      next = next.filter((r) => {
        const v = f.mode === "percentile" ? r.percentiles[f.metric] : r.values[f.metric];
        if (typeof v !== "number" || !Number.isFinite(v)) return false;
        return f.comparator === ">=" ? v >= target : v <= target;
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    next.sort((a, b) => {
      const av = a.values[sortBy];
      const bv = b.values[sortBy];
      const na = typeof av === "number" ? av : -Infinity;
      const nb = typeof bv === "number" ? bv : -Infinity;
      if (na === nb) return a.player.localeCompare(b.player);
      return na > nb ? dir : -dir;
    });

    setRows(next.slice(0, 100));
  }

  async function runQuery() {
    setLoading(true);
    setError("");
    try {
      const payload = { sortBy: "bpm", sortDir: "desc", limit: 10000, filters: [] as unknown[] };
      const r = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; rows?: LbRow[] };
      if (!j.ok) throw new Error(j.error || "Failed query");
      const loaded = Array.isArray(j.rows) ? j.rows : [];
      setAllRows(loaded);
      applyLocalQuery(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed query");
    } finally {
      setLoading(false);
    }
  }

  function addDraftFilter() {
    const v = Number(draftValue);
    if (!Number.isFinite(v)) {
      setError("Filter value must be a number.");
      return;
    }
    setError("");
    setFilters((prev) => [
      ...prev,
      {
        metric: draftMetric,
        comparator: draftComparator,
        value: draftValue,
        mode: draftMode,
      },
    ]);
  }

  useEffect(() => {
    void runQuery();
    // Intentionally run once on load to auto-populate with default BPM sort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!allRows.length) return;
    applyLocalQuery(allRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, age, team, height, rsci, position, filters, sortBy, sortDir, allRows]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href="/cards?gender=men" className="text-zinc-300">Player Profiles</Link>
            <Link href="/roster?gender=men" className="text-zinc-300">Roster Construction</Link>
            <Link href="/leaderboard" className="text-red-400">Leaderboard / Query</Link>
          </div>
          <Link href="/?gender=men" className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Biographical Filters</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div>
              <div className="mb-1 text-xs text-zinc-400">Year</div>
              <select className="w-full rounded bg-zinc-800 p-2" value={year} onChange={(e) => setYear(e.target.value)}>
                <option>All</option>
                {SEASONS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
            <div><div className="mb-1 text-xs text-zinc-400">Age</div><input className="w-full rounded bg-zinc-800 p-2" value={age} onChange={(e) => setAge(e.target.value)} /></div>
            <div><div className="mb-1 text-xs text-zinc-400">Team</div><input className="w-full rounded bg-zinc-800 p-2" value={team} onChange={(e) => setTeam(e.target.value)} /></div>
            <div><div className="mb-1 text-xs text-zinc-400">Height</div><input className="w-full rounded bg-zinc-800 p-2" value={height} onChange={(e) => setHeight(e.target.value)} /></div>
            <div><div className="mb-1 text-xs text-zinc-400">RSCI</div><input className="w-full rounded bg-zinc-800 p-2" value={rsci} onChange={(e) => setRsci(e.target.value)} /></div>
            <div><div className="mb-1 text-xs text-zinc-400">Position</div><input className="w-full rounded bg-zinc-800 p-2" value={position} onChange={(e) => setPosition(e.target.value)} /></div>
          </div>

          <div className="mt-4 text-lg font-bold">Stat / Percentile Filter Rows</div>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            <select className="rounded bg-zinc-800 p-2" value={draftMetric} onChange={(e) => setDraftMetric(e.target.value)}>
              {METRIC_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={draftComparator} onChange={(e) => setDraftComparator(e.target.value as ">=" | "<=")}>
              <option value=">=">{">="}</option>
              <option value="<=">{"<="}</option>
            </select>
            <input className="rounded bg-zinc-800 p-2" value={draftValue} onChange={(e) => setDraftValue(e.target.value)} />
            <select className="rounded bg-zinc-800 p-2" value={draftMode} onChange={(e) => setDraftMode(e.target.value as "stat" | "percentile")}>
              <option value="stat">Stat Number</option>
              <option value="percentile">Percentile</option>
            </select>
            <button className="rounded border border-zinc-600 bg-zinc-800 p-2" onClick={addDraftFilter}>
              Add
            </button>
          </div>

          <div className="mt-3 grid gap-2">
            {filters.map((f, i) => (
              <div key={`f-${i}`} className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-800/60 p-2 text-sm">
                <div className="text-zinc-200">
                  {(metricMap[f.metric] ?? f.metric)} {f.comparator} {f.value} ({f.mode === "stat" ? "Stat Number" : "Percentile"})
                </div>
                <button
                  className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs"
                  onClick={() => setFilters((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2" onClick={() => setFilters([])}>
              Clear Filters
            </button>
            <button className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={runQuery}>
              {loading ? "Loading..." : "Reload Data"}
            </button>
          </div>
          {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
          <div className="mt-2 text-xs text-zinc-500">Showing top 100 results.</div>
        </div>

        <div className="overflow-auto rounded-xl border border-zinc-700 bg-zinc-900">
          <table className="w-[2550px] border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-800 text-xs uppercase tracking-wide text-zinc-300">
                <th colSpan={7} className="border-b border-zinc-700 p-2">Biographical / Team</th>
                <th colSpan={8} className="border-b border-zinc-700 p-2">Impact</th>
                <th colSpan={8} className="border-b border-zinc-700 p-2">Per Game</th>
                <th colSpan={9} className="border-b border-zinc-700 p-2">Scoring</th>
                <th colSpan={8} className="border-b border-zinc-700 p-2">Playmaking</th>
                <th colSpan={6} className="border-b border-zinc-700 p-2">Defense</th>
                <th colSpan={6} className="border-b border-zinc-700 p-2">Rebounding</th>
              </tr>
              <tr className="bg-zinc-800 text-zinc-100">
                <th className="border-b border-zinc-700 p-2 text-left">Player</th>
                <th className="border-b border-zinc-700 p-2 text-left">Team</th>
                <th className="border-b border-zinc-700 p-2">Season</th>
                <th className="border-b border-zinc-700 p-2">Pos</th>
                <th className="border-b border-zinc-700 p-2">Age</th>
                <th className="border-b border-zinc-700 p-2">Height</th>
                <th className="border-b border-zinc-700 p-2">RSCI</th>

                {[
                  ["bpm", "BPM"], ["rapm", "RAPM"], ["obpm", "OBPM"], ["dbpm", "DBPM"],
                  ["bpm", "BPM %ile"], ["rapm", "RAPM %ile"], ["obpm", "OBPM %ile"], ["dbpm", "DBPM %ile"],
                  ["ppg", "PPG"], ["rpg", "RPG"], ["apg", "APG"], ["spg", "SPG"], ["bpg", "BPG"], ["ppg", "PPG %ile"], ["rpg", "RPG %ile"], ["apg", "APG %ile"],
                  ["fg_pct", "FG%"], ["ts_pct", "TS%"], ["tp_pct", "3P%"], ["tpa_100", "3PA/100"], ["ftr", "FTr"], ["fg_pct", "FG% %ile"], ["ts_pct", "TS% %ile"], ["tp_pct", "3P% %ile"], ["tpa_100", "3PA %ile"],
                  ["ast_pct", "AST%"], ["ato", "A/TO"], ["to_pct", "TO%"], ["ast_pct", "AST %ile"], ["ato", "A/TO %ile"], ["to_pct", "TO %ile"], ["apg", "APG"], ["apg", "APG %ile"],
                  ["stl_pct", "STL%"], ["blk_pct", "BLK%"], ["stl_pct", "STL %ile"], ["blk_pct", "BLK %ile"], ["dbpm", "DGBPM"], ["dbpm", "Def %ile"],
                  ["oreb_pct", "OREB%"], ["dreb_pct", "DREB%"], ["oreb_pct", "OREB %ile"], ["dreb_pct", "DREB %ile"], ["rpg", "REB"], ["rpg", "REB %ile"],
                ].map(([k, label], idx) => (
                  <th
                    key={`${k}-${idx}`}
                    className="cursor-pointer border-b border-zinc-700 p-2"
                    onClick={() => sortClick(k)}
                    title={`Sort by ${metricMap[k] ?? k}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${r.player}-${r.team}-${r.season}-${idx}`} className="odd:bg-zinc-900 even:bg-zinc-950">
                  <td className="border-b border-zinc-800 p-2 text-left">{r.player}</td>
                  <td className="border-b border-zinc-800 p-2 text-left">{r.team}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.season}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.pos || "N/A"}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.age, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{r.height || "N/A"}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.rsci, 0)}</td>

                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.bpm)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.rapm)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.obpm)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.dbpm)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.bpm, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.rapm, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.obpm, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.dbpm, 0)}</td>

                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.ppg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.rpg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.apg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.spg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.bpg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.ppg, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.rpg, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.apg, 0)}</td>

                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.fg_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.ts_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.tp_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.tpa_100)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.ftr)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.fg_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.ts_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.tp_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.tpa_100, 0)}</td>

                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.ast_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.ato)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.to_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.ast_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.ato, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.to_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.apg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.apg, 0)}</td>

                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.stl_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.blk_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.stl_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.blk_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.dbpm)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.dbpm, 0)}</td>

                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.oreb_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.dreb_pct)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.oreb_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.dreb_pct, 0)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center">{fmt(r.values.rpg)}</td>
                  <td className="border-b border-zinc-800 p-2 text-center text-emerald-400">{fmt(r.percentiles.rpg, 0)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={52} className="p-8 text-center text-zinc-400">
                    No rows yet. Set filters and click Run Query.
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
