"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
  const [gender, setGender] = useState<"men" | "women">("men");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const g = new URLSearchParams(window.location.search).get("gender");
    setGender(g === "women" ? "women" : "men");
  }, []);
  const [season, setSeason] = useState(2026);
  const [seasonB, setSeasonB] = useState(2026);
  const [team, setTeam] = useState("");
  const [player, setPlayer] = useState("");
  const [compare, setCompare] = useState(false);
  const [teamB, setTeamB] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [mode, setMode] = useState<"draft" | "transfer">("draft");
  const [dest, setDest] = useState("SEC");

  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const [playersByTeam, setPlayersByTeam] = useState<Record<string, string[]>>({});
  const [teamOptionsB, setTeamOptionsB] = useState<string[]>([]);
  const [playersByTeamB, setPlayersByTeamB] = useState<Record<string, string[]>>({});
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsLoadedB, setOptionsLoadedB] = useState(false);
  const [optionsError, setOptionsError] = useState("");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [resultHtml, setResultHtml] = useState("");
  const [resultHtmlB, setResultHtmlB] = useState("");
  const [resultCache, setResultCache] = useState<string>("");
  const [runError, setRunError] = useState("");
  const draftLabel =
    process.env.NEXT_PUBLIC_DRAFT_LABEL || (gender === "women" ? "WNBA Draft" : "NBA Draft");

  const playerOptions = useMemo(() => playersByTeam[team] ?? [], [playersByTeam, team]);
  const playerOptionsB = useMemo(() => playersByTeamB[teamB] ?? [], [playersByTeamB, teamB]);

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

  useEffect(() => {
    let active = true;
    async function loadOptionsB() {
      setOptionsLoadedB(false);
      setOptionsError("");

      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const r = await fetch(`/api/options?season=${seasonB}&gender=${gender}`, { cache: "no-store" });
          const j = (await r.json()) as {
            ok?: boolean;
            error?: string;
            teams?: string[];
            playersByTeam?: Record<string, string[]>;
          };
          if (!active) return;
          if (!j?.ok) throw new Error(String(j?.error ?? "Failed to load compare options"));

          const teams = Array.isArray(j.teams) ? j.teams : [];
          const pbt = (j.playersByTeam ?? {}) as Record<string, string[]>;
          if (!teams.length) throw new Error("No teams returned for compare season");

          setTeamOptionsB(teams);
          setPlayersByTeamB(pbt);

          const selectedTeam = teams.includes(teamB) ? teamB : teams[0] ?? "";
          const selectedPlayers = pbt[selectedTeam] ?? [];
          const selectedPlayer = selectedPlayers.includes(playerB)
            ? playerB
            : selectedPlayers[0] ?? "";

          setTeamB(selectedTeam);
          setPlayerB(selectedPlayer);
          setOptionsLoadedB(true);
          return;
        } catch (err) {
          if (attempt >= 3) {
            setOptionsError(err instanceof Error ? err.message : "Failed to load compare options");
            setOptionsLoadedB(false);
            return;
          }
          await new Promise((res) => setTimeout(res, 700));
        }
      }
    }

    void loadOptionsB();
    return () => {
      active = false;
    };
  }, [seasonB, gender]);

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
    if (compare && (!teamB || !playerB)) return;

    setLoading(true);
    setProgress(5);
    setRunError("");
    setResultCache("");
    setResultHtml("");
    setResultHtmlB("");

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
      const reqB = {
        gender,
        season: seasonB,
        team: teamB,
        player: playerB,
        mode,
        destinationConference: mode === "transfer" ? dest : "",
      };

      if (!compare) {
        const idA = await startJob(reqA);
        const outA = await pollJob(idA, (p) => setProgress(p));
        const htmlA = String(outA?.cardHtml ?? "");
        if (!htmlA) throw new Error("Card HTML missing from job result");
        setResultHtml(htmlA);
        setResultCache(String(outA?.cache ?? ""));
      } else {
        const [idA, idB] = await Promise.all([startJob(reqA), startJob(reqB)]);
        let pA = 5;
        let pB = 5;
        const updateCombined = () => setProgress(Math.max(5, Math.min(100, Math.round((pA + pB) / 2))));
        const [outA, outB] = await Promise.all([
          pollJob(idA, (p) => {
            pA = p;
            updateCombined();
          }),
          pollJob(idB, (p) => {
            pB = p;
            updateCombined();
          }),
        ]);
        const htmlA = String(outA?.cardHtml ?? "");
        const htmlB = String(outB?.cardHtml ?? "");
        if (!htmlA || !htmlB) throw new Error("Comparison card HTML missing from job result");
        setResultHtml(htmlA);
        setResultHtmlB(htmlB);
        setResultCache(String(outA?.cache ?? outB?.cache ?? ""));
      }

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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
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

          <label className="flex items-center gap-2 rounded bg-zinc-900 px-3 py-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            <span className="text-sm">Compare</span>
          </label>

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

        {compare && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <select
              className="rounded bg-zinc-900 p-3"
              value={optionsLoadedB ? String(seasonB) : "__loading_year_b__"}
              onChange={(e) => setSeasonB(Number(e.target.value))}
              disabled={!optionsLoadedB}
            >
              {!optionsLoadedB && <option value="__loading_year_b__">Year</option>}
              {optionsLoadedB &&
                SEASONS.map((y) => (
                  <option key={`year-b-${y}`} value={y}>
                    {y}
                  </option>
                ))}
            </select>
            <select
              className="rounded bg-zinc-900 p-3"
              value={optionsLoadedB ? teamB : "__loading_team_b__"}
              onChange={(e) => {
                const nextTeam = e.target.value;
                setTeamB(nextTeam);
                const nextPlayers = playersByTeamB[nextTeam] ?? [];
                setPlayerB(nextPlayers[0] ?? "");
              }}
              disabled={!optionsLoadedB}
            >
              {!optionsLoadedB && <option value="__loading_team_b__">Team</option>}
              {optionsLoadedB &&
                teamOptionsB.map((t) => (
                  <option key={`team-b-${t}`} value={t}>
                    {t}
                  </option>
                ))}
            </select>
            <select
              className="rounded bg-zinc-900 p-3"
              value={optionsLoadedB ? playerB : "__loading_player_b__"}
              onChange={(e) => setPlayerB(e.target.value)}
              disabled={!optionsLoadedB}
            >
              {!optionsLoadedB && <option value="__loading_player_b__">Player</option>}
              {optionsLoadedB &&
                playerOptionsB.map((p) => (
                  <option key={`player-b-${p}`} value={p}>
                    {p}
                  </option>
                ))}
            </select>
            <div className="rounded bg-zinc-900 p-3 text-sm text-zinc-400">
              Parallel build enabled. Both cards run at the same time.
            </div>
          </div>
        )}

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
            <div className={`grid gap-1 ${compare && resultHtmlB ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
              <div className={compare && resultHtmlB ? "h-[1500px] overflow-hidden rounded" : "rounded"}>
                <iframe
                  title="Player Card"
                  srcDoc={resultHtml}
                  className={compare && resultHtmlB ? "h-[2300px] w-full rounded" : "h-[2300px] w-full rounded"}
                  style={compare && resultHtmlB ? ({ zoom: 0.65 } as CSSProperties) : undefined}
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>
              {compare && resultHtmlB && (
                <div className="h-[1500px] overflow-hidden rounded">
                  <iframe
                    title="Player Card B"
                    srcDoc={resultHtmlB}
                    className="h-[2300px] w-full rounded"
                    style={{ zoom: 0.65 } as CSSProperties}
                    sandbox="allow-same-origin allow-scripts"
                  />
                </div>
              )}
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
