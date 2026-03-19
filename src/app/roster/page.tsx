"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ALL_TEAMS, rosterForTeamSeason, SEASONS, TRANSFER_CANDIDATES } from "@/lib/ui-options";

type RosterMetric = {
  metric: string;
  current: number;
  edited: number;
  delta: number;
};

type RosterResult = {
  cache?: string;
  metrics?: RosterMetric[];
};

export default function RosterPage() {
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("UCLA");
  const [addPick, setAddPick] = useState("");
  const [removePick, setRemovePick] = useState("");
  const [addPlayers, setAddPlayers] = useState<string[]>([]);
  const [removePlayers, setRemovePlayers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RosterResult | null>(null);
  const [jobId, setJobId] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>("");

  const currentRoster = useMemo(() => rosterForTeamSeason(team, season), [team, season]);
  const addOptions = useMemo(
    () => TRANSFER_CANDIDATES.filter((p) => !addPlayers.includes(p) && !currentRoster.includes(p)),
    [addPlayers, currentRoster],
  );
  const removeOptions = useMemo(
    () => currentRoster.filter((p) => !removePlayers.includes(p)),
    [currentRoster, removePlayers],
  );

  async function poll(id: string) {
    while (true) {
      const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) {
        setLoading(false);
        setMessage("Failed to load job status");
        return;
      }
      const job = j.job;
      setProgress(Number(job.progress ?? 0));
      setMessage(String(job.message ?? ""));
      if (job.status === "done") {
        setResult(job.result_json ?? null);
        setLoading(false);
        return;
      }
      if (job.status === "error") {
        setMessage(String(job.error_text ?? "Job failed"));
        setLoading(false);
        return;
      }
      await new Promise((res) => setTimeout(res, 900));
    }
  }

  async function run() {
    setLoading(true);
    setResult(null);
    setProgress(5);
    setMessage("Queued");
    const res = await fetch("/api/jobs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobType: "roster",
        request: { season, team, addPlayers, removePlayers },
      }),
    });
    const data = await res.json();
    if (!data?.ok || !data?.id) {
      setLoading(false);
      setMessage(`Failed to start job: ${String(data?.error ?? "unknown error")}`);
      return;
    }
    setJobId(data.id);
    await poll(data.id);
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
            value={season}
            onChange={(e) => {
              setSeason(Number(e.target.value));
              setRemovePlayers([]);
            }}
          >
            {SEASONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            className="rounded bg-zinc-900 p-3"
            value={team}
            onChange={(e) => {
              setTeam(e.target.value);
              setRemovePlayers([]);
            }}
          >
            {ALL_TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select className="w-full rounded bg-zinc-900 p-3" value={addPick} onChange={(e) => setAddPick(e.target.value)}>
              <option value="">Select player to add</option>
              {addOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              className="rounded bg-zinc-700 px-3 py-2 text-sm"
              onClick={() => {
                const v = addPick.trim();
                if (!v || addPlayers.includes(v)) return;
                setAddPlayers((prev) => [...prev, v]);
                setAddPick("");
              }}
              type="button"
            >
              Add
            </button>
          </div>
          <div className="flex gap-2">
            <select className="w-full rounded bg-zinc-900 p-3" value={removePick} onChange={(e) => setRemovePick(e.target.value)}>
              <option value="">Select player to remove</option>
              {removeOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              className="rounded bg-zinc-700 px-3 py-2 text-sm"
              onClick={() => {
                const v = removePick.trim();
                if (!v || removePlayers.includes(v)) return;
                setRemovePlayers((prev) => [...prev, v]);
                setRemovePick("");
              }}
              type="button"
            >
              Remove
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded bg-zinc-900 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">In</div>
            <div className="flex flex-wrap gap-2">
              {addPlayers.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="rounded bg-emerald-700 px-2 py-1 text-xs"
                  onClick={() => setAddPlayers((prev) => prev.filter((x) => x !== p))}
                >
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
                <button
                  key={p}
                  type="button"
                  className="rounded bg-rose-700 px-2 py-1 text-xs"
                  onClick={() => setRemovePlayers((prev) => prev.filter((x) => x !== p))}
                >
                  {p} ×
                </button>
              ))}
              {!removePlayers.length && <span className="text-sm text-zinc-500">No players removed</span>}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={run} disabled={loading}>
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
            {jobId && <div className="mt-2 text-xs text-zinc-500">Job: {jobId}</div>}
          </div>
        )}

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
                  {result.metrics?.map((m: RosterMetric) => (
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
