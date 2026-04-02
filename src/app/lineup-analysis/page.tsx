"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DUKE_EXAMPLE_LINEUPS,
  DUKE_EXAMPLE_PLAYERS,
  DUKE_EXAMPLE_SEASON,
  DUKE_EXAMPLE_TEAM,
  type DukeExampleLineup,
} from "@/lib/lineup-analysis-example";

type AggregateStats = {
  minutes: number;
  possessions: number;
  pointsFor: number;
  pointsAgainst: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  offRtg: number;
  defRtg: number;
  netRtg: number;
  fgPct: number;
  threePct: number;
};

function aggregateLineups(lineups: DukeExampleLineup[]): AggregateStats {
  const totals = lineups.reduce(
    (acc, row) => {
      acc.minutes += row.minutes;
      acc.possessions += row.possessions;
      acc.pointsFor += row.pointsFor;
      acc.pointsAgainst += row.pointsAgainst;
      acc.fgm += row.fgm;
      acc.fga += row.fga;
      acc.tpm += row.tpm;
      acc.tpa += row.tpa;
      return acc;
    },
    {
      minutes: 0,
      possessions: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      fgm: 0,
      fga: 0,
      tpm: 0,
      tpa: 0,
    },
  );

  const offRtg = totals.possessions > 0 ? (totals.pointsFor * 100) / totals.possessions : 0;
  const defRtg = totals.possessions > 0 ? (totals.pointsAgainst * 100) / totals.possessions : 0;
  const fgPct = totals.fga > 0 ? (totals.fgm * 100) / totals.fga : 0;
  const threePct = totals.tpa > 0 ? (totals.tpm * 100) / totals.tpa : 0;

  return {
    ...totals,
    offRtg,
    defRtg,
    netRtg: offRtg - defRtg,
    fgPct,
    threePct,
  };
}

function fmtNum(n: number, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : "0.0";
}

function lineupLabel(players: string[]) {
  return players.join(" • ");
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

export default function LineupAnalysisPage() {
  const [season, setSeason] = useState(DUKE_EXAMPLE_SEASON);
  const [team, setTeam] = useState(DUKE_EXAMPLE_TEAM);
  const [onPlayers, setOnPlayers] = useState<string[]>(["Cooper Flagg"]);
  const [offPlayers, setOffPlayers] = useState<string[]>([]);
  const [addOnSearch, setAddOnSearch] = useState("");
  const [addOffSearch, setAddOffSearch] = useState("");
  const [onPick, setOnPick] = useState("");
  const [offPick, setOffPick] = useState("");

  const onOptions = useMemo(() => {
    const used = new Set([...onPlayers, ...offPlayers]);
    const needle = addOnSearch.trim().toLowerCase();
    return DUKE_EXAMPLE_PLAYERS.filter((player) => {
      if (used.has(player)) return false;
      if (!needle) return true;
      return player.toLowerCase().includes(needle);
    });
  }, [onPlayers, offPlayers, addOnSearch]);

  const offOptions = useMemo(() => {
    const used = new Set([...onPlayers, ...offPlayers]);
    const needle = addOffSearch.trim().toLowerCase();
    return DUKE_EXAMPLE_PLAYERS.filter((player) => {
      if (used.has(player)) return false;
      if (!needle) return true;
      return player.toLowerCase().includes(needle);
    });
  }, [onPlayers, offPlayers, addOffSearch]);

  const playerOnOffRows = useMemo(() => {
    return DUKE_EXAMPLE_PLAYERS.map((player) => {
      const on = DUKE_EXAMPLE_LINEUPS.filter((row) => row.players.includes(player));
      const off = DUKE_EXAMPLE_LINEUPS.filter((row) => !row.players.includes(player));
      return {
        player,
        on: aggregateLineups(on),
        off: aggregateLineups(off),
      };
    }).sort((a, b) => b.on.minutes - a.on.minutes);
  }, []);

  const wowyLineups = useMemo(() => {
    return DUKE_EXAMPLE_LINEUPS.filter((row) => {
      const hasAllOn = onPlayers.every((player) => row.players.includes(player));
      const hasNoOff = offPlayers.every((player) => !row.players.includes(player));
      return hasAllOn && hasNoOff;
    });
  }, [onPlayers, offPlayers]);

  const wowyStats = useMemo(() => aggregateLineups(wowyLineups), [wowyLineups]);

  const allLineups = useMemo(() => {
    return [...DUKE_EXAMPLE_LINEUPS]
      .sort((a, b) => b.minutes - a.minutes)
      .map((row) => ({ ...row, stats: aggregateLineups([row]) }));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href="/cards?gender=men" className="text-zinc-300">Player Profiles</Link>
            <Link href="/roster?gender=men" className="text-zinc-300">Roster Construction</Link>
            <Link href="/transfer-grades?gender=men&season=2026" className="text-zinc-300">Transfer Grades</Link>
            <Link href="/jason-created-stats?gender=men&season=2026" className="text-zinc-300">Jason Created Stats</Link>
            <Link href="/lineup-analysis" className="text-red-400">Lineup Analysis</Link>
          </div>
          <Link href="/?gender=men" className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
          <div className="text-lg font-bold">Lineup Analysis</div>
          <div className="mt-1 text-sm text-zinc-400">
            Interactive lineup tools built in the men&apos;s site style, with roster-construction style controls for filtering team and season context.
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <select className="rounded bg-zinc-800 p-3" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value={DUKE_EXAMPLE_SEASON}>{DUKE_EXAMPLE_SEASON}</option>
            </select>
            <select className="rounded bg-zinc-800 p-3" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value={DUKE_EXAMPLE_TEAM}>{DUKE_EXAMPLE_TEAM}</option>
            </select>
            <div className="rounded bg-zinc-800 px-3 py-3 text-sm text-zinc-400 md:col-span-2">
              Use the filters to move through lineup views by season and team, then drill into on/off impact, WOWY combinations, and five-man units.
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-3 text-lg font-bold">Player On/Off</div>
            <div className="overflow-auto rounded-lg border border-zinc-800">
              <table className="w-max min-w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-zinc-800 text-zinc-100">
                    <th className="border-b border-zinc-700 p-2 text-left">Player</th>
                    <th className="border-b border-zinc-700 p-2 text-center">On Min</th>
                    <th className="border-b border-zinc-700 p-2 text-center">On OffRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">On DefRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">On FG%</th>
                    <th className="border-b border-zinc-700 p-2 text-center">On 3P%</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Off Min</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Off OffRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Off DefRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Off FG%</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Off 3P%</th>
                  </tr>
                </thead>
                <tbody>
                  {playerOnOffRows.map((row) => (
                    <tr key={row.player} className="odd:bg-zinc-900 even:bg-zinc-950">
                      <td className="border-b border-zinc-800 p-2 text-left font-medium">{row.player}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.on.minutes)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.on.offRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.on.defRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.on.fgPct)}%</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.on.threePct)}%</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.off.minutes)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.off.offRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.off.defRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.off.fgPct)}%</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.off.threePct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-3 text-lg font-bold">WOWY Explorer</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="flex gap-2">
                <div className="w-full space-y-2">
                  <input
                    className="w-full rounded bg-zinc-800 p-2 text-sm"
                    placeholder="Search player"
                    value={addOnSearch}
                    onChange={(e) => setAddOnSearch(e.target.value)}
                  />
                  <select className="w-full rounded bg-zinc-800 p-3" value={onPick} onChange={(e) => setOnPick(e.target.value)}>
                    <option value="">Select player to force ON</option>
                    {onOptions.map((player) => <option key={player} value={player}>{player}</option>)}
                  </select>
                </div>
                <button
                  className="rounded bg-emerald-700 px-3 py-2 text-sm"
                  type="button"
                  onClick={() => {
                    if (!onPick) return;
                    setOnPlayers((prev) => [...prev, onPick]);
                    setOnPick("");
                    setAddOnSearch("");
                  }}
                >
                  Add
                </button>
              </div>

              <div className="flex gap-2">
                <div className="w-full space-y-2">
                  <input
                    className="w-full rounded bg-zinc-800 p-2 text-sm"
                    placeholder="Search player"
                    value={addOffSearch}
                    onChange={(e) => setAddOffSearch(e.target.value)}
                  />
                  <select className="w-full rounded bg-zinc-800 p-3" value={offPick} onChange={(e) => setOffPick(e.target.value)}>
                    <option value="">Select player to force OFF</option>
                    {offOptions.map((player) => <option key={player} value={player}>{player}</option>)}
                  </select>
                </div>
                <button
                  className="rounded bg-rose-700 px-3 py-2 text-sm"
                  type="button"
                  onClick={() => {
                    if (!offPick) return;
                    setOffPlayers((prev) => [...prev, offPick]);
                    setOffPick("");
                    setAddOffSearch("");
                  }}
                >
                  Add
                </button>
              </div>

              <div className="rounded bg-zinc-950/60 p-3 md:col-span-2">
                <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Current WOWY Filters</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">On</div>
                    <div className="flex flex-wrap gap-2">
                      {onPlayers.map((player) => (
                        <button
                          key={player}
                          type="button"
                          className="rounded bg-emerald-700 px-2 py-1 text-xs"
                          onClick={() => setOnPlayers((prev) => prev.filter((x) => x !== player))}
                        >
                          {player} ×
                        </button>
                      ))}
                      {!onPlayers.length && <span className="text-sm text-zinc-500">No required on-players</span>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">Off</div>
                    <div className="flex flex-wrap gap-2">
                      {offPlayers.map((player) => (
                        <button
                          key={player}
                          type="button"
                          className="rounded bg-rose-700 px-2 py-1 text-xs"
                          onClick={() => setOffPlayers((prev) => prev.filter((x) => x !== player))}
                        >
                          {player} ×
                        </button>
                      ))}
                      {!offPlayers.length && <span className="text-sm text-zinc-500">No required off-players</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-6">
              <StatCell label="Matching Lineups" value={String(wowyLineups.length)} />
              <StatCell label="Minutes" value={fmtNum(wowyStats.minutes)} />
              <StatCell label="OffRtg" value={fmtNum(wowyStats.offRtg)} />
              <StatCell label="DefRtg" value={fmtNum(wowyStats.defRtg)} />
              <StatCell label="FG%" value={`${fmtNum(wowyStats.fgPct)}%`} />
              <StatCell label="3P%" value={`${fmtNum(wowyStats.threePct)}%`} />
            </div>

            <div className="mt-4 overflow-auto rounded-lg border border-zinc-800">
              <table className="w-max min-w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-zinc-800 text-zinc-100">
                    <th className="border-b border-zinc-700 p-2 text-left">Matching 5-Man Lineup</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Min</th>
                    <th className="border-b border-zinc-700 p-2 text-center">OffRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">DefRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Net</th>
                    <th className="border-b border-zinc-700 p-2 text-center">FG%</th>
                    <th className="border-b border-zinc-700 p-2 text-center">3P%</th>
                  </tr>
                </thead>
                <tbody>
                  {wowyLineups.map((row) => {
                    const stats = aggregateLineups([row]);
                    return (
                      <tr key={row.id} className="odd:bg-zinc-900 even:bg-zinc-950">
                        <td className="border-b border-zinc-800 p-2 text-left">{lineupLabel([...row.players])}</td>
                        <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.minutes)}</td>
                        <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(stats.offRtg)}</td>
                        <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(stats.defRtg)}</td>
                        <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(stats.netRtg)}</td>
                        <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(stats.fgPct)}%</td>
                        <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(stats.threePct)}%</td>
                      </tr>
                    );
                  })}
                  {!wowyLineups.length && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-zinc-500">
                        No Duke example lineups match the current on/off filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-3 text-lg font-bold">Five-Man Lineups</div>
            <div className="max-h-[560px] overflow-auto rounded-lg border border-zinc-800">
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-zinc-800 text-zinc-100">
                    <th className="border-b border-zinc-700 p-2 text-left">Lineup</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Minutes</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Poss</th>
                    <th className="border-b border-zinc-700 p-2 text-center">OffRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">DefRtg</th>
                    <th className="border-b border-zinc-700 p-2 text-center">Net</th>
                    <th className="border-b border-zinc-700 p-2 text-center">FG%</th>
                    <th className="border-b border-zinc-700 p-2 text-center">3P%</th>
                  </tr>
                </thead>
                <tbody>
                  {allLineups.map((row) => (
                    <tr key={row.id} className="odd:bg-zinc-900 even:bg-zinc-950">
                      <td className="border-b border-zinc-800 p-2 text-left">{lineupLabel([...row.players])}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.minutes)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{row.possessions}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.stats.offRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.stats.defRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.stats.netRtg)}</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.stats.fgPct)}%</td>
                      <td className="border-b border-zinc-800 p-2 text-center">{fmtNum(row.stats.threePct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
