"use client";

import { Suspense, useEffect, useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SEASONS } from "@/lib/ui-options";

type MetricMeta = {
  key: string;
  label: string;
};

type LeaderboardRow = {
  season: number;
  team: string;
  player: string;
  conference: string;
  class: string;
  pos: string;
  age: number | null;
  height: string;
  statistical_height: string;
  statistical_height_delta: number | null;
  rsci: number | null;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
  minutes_per_game?: number | null;
};

type FilterRow = {
  id: string;
  metric: string;
  comparator: ">=" | "<=";
  value: string;
  mode: "stat" | "percentile";
};

type ApiResp = {
  ok?: boolean;
  error?: string;
  rows?: LeaderboardRow[];
  total?: number;
  teams?: string[];
  positions?: string[];
  conferences?: string[];
  metrics?: MetricMeta[];
  minMpg?: number;
};

type BaseColumnKey = "team" | "class" | "pos" | "height" | "statistical_height" | "age" | "rsci";

type DisplayColumn =
  | { kind: "base"; key: BaseColumnKey; label: string; sortKey: string; align?: "left" | "center" }
  | { kind: "metric"; key: `metric:${string}`; label: string; sortKey: string; align?: "left" | "center"; metricKey: string };

type OptionItem = {
  key: string;
  label: string;
};

const CLASS_OPTIONS = ["All", "Freshman", "Sophomore", "Junior", "Senior"];
const CONFERENCE_OPTIONS_BASE = ["All", "High Major", "Mid/Low Major"] as const;
const BASE_COLUMNS: Array<{ key: BaseColumnKey; label: string; sortKey: string; align?: "left" | "center" }> = [
  { key: "team", label: "Team", sortKey: "team", align: "left" },
  { key: "class", label: "Class", sortKey: "class", align: "left" },
  { key: "pos", label: "Pos", sortKey: "pos", align: "left" },
  { key: "height", label: "Height", sortKey: "height", align: "left" },
  { key: "statistical_height", label: "Stat Height", sortKey: "statistical_height", align: "left" },
  { key: "age", label: "Age", sortKey: "age", align: "left" },
  { key: "rsci", label: "RSCI", sortKey: "rsci", align: "left" },
];
const SPECIAL_FILTER_OPTIONS: OptionItem[] = [
  { key: "age", label: "Age" },
  { key: "rsci", label: "RSCI" },
  { key: "height_inches", label: "Height (in)" },
  { key: "statistical_height_inches", label: "Stat Height (in)" },
  { key: "statistical_height_delta", label: "Stat Height Delta (in)" },
  { key: "minutes_per_game", label: "Minutes/Game" },
  { key: "draft_pick", label: "Draft Pick" },
];

function normalizeClassValue(value: string): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (/fresh|frosh|\bfr\b|\brf\b/.test(raw)) return "Freshman";
  if (/soph|\bso\b/.test(raw)) return "Sophomore";
  if (/junior|\bjr\b/.test(raw)) return "Junior";
  if (/senior|\bsr\b|\bgr\b|graduate|\bgrad\b/.test(raw)) return "Senior";
  return String(value || "").trim();
}

function fmtNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function fmtPercentile(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value)}%tile`;
}

function percentileTone(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-zinc-500";
  if (value >= 75) return "text-emerald-400";
  if (value <= 25) return "text-rose-400";
  return "text-zinc-500";
}

function SortableHeader({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  className = "text-left",
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  label: string;
  sortKey: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: () => void;
}) {
  return (
    <th
      className={`cursor-pointer border-b border-zinc-700 p-2 ${className}`}
      onClick={() => onSort(sortKey)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      title={draggable ? "Drag to reorder column" : undefined}
    >
      {label}{sortBy === sortKey ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={null}>
      <LeaderboardPageInner />
    </Suspense>
  );
}

function LeaderboardPageInner() {
  const searchParams = useSearchParams();
  const [gender, setGender] = useState<"men" | "women">("men");
  const [season, setSeason] = useState<number | null>(2026);
  const [teamFilter, setTeamFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [conferenceFilter, setConferenceFilter] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [playerFilter, setPlayerFilter] = useState("");
  const [sortBy, setSortBy] = useState("bpm");
  const [sortMode, setSortMode] = useState<"stat" | "percentile">("stat");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<FilterRow[]>([
    { id: "f1", metric: "bpm", comparator: ">=", value: "", mode: "stat" },
  ]);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [conferences, setConferences] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<MetricMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [minMpg, setMinMpg] = useState(10);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null);

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
    const seasonParam = Number(searchParams.get("season"));
    if (Number.isFinite(seasonParam) && seasonParam > 2000) {
      setSeason(seasonParam);
    } else if (String(searchParams.get("season") || "").trim().toLowerCase() === "all") {
      setSeason(null);
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender,
            season,
            team: teamFilter,
            position: positionFilter,
            conference: conferenceFilter === "All" ? "" : conferenceFilter,
            player: playerFilter,
            sortBy,
            sortMode,
            sortDir,
            limit: 750,
            minMpg,
            filters: filters
              .filter((filter) => filter.metric && filter.value.trim() !== "")
              .map((filter) => ({
                metric: filter.metric,
                comparator: filter.comparator,
                value: Number(filter.value),
                mode: filter.mode,
              })),
          }),
          cache: "no-store",
        });
        const data = (await res.json()) as ApiResp;
        if (!active) return;
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load leaderboard");
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setTeams(Array.isArray(data.teams) ? data.teams : []);
        setPositions(Array.isArray(data.positions) ? data.positions : []);
        setConferences(Array.isArray(data.conferences) ? data.conferences : []);
        setMetrics(Array.isArray(data.metrics) ? data.metrics : []);
        setTotal(Number(data.total ?? 0));
        setMinMpg(Number(data.minMpg ?? 10));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load leaderboard");
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [conferenceFilter, filters, gender, minMpg, playerFilter, positionFilter, season, sortBy, sortDir, sortMode, teamFilter]);

  const metricOptions = useMemo(() => metrics.length ? metrics : [{ key: "bpm", label: "BPM" }], [metrics]);
  const metricKeys = useMemo(() => new Set(metricOptions.map((metric) => metric.key)), [metricOptions]);
  const filterMetricOptions = useMemo<OptionItem[]>(() => {
    const seen = new Set<string>();
    const out: OptionItem[] = [];
    for (const option of [...SPECIAL_FILTER_OPTIONS, ...metricOptions]) {
      if (seen.has(option.key)) continue;
      seen.add(option.key);
      out.push(option);
    }
    return out;
  }, [metricOptions]);
  const filterMetricKeys = useMemo(() => new Set(filterMetricOptions.map((metric) => metric.key)), [filterMetricOptions]);
  const conferenceOptions = useMemo(() => {
    const seen = new Set<string>(CONFERENCE_OPTIONS_BASE as readonly string[]);
    const out: string[] = [...CONFERENCE_OPTIONS_BASE];
    for (const conference of conferences) {
      const value = String(conference || "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
    return out;
  }, [conferences]);

  useEffect(() => {
    const defaultOrder = [
      ...BASE_COLUMNS.map((column) => column.key),
      ...metricOptions.map((metric) => `metric:${metric.key}`),
    ];
    setColumnOrder((current) => {
      if (!current.length) return defaultOrder;
      const currentSet = new Set(current);
      const next = current.filter((key) => defaultOrder.includes(key));
      for (const key of defaultOrder) {
        if (!currentSet.has(key)) next.push(key);
      }
      return next;
    });
  }, [metricOptions]);

  const displayColumns = useMemo<DisplayColumn[]>(() => {
    const baseMap = new Map(BASE_COLUMNS.map((column) => [column.key, column]));
    const metricMap = new Map(metricOptions.map((metric) => [`metric:${metric.key}`, metric]));

    const cols: DisplayColumn[] = [];
    for (const key of columnOrder) {
      const base = baseMap.get(key as BaseColumnKey);
      if (base) {
        cols.push({ kind: "base", ...base });
        continue;
      }
      const metric = metricMap.get(key);
      if (metric) {
        cols.push({
          kind: "metric",
          key: `metric:${metric.key}` as const,
          label: metric.label,
          sortKey: metric.key,
          align: "center",
          metricKey: metric.key,
        });
      }
    }
    return cols;
  }, [columnOrder, metricOptions]);

  const filteredRows = useMemo(() => {
    if (classFilter === "All") return rows;
    return rows.filter((row) => normalizeClassValue(row.class) === classFilter);
  }, [rows, classFilter]);

  const onSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(key);
    setSortDir("desc");
    setSortMode("stat");
  };

  const reorderColumns = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(sourceKey);
      const targetIndex = current.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const navSeason = season || 2026;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href={`/cards?gender=${gender}`} className="text-zinc-300">Player Profiles</Link>
            <Link href={`/roster?gender=${gender}`} className="text-zinc-300">Roster Construction</Link>
            <Link href={`/transfer-grades?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Transfer Grades</Link>
            <Link href={`/jason-created-stats?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Jason Created Stats</Link>
            <Link href={`/leaderboard?gender=${gender}&season=${navSeason}`} className="text-red-400">Leaderboard</Link>
            <Link href={`/lineup-analysis`} className="text-zinc-300">Lineups</Link>
            <Link href={`/watchlist?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Watchlist</Link>
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Player Leaderboard</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-8">
            <select
              className="rounded bg-zinc-800 p-2"
              value={season == null ? "" : String(season)}
              onChange={(e) => setSeason(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">All</option>
              {SEASONS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              {CLASS_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input className="rounded bg-zinc-800 p-2" placeholder="Filter team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} list="leaderboard-teams" />
            <input className="rounded bg-zinc-800 p-2" placeholder="Filter player" value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} />
            <input className="rounded bg-zinc-800 p-2" placeholder="Filter position" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} list="leaderboard-positions" />
            <select className="rounded bg-zinc-800 p-2" value={conferenceFilter} onChange={(e) => setConferenceFilter(e.target.value)}>
              {conferenceOptions.map((conference) => <option key={conference} value={conference}>{conference}</option>)}
            </select>
            <div className="flex items-center gap-2 rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
              <span className="whitespace-nowrap text-zinc-400">Min MPG</span>
              <input
                type="number"
                min={0}
                step="0.5"
                className="w-full rounded bg-zinc-900 px-2 py-1 text-zinc-100"
                value={Number.isFinite(minMpg) ? String(minMpg) : "0"}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setMinMpg(Number.isFinite(next) && next >= 0 ? next : 0);
                }}
              />
            </div>
            <div className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-400">
              {loading ? "Loading..." : `${filteredRows.length} shown / ${total} matched`}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">Tip: click a column header to sort and drag headers (except Player) to reorder.</div>
            <button
              type="button"
              className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-300"
              onClick={() =>
                setFilters((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    metric: filterMetricKeys.has(sortBy) ? sortBy : filterMetricOptions[0]?.key ?? "bpm",
                    comparator: ">=",
                    value: "",
                    mode: metricKeys.has(sortBy) ? sortMode : "stat",
                  },
                ])
              }
            >
              Add Filter
            </button>
          </div>

          {filters.length ? (
            <div className="mt-2 grid grid-cols-1 gap-2">
              {filters.map((filter) => (
                <div key={filter.id} className="grid grid-cols-1 gap-2 rounded border border-zinc-700 bg-zinc-950 p-2 md:grid-cols-5">
                  <select
                    className="rounded bg-zinc-800 p-2"
                    value={filter.metric}
                    onChange={(e) =>
                      setFilters((current) =>
                        current.map((row) =>
                          row.id === filter.id
                            ? {
                                ...row,
                                metric: e.target.value,
                                mode: metricKeys.has(e.target.value) ? row.mode : "stat",
                              }
                            : row,
                        ),
                      )
                    }
                  >
                    {filterMetricOptions.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
                  </select>
                  <select
                    className="rounded bg-zinc-800 p-2"
                    value={filter.mode}
                    disabled={!metricKeys.has(filter.metric)}
                    onChange={(e) =>
                      setFilters((current) =>
                        current.map((row) =>
                          row.id === filter.id
                            ? {
                                ...row,
                                mode:
                                  e.target.value === "percentile" && metricKeys.has(row.metric)
                                    ? "percentile"
                                    : "stat",
                              }
                            : row,
                        ),
                      )
                    }
                  >
                    <option value="stat">Stat</option>
                    <option value="percentile">Percentile</option>
                  </select>
                  <select
                    className="rounded bg-zinc-800 p-2"
                    value={filter.comparator}
                    onChange={(e) =>
                      setFilters((current) =>
                        current.map((row) => (row.id === filter.id ? { ...row, comparator: e.target.value === "<=" ? "<=" : ">=" } : row)),
                      )
                    }
                  >
                    <option value=">=">≥</option>
                    <option value="<=">≤</option>
                  </select>
                  <input
                    className="rounded bg-zinc-800 p-2"
                    placeholder={filter.mode === "percentile" ? "e.g. 80" : "e.g. 10"}
                    value={filter.value}
                    onChange={(e) =>
                      setFilters((current) =>
                        current.map((row) => (row.id === filter.id ? { ...row, value: e.target.value } : row)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="rounded bg-zinc-800 p-2 text-sm text-zinc-300"
                    onClick={() => setFilters((current) => current.filter((row) => row.id !== filter.id))}
                  >
                    Remove Filter
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

          <datalist id="leaderboard-teams">
            {teams.map((team) => <option key={team} value={team} />)}
          </datalist>
          <datalist id="leaderboard-positions">
            {positions.map((position) => <option key={position} value={position} />)}
          </datalist>
        </div>

        <div className="overflow-auto rounded-xl border border-zinc-700 bg-zinc-900">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-800 text-zinc-100">
                <SortableHeader label="Player" sortKey="player" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="sticky left-0 z-20 bg-zinc-800 text-left" />
                {displayColumns.map((column) => (
                  <SortableHeader
                    key={column.key}
                    label={column.label}
                    sortKey={column.sortKey}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                    className={column.align === "center" ? "text-center" : "text-left"}
                    draggable
                    onDragStart={() => setDraggingColumn(column.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!draggingColumn) return;
                      reorderColumns(draggingColumn, column.key);
                      setDraggingColumn(null);
                    }}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={`${row.season}:${row.team}:${row.player}`} className="border-b border-zinc-800 align-top">
                  <td className="sticky left-0 z-10 bg-zinc-900 p-2 font-medium">{row.player}</td>
                  {displayColumns.map((column) => {
                    if (column.key === "team") return <td key={column.key} className="p-2">{row.team}</td>;
                    if (column.key === "class") return <td key={column.key} className="p-2">{row.class || "N/A"}</td>;
                    if (column.key === "pos") return <td key={column.key} className="p-2">{row.pos || "N/A"}</td>;
                    if (column.key === "height") return <td key={column.key} className="p-2">{row.height || "N/A"}</td>;
                    if (column.key === "statistical_height") {
                      return (
                        <td key={column.key} className="p-2">
                          <div>{row.statistical_height || "N/A"}</div>
                          {typeof row.statistical_height_delta === "number" ? (
                            <div className={`text-xs ${row.statistical_height_delta > 0 ? "text-emerald-400" : row.statistical_height_delta < 0 ? "text-rose-400" : "text-zinc-500"}`}>
                              {row.statistical_height_delta > 0 ? "+" : ""}
                              {row.statistical_height_delta.toFixed(1)} in
                            </div>
                          ) : null}
                        </td>
                      );
                    }
                    if (column.key === "age") return <td key={column.key} className="p-2">{fmtNumber(row.age)}</td>;
                    if (column.key === "rsci") return <td key={column.key} className="p-2">{fmtNumber(row.rsci)}</td>;

                    if (column.kind !== "metric") return null;
                    return (
                      <td key={column.key} className="min-w-[84px] p-2 text-center">
                        <div>{fmtNumber(row.values?.[column.metricKey])}</div>
                        <div className={`text-xs ${percentileTone(row.percentiles?.[column.metricKey])}`}>
                          {fmtPercentile(row.percentiles?.[column.metricKey])}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
