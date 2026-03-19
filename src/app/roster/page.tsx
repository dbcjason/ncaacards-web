"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export default function RosterPage() {
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("UCLA");
  const [inText, setInText] = useState("Player A, Player B");
  const [outText, setOutText] = useState("Player C");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const addPlayers = useMemo(
    () => inText.split(",").map((s) => s.trim()).filter(Boolean),
    [inText],
  );
  const removePlayers = useMemo(
    () => outText.split(",").map((s) => s.trim()).filter(Boolean),
    [outText],
  );

  async function run() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/roster-sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, team, addPlayers, removePlayers }),
    });
    setResult(await res.json());
    setLoading(false);
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
          <input className="rounded bg-zinc-900 p-3" type="number" value={season} onChange={(e) => setSeason(Number(e.target.value))} />
          <input className="rounded bg-zinc-900 p-3" value={team} onChange={(e) => setTeam(e.target.value)} />
          <input className="rounded bg-zinc-900 p-3" value={inText} onChange={(e) => setInText(e.target.value)} />
          <input className="rounded bg-zinc-900 p-3" value={outText} onChange={(e) => setOutText(e.target.value)} />
        </div>

        <div className="mt-4">
          <button className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={run} disabled={loading}>
            {loading ? "Running..." : "Generate Team Fit Report"}
          </button>
        </div>

        {result && (
          <div className="mt-6 space-y-3">
            <div className="text-sm text-zinc-400">Cache: {result.cache}</div>
            <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900 p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-zinc-300">
                    <th className="p-2 text-left">Metric</th>
                    <th className="p-2 text-right">Current</th>
                    <th className="p-2 text-right">Edited</th>
                    <th className="p-2 text-right">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {result.metrics?.map((m: any) => (
                    <tr key={m.metric} className="border-t border-zinc-800">
                      <td className="p-2 text-left">{m.metric}</td>
                      <td className="p-2 text-right">{m.current}</td>
                      <td className="p-2 text-right">{m.edited}</td>
                      <td className="p-2 text-right">{m.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

