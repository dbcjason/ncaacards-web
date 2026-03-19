"use client";

import { useState } from "react";
import Link from "next/link";

export default function CardsPage() {
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("Louisville");
  const [player, setPlayer] = useState("Mikel Brown");
  const [mode, setMode] = useState<"draft" | "transfer">("draft");
  const [dest, setDest] = useState("SEC");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season,
        team,
        player,
        mode,
        destinationConference: mode === "transfer" ? dest : "",
      }),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href="/cards" className="text-red-400">Player Profiles</Link>
            <Link href="/roster" className="text-zinc-300">Roster Construction</Link>
          </div>
          <Link href="/" className="text-zinc-400">Home</Link>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <input className="rounded bg-zinc-900 p-3" type="number" value={season} onChange={(e) => setSeason(Number(e.target.value))} />
          <input className="rounded bg-zinc-900 p-3" value={team} onChange={(e) => setTeam(e.target.value)} />
          <input className="rounded bg-zinc-900 p-3" value={player} onChange={(e) => setPlayer(e.target.value)} />
          <select className="rounded bg-zinc-900 p-3" value={mode} onChange={(e) => setMode(e.target.value as "draft" | "transfer")}>
            <option value="draft">NBA Draft</option>
            <option value="transfer">Transfer</option>
          </select>
          <input className="rounded bg-zinc-900 p-3 disabled:opacity-30" value={dest} onChange={(e) => setDest(e.target.value)} disabled={mode !== "transfer"} />
        </div>

        <div className="mt-4">
          <button className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={run} disabled={loading}>
            {loading ? "Running..." : "Run Card Build"}
          </button>
        </div>

        {result && (
          <div className="mt-6 space-y-3">
            <div className="text-sm text-zinc-400">Cache: {result.cache}</div>
            <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: result.cardHtml }} />
          </div>
        )}
      </div>
    </div>
  );
}

