"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CONFERENCES, SEASONS } from "@/lib/ui-options";

type CardJobResult = {
  cache?: string;
  cardHtml?: string;
};

type JobApiResponse = {
  ok: boolean;
  id?: string;
  error?: string;
};

type JobPollResponse = {
  ok: boolean;
  error?: string;
  job?: {
    status?: string;
    progress?: number;
    message?: string;
    result_json?: CardJobResult | null;
    error_text?: string | null;
  };
};

export default function CardsPage() {
  const gender = "men" as const;
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("");
  const [player, setPlayer] = useState("");
  const [mode, setMode] = useState<"draft" | "transfer">("draft");
  const [dest, setDest] = useState("SEC");

  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const [playersByTeam, setPlayersByTeam] = useState<Record<string, string[]>>({});
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsError, setOptionsError] = useState("");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [resultHtml, setResultHtml] = useState("");
  const [resultCache, setResultCache] = useState<string>("");
  const [runError, setRunError] = useState("");
  const draftLabel =
    process.env.NEXT_PUBLIC_DRAFT_LABEL || (gender === "women" ? "WNBA Draft" : "NBA Draft");

  const playerOptions = useMemo(() => playersByTeam[team] ?? [], [playersByTeam, team]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setOptionsLoaded(false);
      setOptionsError("");

      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const r = await fetch(`/api/options?season=${season}&gender=${gender}`, { cache: "no-store" });
          const j = (await r.json()) as {
            ok?: boolean;
            error?: string;
            teams?: string[];
            playersByTeam?: Record<string, string[]>;
          };
          if (!active) return;
          if (!j?.ok) throw new Error(String(j?.error ?? "Failed to load options"));

          const teams = Array.isArray(j.teams) ? j.teams : [];
          const pbt = (j.playersByTeam ?? {}) as Record<string, string[]>;
          if (!teams.length) throw new Error("No teams returned for this season");

          setTeamOptions(teams);
          setPlayersByTeam(pbt);

          const selectedTeam = teams.includes(team) ? team : teams[0] ?? "";
          const selectedPlayers = pbt[selectedTeam] ?? [];
          const selectedPlayer = selectedPlayers.includes(player)
            ? player
            : selectedPlayers[0] ?? "";

          setTeam(selectedTeam);
          setPlayer(selectedPlayer);
          setOptionsLoaded(true);
          return;
        } catch (err) {
          if (attempt >= 3) {
            setOptionsError(err instanceof Error ? err.message : "Failed to load options");
            setOptionsLoaded(false);
            return;
          }
          await new Promise((res) => setTimeout(res, 700));
        }
      }
    }

    void loadOptions();
    return () => {
      active = false;
    };
  }, [season, gender]);

  async function pollJob(id: string, onProgress?: (p: number) => void): Promise<CardJobResult | null> {
    while (true) {
      const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      const j = (await r.json()) as JobPollResponse;
      if (!j?.ok || !j.job) {
        throw new Error(String(j?.error ?? "Failed to poll job"));
      }
      const status = String(j.job.status ?? "");
      onProgress?.(Number(j.job.progress ?? 0));

      if (status === "done") {
        return (j.job.result_json ?? null) as CardJobResult | null;
      }
      if (status === "error") {
        throw new Error(String(j.job.error_text ?? "Card build failed"));
      }

      await new Promise((res) => setTimeout(res, 900));
    }
  }

  async function runCardBuild() {
    if (!optionsLoaded || !team || !player) return;

    setLoading(true);
    setProgress(5);
    setRunError("");
    setResultCache("");
    setResultHtml("");

    try {
      const startJob = async (req: Record<string, unknown>) => {
        const res = await fetch("/api/jobs/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobType: "card", request: req }),
        });
        const data = (await res.json()) as JobApiResponse;
        if (!data?.ok || !data.id) throw new Error(String(data?.error ?? "Failed to start job"));
        return data.id;
      };

      const reqA = {
        gender,
        season,
        team,
        player,
        mode,
        destinationConference: mode === "transfer" ? dest : "",
      };
      const idA = await startJob(reqA);
      const outA = await pollJob(idA, (p) => setProgress(p));
      const htmlA = String(outA?.cardHtml ?? "");
      if (!htmlA) throw new Error("Card HTML missing from job result");
      setResultHtml(htmlA);
      setResultCache(String(outA?.cache ?? ""));

      setProgress(100);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Card build failed");
      setProgress(100);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href={`/cards?gender=${gender}`} className="text-red-400">
              Player Profiles
            </Link>
            <Link href={`/roster?gender=${gender}`} className="text-zinc-300">
              Roster Construction
            </Link>
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">
            Home
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <select
            className="rounded bg-zinc-900 p-3"
            value={optionsLoaded ? String(season) : "__loading_year__"}
            onChange={(e) => setSeason(Number(e.target.value))}
            disabled={!optionsLoaded}
          >
            {!optionsLoaded && <option value="__loading_year__">Year</option>}
            {optionsLoaded &&
              SEASONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>

          <select
            className="rounded bg-zinc-900 p-3"
            value={optionsLoaded ? team : "__loading_team__"}
            onChange={(e) => {
              const nextTeam = e.target.value;
              setTeam(nextTeam);
              const nextPlayers = playersByTeam[nextTeam] ?? [];
              setPlayer(nextPlayers[0] ?? "");
            }}
            disabled={!optionsLoaded}
          >
            {!optionsLoaded && <option value="__loading_team__">Team</option>}
            {optionsLoaded &&
              teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
          </select>

          <select
            className="rounded bg-zinc-900 p-3"
            value={optionsLoaded ? player : "__loading_player__"}
            onChange={(e) => setPlayer(e.target.value)}
            disabled={!optionsLoaded}
          >
            {!optionsLoaded && <option value="__loading_player__">Player</option>}
            {optionsLoaded &&
              playerOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
          </select>

          <select
            className="rounded bg-zinc-900 p-3"
            value={mode}
            onChange={(e) => setMode(e.target.value as "draft" | "transfer")}
          >
            <option value="draft">{draftLabel}</option>
            <option value="transfer">Transfer</option>
          </select>

          <select
            className="rounded bg-zinc-900 p-3 disabled:opacity-40"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            disabled={mode !== "transfer"}
          >
            {CONFERENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            className="rounded bg-red-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={runCardBuild}
            disabled={!optionsLoaded || !team || !player || loading}
          >
            {loading ? "Running..." : "Run Card Build"}
          </button>
        </div>

        {optionsError && <div className="mt-2 text-sm text-rose-400">Options error: {optionsError}</div>}
        {runError && <div className="mt-2 text-sm text-rose-400">Run error: {runError}</div>}

        {(loading || progress > 0) && (
          <div className="mt-4 rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
              <span>{loading ? "Building card..." : progress >= 100 ? "Completed" : "Ready"}</span>
              <span>{Math.max(0, Math.min(100, progress))}%</span>
            </div>
            <div className="h-2 w-full rounded bg-zinc-800">
              <div
                className="h-2 rounded bg-red-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
            {resultCache && <div className="mt-1 text-xs text-zinc-500">Cache: {resultCache}</div>}
          </div>
        )}

        {resultHtml ? (
          <div className="mt-5 rounded border border-zinc-800 bg-zinc-950 p-1">
            <div className="grid grid-cols-1 gap-1">
              <div className="rounded">
                <iframe
                  title="Player Card"
                  srcDoc={resultHtml}
                  className="h-[2300px] w-full rounded"
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded border border-zinc-800 bg-zinc-900 p-5 text-zinc-400">
            Select a player and run card build.
          </div>
        )}
      </div>
    </div>
  );
}
