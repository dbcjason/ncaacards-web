"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { seasonsForGender } from "@/lib/ui-options";

type MetricMeta = {
  key: string;
  label: string;
};

type FilterFieldMeta = {
  key: string;
  label: string;
  supportsPercentile: boolean;
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

const PER_GAME_KEYS = ["ppg", "rpg", "apg", "spg", "bpg"] as const;
const OFFENSE_KEYS = [
  "usg",
  "fg_pct",
  "ts_pct",
  "twop_pct",
  "rim_pct",
  "rim_att_100",
  "dunks_100",
  "mid_pct",
  "tp_pct",
  "tpa_100",
  "ftr",
  "ast_pct",
  "rim_assts_100",
  "ato",
  "to_pct",
] as const;
const SELF_CREATION_KEYS = [
  "uasst_dunks_100",
  "uasst_rim_fgm_100",
  "uasst_mid_fgm_100",
  "uasst_3pm_100",
  "unassisted_pts_100",
] as const;
const DEF_REB_KEYS = ["stl_pct", "blk_pct", "oreb_pct", "dreb_pct"] as const;
const IMPACT_KEYS = ["bpm", "rapm", "obpm", "dbpm", "net_points", "onoff_net"] as const;
const JASON_KEYS = [
  "feel_plus",
  "poss_created_100",
  "rimfluence",
  "rimfluence_off",
  "rimfluence_def",
] as const;
const POSITION_FILTER_OPTIONS = ["PG", "SG", "SF", "PF", "C"] as const;
const WOMEN_HIDDEN_METRICS = new Set(["uasst_dunks_100"]);

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

function normalizeClassLabel(raw: string | null | undefined): string {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "N/A";
  if (text === "fr" || text.includes("fresh")) return "Fr";
  if (text === "so" || text.includes("soph")) return "So";
  if (text === "jr" || text.includes("jun")) return "Jr";
  if (text === "sr" || text.includes("sen")) return "Sr";
  return "N/A";
}

function SortableHeader({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  className = "text-left",
}: {
  label: string;
  sortKey: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}) {
  return (
    <th
      className={`cursor-pointer border-b border-zinc-700 p-2 ${className}`}
      onClick={() => onSort(sortKey)}
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
  const [season, setSeason] = useState<string>("2026");
  const [teamFilter, setTeamFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [conferenceFilter, setConferenceFilter] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [sortBy, setSortBy] = useState("ppg");
  const [sortMode, setSortMode] = useState<"stat" | "percentile">("stat");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<FilterRow[]>([
    { id: "f1", metric: "ppg", comparator: ">=", value: "", mode: "stat" },
  ]);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [conferences, setConferences] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<MetricMeta[]>([]);
  const [error, setError] = useState("");
  const [minMpg, setMinMpg] = useState(10);
  const [draftedPlus2026Only, setDraftedPlus2026Only] = useState(false);

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
    const seasonRaw = String(searchParams.get("season") || "").trim().toLowerCase();
    if (seasonRaw === "all") {
      setSeason("all");
      return;
    }
    const seasonParam = Number(seasonRaw);
    if (Number.isFinite(seasonParam) && seasonParam > 2000) {
      setSeason(String(seasonParam));
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setError("");
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender,
            season: season === "all" ? null : Number(season),
            team: teamFilter,
            position: positionFilter,
            conference: conferenceFilter,
            player: playerFilter,
            sortBy,
            sortMode,
            sortDir,
            limit: season === "all" ? 20000 : 750,
            minMpg,
            draftedPlus2026: season === "all" && draftedPlus2026Only,
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
        setConferences(Array.isArray(data.conferences) ? data.conferences : []);
        setMetrics(Array.isArray(data.metrics) ? data.metrics : []);
        setMinMpg(Number(data.minMpg ?? 10));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load leaderboard");
        setRows([]);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [conferenceFilter, draftedPlus2026Only, filters, gender, minMpg, playerFilter, positionFilter, season, sortBy, sortDir, sortMode, teamFilter]);

  const metricOptions = useMemo(
    () =>
      (metrics.length ? metrics : [{ key: "bpm", label: "BPM" }]).filter(
        (metric) => !(gender === "women" && WOMEN_HIDDEN_METRICS.has(metric.key)),
      ),
    [gender, metrics],
  );
  const conferenceOptions = useMemo(() => {
    const sorted = [...conferences].sort((a, b) => a.localeCompare(b));
    const withoutSpecial = sorted.filter(
      (conference) =>
        !["All", "High Major", "Mid/Low Major"].includes(conference),
    );
    return ["All", "High Major", "Mid/Low Major", ...withoutSpecial];
  }, [conferences]);
  const seasonOptions = useMemo(() => seasonsForGender(gender), [gender]);
  useEffect(() => {
    if (season === "all") return;
    const seasonNum = Number(season);
    if (!Number.isFinite(seasonNum) || !seasonOptions.includes(seasonNum)) {
      setSeason(String(seasonOptions[0] ?? 2026));
    }
  }, [season, seasonOptions]);
  useEffect(() => {
    if (season !== "all" && draftedPlus2026Only) {
      setDraftedPlus2026Only(false);
    }
  }, [draftedPlus2026Only, season]);
  const filterFieldOptions = useMemo<FilterFieldMeta[]>(
    () => [
      ...(gender === "women" ? [] : [{ key: "age", label: "Age", supportsPercentile: false }]),
      { key: "rsci", label: "RSCI", supportsPercentile: false },
      { key: "draft_pick", label: "Draft Pick", supportsPercentile: false },
      ...metricOptions.map((metric) => ({ key: metric.key, label: metric.label, supportsPercentile: true })),
    ],
    [gender, metricOptions],
  );
  const perGameCols = useMemo(
    () => metricOptions.filter((metric) => PER_GAME_KEYS.includes(metric.key as (typeof PER_GAME_KEYS)[number])).length,
    [metricOptions],
  );
  const offenseCols = useMemo(
    () => metricOptions.filter((metric) => OFFENSE_KEYS.includes(metric.key as (typeof OFFENSE_KEYS)[number])).length,
    [metricOptions],
  );
  const selfCreationCols = useMemo(
    () =>
      metricOptions.filter((metric) => SELF_CREATION_KEYS.includes(metric.key as (typeof SELF_CREATION_KEYS)[number]))
        .length,
    [metricOptions],
  );
  const defenseRebCols = useMemo(
    () => metricOptions.filter((metric) => DEF_REB_KEYS.includes(metric.key as (typeof DEF_REB_KEYS)[number])).length,
    [metricOptions],
  );
  const impactCols = useMemo(
    () => metricOptions.filter((metric) => IMPACT_KEYS.includes(metric.key as (typeof IMPACT_KEYS)[number])).length,
    [metricOptions],
  );
  const jasonCols = useMemo(
    () => metricOptions.filter((metric) => JASON_KEYS.includes(metric.key as (typeof JASON_KEYS)[number])).length,
    [metricOptions],
  );
  const onSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(key);
    setSortDir("desc");
    if (metricOptions.some((metric) => metric.key === key)) {
      setSortMode("stat");
    }
  };

  const navSeason = Number(season) || 2026;
  const showAge = gender !== "women";
  const showClass = gender === "women";
  const bioColCount = 7 + (showAge ? 1 : 0) + (showClass ? 1 : 0);

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
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Player Leaderboard</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
            <select className="rounded bg-zinc-800 p-2" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="all">All</option>
              {seasonOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <input className="rounded bg-zinc-800 p-2" placeholder="Filter team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} list="leaderboard-teams" />
            <input className="rounded bg-zinc-800 p-2" placeholder="Filter player" value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} />
            <select className="rounded bg-zinc-800 p-2" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
              <option value="">All Positions</option>
              {POSITION_FILTER_OPTIONS.map((position) => <option key={position} value={position}>{position}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={conferenceFilter} onChange={(e) => setConferenceFilter(e.target.value)}>
              {conferenceOptions.map((conference) => <option key={conference} value={conference}>{conference}</option>)}
            </select>
            <div className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
              {season === "all" ? (
                <label className="mb-2 flex items-center gap-2 text-zinc-200">
                  <input
                    type="checkbox"
                    checked={draftedPlus2026Only}
                    onChange={(e) => setDraftedPlus2026Only(e.target.checked)}
                  />
                  Drafted + 2026
                </label>
              ) : null}
              <label className="mr-2 text-zinc-400">Min MPG</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="w-20 rounded bg-zinc-900 px-2 py-1 text-zinc-100"
                value={Number.isFinite(minMpg) ? minMpg : 10}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setMinMpg(Number.isFinite(value) ? Math.max(0, value) : 10);
                }}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <select className="rounded bg-zinc-800 p-2" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {metricOptions.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={sortMode} onChange={(e) => setSortMode(e.target.value === "percentile" ? "percentile" : "stat")}>
              <option value="stat">Sort by Stat</option>
              <option value="percentile">Sort by Percentile</option>
            </select>
            <select className="rounded bg-zinc-800 p-2" value={sortDir} onChange={(e) => setSortDir(e.target.value === "asc" ? "asc" : "desc")}>
              <option value="desc">High to Low</option>
              <option value="asc">Low to High</option>
            </select>
            <button
              type="button"
              className="rounded bg-zinc-800 p-2 text-left text-sm text-zinc-300"
              onClick={() =>
                setFilters((current) => [
                  ...current,
                  { id: crypto.randomUUID(), metric: sortBy, comparator: ">=", value: "", mode: sortMode },
                ])
              }
            >
              Add Filter
            </button>
          </div>

          {filters.length ? (
            <div className="mt-3 grid grid-cols-1 gap-2">
              {filters.map((filter) => (
                <div key={filter.id} className="grid grid-cols-1 gap-2 rounded border border-zinc-700 bg-zinc-950 p-2 md:grid-cols-5">
                  <select
                    className="rounded bg-zinc-800 p-2"
                    value={filter.metric}
                    onChange={(e) =>
                      setFilters((current) =>
                        current.map((row) => {
                          if (row.id !== filter.id) return row;
                          const selected = filterFieldOptions.find((field) => field.key === e.target.value);
                          const mode =
                            selected?.supportsPercentile === false ? "stat" : row.mode;
                          return { ...row, metric: e.target.value, mode };
                        }),
                      )
                    }
                  >
                    {filterFieldOptions.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                  </select>
                  <select
                    className="rounded bg-zinc-800 p-2"
                    value={filter.mode}
                    disabled={filter.metric === "age" || filter.metric === "rsci" || filter.metric === "draft_pick"}
                    onChange={(e) =>
                      setFilters((current) =>
                        current.map((row) =>
                          row.id === filter.id ? { ...row, mode: e.target.value === "percentile" ? "percentile" : "stat" } : row,
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
          <datalist id="leaderboard-conferences">
            {conferences.map((conference) => <option key={conference} value={conference} />)}
          </datalist>
        </div>

        <div className="overflow-auto rounded-xl border border-zinc-700 bg-zinc-900">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-900 text-white">
                <th colSpan={bioColCount} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                  Bio
                </th>
                {perGameCols ? (
                  <th colSpan={perGameCols} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                    Per Game
                  </th>
                ) : null}
                {offenseCols ? (
                  <th colSpan={offenseCols} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                    Offense
                  </th>
                ) : null}
                {selfCreationCols ? (
                  <th colSpan={selfCreationCols} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                    Self-Creation
                  </th>
                ) : null}
                {defenseRebCols ? (
                  <th colSpan={defenseRebCols} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                    Defense and Rebounding
                  </th>
                ) : null}
                {impactCols ? (
                  <th colSpan={impactCols} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                    Impact
                  </th>
                ) : null}
                {jasonCols ? (
                  <th colSpan={jasonCols} className="border-b border-zinc-700 p-2 text-center text-xs font-bold uppercase tracking-wide">
                    Jason Created Stats
                  </th>
                ) : null}
              </tr>
              <tr className="bg-zinc-800 text-zinc-100">
                <SortableHeader label="Year" sortKey="season" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="sticky left-0 z-30 min-w-[76px] bg-zinc-800 text-left" />
                <SortableHeader label="Player" sortKey="player" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="sticky left-[76px] z-30 min-w-[210px] bg-zinc-800 text-left" />
                <SortableHeader label="Team" sortKey="team" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left" />
                <SortableHeader label="Pos" sortKey="pos" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left" />
                <SortableHeader label="Height" sortKey="height" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left" />
                <SortableHeader label="Stat Height" sortKey="statistical_height" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left" />
                {showAge ? (
                  <SortableHeader label="Age" sortKey="age" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left" />
                ) : null}
                <SortableHeader label="RSCI" sortKey="rsci" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left" />
                {showClass ? <th className="border-b border-zinc-700 p-2 text-left">Class</th> : null}
                {metricOptions.map((metric) => (
                  <SortableHeader
                    key={metric.key}
                    label={metric.label}
                    sortKey={metric.key}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="text-center"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.season}:${row.team}:${row.player}`} className="border-b border-zinc-800 align-top">
                  <td className="sticky left-0 z-20 min-w-[76px] bg-zinc-900 p-2">{row.season}</td>
                  <td className="sticky left-[76px] z-20 min-w-[210px] bg-zinc-900 p-2 font-medium">{row.player}</td>
                  <td className="p-2">{row.team}</td>
                  <td className="p-2">{row.pos || "N/A"}</td>
                  <td className="p-2">{row.height || "N/A"}</td>
                  <td className="p-2">
                    <div>{row.statistical_height || "N/A"}</div>
                    {typeof row.statistical_height_delta === "number" ? (
                      <div className={`text-xs ${row.statistical_height_delta > 0 ? "text-emerald-400" : row.statistical_height_delta < 0 ? "text-rose-400" : "text-zinc-500"}`}>
                        {row.statistical_height_delta > 0 ? "+" : ""}
                        {row.statistical_height_delta.toFixed(1)} in
                      </div>
                    ) : null}
                  </td>
                  {showAge ? <td className="p-2">{fmtNumber(row.age)}</td> : null}
                  <td className="p-2">{typeof row.rsci === "number" ? row.rsci : "UR"}</td>
                  {showClass ? <td className="p-2">{normalizeClassLabel(row.class)}</td> : null}
                  {metricOptions.map((metric) => (
                    <td key={metric.key} className="min-w-[84px] p-2 text-center">
                      <div>{fmtNumber(row.values?.[metric.key])}</div>
                      <div className={`text-xs ${percentileTone(row.percentiles?.[metric.key])}`}>
                        {fmtPercentile(row.percentiles?.[metric.key])}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
