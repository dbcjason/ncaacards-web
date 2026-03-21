"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SEASONS } from "@/lib/ui-options";

type RosterMetric = {
  metric: string;
  current: number;
  edited: number;
  delta: number;
  current_rank?: number;
  edited_rank?: number;
  total_teams?: number;
};

type RosterResult = {
  cache?: string;
  source?: string;
  metrics?: RosterMetric[];
  activeRoster?: Array<{ player: string; mpg: number }>;
};

type TeamRosterResponse = {
  ok: boolean;
  error?: string;
  season?: number;
  team?: string;
  teams?: string[];
  roster?: Array<{ player: string; mpg: number }>;
  playerDefaults?: Record<string, number>;
};

export default function RosterPage() {
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("");
  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const [allPlayers, setAllPlayers] = useState<string[]>([]);
  const [playerDefaults, setPlayerDefaults] = useState<Record<string, number>>({});

  const [baseRoster, setBaseRoster] = useState<Array<{ player: string; mpg: number }>>([]);
  const [addPlayers, setAddPlayers] = useState<string[]>([]);
  const [removePlayers, setRemovePlayers] = useState<string[]>([]);
  const [rosterMinutes, setRosterMinutes] = useState<Record<string, string>>({});

  const [addSearch, setAddSearch] = useState("");
  const [removeSearch, setRemoveSearch] = useState("");
  const [addPick, setAddPick] = useState("");
  const [removePick, setRemovePick] = useState("");

  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RosterResult | null>(null);

  const activeRoster = useMemo(() => {
    const removed = new Set(removePlayers);
    const map = new Map<string, number>();

    for (const p of baseRoster) {
      if (removed.has(p.player)) continue;
      map.set(p.player, p.mpg);
    }
    for (const p of addPlayers) {
      if (!map.has(p)) map.set(p, playerDefaults[p] ?? 0);
    }

    return [...map.entries()]
      .map(([player, mpg]) => ({ player, mpg }))
      .sort((a, b) => b.mpg - a.mpg || a.player.localeCompare(b.player));
  }, [baseRoster, removePlayers, addPlayers, playerDefaults]);

  const addOptions = useMemo(() => {
    const activeSet = new Set(activeRoster.map((p) => p.player));
    const needle = addSearch.trim().toLowerCase();
    return allPlayers.filter((p) => {
      if (activeSet.has(p)) return false;
      if (!needle) return true;
      return p.toLowerCase().includes(needle);
    });
  }, [allPlayers, activeRoster, addSearch]);

  const removeOptions = useMemo(() => {
    const needle = removeSearch.trim().toLowerCase();
    return activeRoster
      .map((p) => p.player)
      .filter((p) => !removePlayers.includes(p))
      .filter((p) => (!needle ? true : p.toLowerCase().includes(needle)));
  }, [activeRoster, removePlayers, removeSearch]);

  function fmt(v: number | string | undefined) {
    if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(1) : "N/A";
    if (typeof v === "string" && v.trim() !== "") return v;
    return "N/A";
  }

  function rankText(m: RosterMetric, side: "current" | "edited") {
    const rank = side === "current" ? m.current_rank : m.edited_rank;
    const total = m.total_teams;
    if (typeof rank !== "number" || typeof total !== "number") return null;
    return `${rank}/${total}`;
  }

  function diffColor(m: RosterMetric) {
    const metric = (m.metric || "").toLowerCase();
    const lowerIsBetter = metric === "def rtg" || metric === "tov/100";
    if (m.delta > 0) return lowerIsBetter ? "text-rose-400" : "text-emerald-400";
    if (m.delta < 0) return lowerIsBetter ? "text-emerald-400" : "text-rose-400";
    return "text-zinc-300";
  }

  async function loadTeamRoster(nextSeason: number, nextTeam?: string) {
    setOptionsLoaded(false);
    setOptionsError("");
    const qs = new URLSearchParams({ season: String(nextSeason) });
    if (nextTeam) qs.set("team", nextTeam);

    const res = await fetch(`/api/roster-sim?${qs.toString()}`, { cache: "no-store" });
    const data = (await res.json()) as TeamRosterResponse;
    if (!data.ok) throw new Error(data.error || "Failed to load roster options");

    const teams = Array.isArray(data.teams) ? data.teams : [];
    const selectedTeam = (data.team ?? "").trim();
    const roster = Array.isArray(data.roster) ? data.roster : [];
    const defaults = (data.playerDefaults ?? {}) as Record<string, number>;

    setTeamOptions(teams);
    setTeam(selectedTeam);
    setPlayerDefaults(defaults);
    setAllPlayers(Object.keys(defaults).sort((a, b) => a.localeCompare(b)));
    setBaseRoster(roster);
    setAddPlayers([]);
    setRemovePlayers([]);
    setAddSearch("");
    setRemoveSearch("");
    setAddPick("");
    setRemovePick("");

    const mins: Record<string, string> = {};
    for (const p of roster) mins[p.player] = String(Number(p.mpg.toFixed(1)));
    setRosterMinutes(mins);

    setOptionsLoaded(true);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadTeamRoster(season);
      } catch (e) {
        if (!active) return;
        setOptionsError(e instanceof Error ? e.message : "Failed to load options");
      }
    })();
    return () => {
      active = false;
    };
  }, [season]);

  async function run() {
    if (!optionsLoaded || !team) return;

    setLoading(true);
    setResult(null);
    setMessage("Running live roster model");
    setProgress(5);

    const timer = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + 4));
    }, 180);

    try {
      const activeSet = new Set(activeRoster.map((p) => p.player));
      const minutesPayload: Record<string, number> = {};
      for (const [name, raw] of Object.entries(rosterMinutes)) {
        if (!activeSet.has(name)) continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) minutesPayload[name] = n;
      }

      const res = await fetch("/api/roster-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season,
          team,
          addPlayers,
          removePlayers,
          rosterMinutes: minutesPayload,
        }),
      });
      const data = (await res.json()) as RosterResult & { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Failed roster simulation");

      setResult(data);
      setMessage("Completed");
      setProgress(100);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Simulation failed");
      setProgress(100);
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href="/cards" className="text-zinc-300">Player Profiles</Link>
            <Link href="/roster" className="text-red-400">Roster Construction</Link>
          </div>
          <Link href="/" className="text-zinc-400">Home</Link>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <select
            className="rounded bg-zinc-900 p-3"
            value={optionsLoaded ? String(season) : "__loading_year__"}
            onChange={(e) => setSeason(Number(e.target.value))}
            disabled={!optionsLoaded}
          >
            {!optionsLoaded && <option value="__loading_year__">Year</option>}
            {optionsLoaded && SEASONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>

          <select
            className="rounded bg-zinc-900 p-3"
            value={optionsLoaded ? team : "__loading_team__"}
            onChange={async (e) => {
              const t = e.target.value;
              try {
                await loadTeamRoster(season, t);
              } catch (err) {
                setOptionsError(err instanceof Error ? err.message : "Failed to load team roster");
              }
            }}
            disabled={!optionsLoaded}
          >
            {!optionsLoaded && <option value="__loading_team__">Team</option>}
            {optionsLoaded && teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <div className="flex gap-2">
            <div className="w-full space-y-2">
              <input
                className="w-full rounded bg-zinc-900 p-2 text-sm"
                placeholder={optionsLoaded ? "Search player" : "Player"}
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                disabled={!optionsLoaded}
              />
              <select className="w-full rounded bg-zinc-900 p-3" value={addPick} onChange={(e) => setAddPick(e.target.value)} disabled={!optionsLoaded}>
                {!optionsLoaded && <option value="">Player</option>}
                {optionsLoaded && <option value="">Select player to add</option>}
                {optionsLoaded && addOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button
              className="rounded bg-zinc-700 px-3 py-2 text-sm"
              onClick={() => {
                const v = addPick.trim();
                if (!v || addPlayers.includes(v)) return;
                setAddPlayers((prev) => [...prev, v]);
                if (rosterMinutes[v] == null) {
                  const d = playerDefaults[v] ?? 0;
                  setRosterMinutes((prev) => ({ ...prev, [v]: String(Number(d.toFixed(1))) }));
                }
                setAddPick("");
              }}
              disabled={!optionsLoaded}
              type="button"
            >
              Add
            </button>
          </div>

          <div className="flex gap-2">
            <div className="w-full space-y-2">
              <input
                className="w-full rounded bg-zinc-900 p-2 text-sm"
                placeholder={optionsLoaded ? "Search player" : "Player"}
                value={removeSearch}
                onChange={(e) => setRemoveSearch(e.target.value)}
                disabled={!optionsLoaded}
              />
              <select className="w-full rounded bg-zinc-900 p-3" value={removePick} onChange={(e) => setRemovePick(e.target.value)} disabled={!optionsLoaded}>
                {!optionsLoaded && <option value="">Player</option>}
                {optionsLoaded && <option value="">Select player to remove</option>}
                {optionsLoaded && removeOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button
              className="rounded bg-zinc-700 px-3 py-2 text-sm"
              onClick={() => {
                const v = removePick.trim();
                if (!v || removePlayers.includes(v)) return;
                setRemovePlayers((prev) => [...prev, v]);
                setRemovePick("");
              }}
              disabled={!optionsLoaded}
              type="button"
            >
              Remove
            </button>
          </div>
        </div>

        {optionsError && <div className="mt-2 text-sm text-rose-400">Options error: {optionsError}</div>}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded bg-zinc-900 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">In</div>
            <div className="flex flex-wrap gap-2">
              {addPlayers.map((p) => (
                <button key={p} type="button" className="rounded bg-emerald-700 px-2 py-1 text-xs" onClick={() => setAddPlayers((prev) => prev.filter((x) => x !== p))}>
                  {p} ×
                </button>
              ))}
              {!addPlayers.length && <span className="text-sm text-zinc-500">No players added</span>}
            </div>
          </div>
          <div className="rounded bg-zinc-900 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Out</div>
            <div className="flex flex-wrap gap-2">
              {removePlayers.map((p) => (
                <button key={p} type="button" className="rounded bg-rose-700 px-2 py-1 text-xs" onClick={() => setRemovePlayers((prev) => prev.filter((x) => x !== p))}>
                  {p} ×
                </button>
              ))}
              {!removePlayers.length && <span className="text-sm text-zinc-500">No players removed</span>}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded bg-zinc-900 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Active Roster (editable MPG)</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {activeRoster.map((p) => (
              <label key={`active-${p.player}`} className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1 text-xs">
                <span className="mr-2 truncate">{p.player}</span>
                <span className="flex items-center gap-1">
                  <span className="text-zinc-400">MPG</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="w-16 rounded bg-zinc-900 px-1 py-0.5 text-right text-xs"
                    value={rosterMinutes[p.player] ?? String(Number(p.mpg.toFixed(1)))}
                    onChange={(e) => setRosterMinutes((prev) => ({ ...prev, [p.player]: e.target.value }))}
                  />
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <button className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={run} disabled={loading || !optionsLoaded}>
            {loading ? "Running..." : "Generate Team Fit Report"}
          </button>
        </div>

        {(loading || progress > 0) && (
          <div className="mt-4 rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
              <span>{message || "Working..."}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full rounded bg-zinc-800">
              <div className="h-2 rounded bg-red-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </div>
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {result.metrics?.map((m: RosterMetric) => {
                const curRank = rankText(m, "current");
                const newRank = rankText(m, "edited");
                return (
                  <div key={m.metric} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div className="text-xs uppercase tracking-wide text-zinc-400">{m.metric}</div>
                    <div className="mt-2 grid grid-cols-3 items-end gap-2 text-center">
                      <div>
                        <div className="text-[10px] text-zinc-500">Current Roster</div>
                        <div className="text-sm text-zinc-300">{fmt(m.current)}</div>
                        {curRank && <div className="text-[10px] text-zinc-500">{curRank}</div>}
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">New Roster</div>
                        <div className="text-sm text-zinc-100">{fmt(m.edited)}</div>
                        {newRank && <div className="text-[10px] text-zinc-500">{newRank}</div>}
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Diff</div>
                        <div className={`text-sm font-semibold ${diffColor(m)}`}>{m.delta >= 0 ? "+" : ""}{fmt(m.delta)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
