"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { ALL_TEAMS, CONFERENCES, SEASONS, playersForTeamSeason } from "@/lib/ui-options";

type CardResult = {
  cache?: string;
  cardHtml?: string;
};

type BasePayload = {
  player: string;
  team: string;
  season: string;
  bio?: Record<string, unknown>;
  per_game?: Record<string, unknown>;
  sections_html?: Record<string, string>;
};

export default function CardsPage() {
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("Louisville");
  const [player, setPlayer] = useState("Mikel Brown");
  const [mode, setMode] = useState<"draft" | "transfer">("draft");
  const [dest, setDest] = useState("SEC");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CardResult | null>(null);
  const [jobId, setJobId] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>("");
  const [teamOptions, setTeamOptions] = useState<string[]>(ALL_TEAMS);
  const [playersByTeam, setPlayersByTeam] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const t of ALL_TEAMS) out[t] = playersForTeamSeason(t, 2026);
    return out;
  });
  const [optionsError, setOptionsError] = useState("");

  const [basePayload, setBasePayload] = useState<BasePayload | null>(null);
  const [compsHtml, setCompsHtml] = useState("");
  const [draftHtml, setDraftHtml] = useState("");
  const [compsProgress, setCompsProgress] = useState(0);
  const [draftProgress, setDraftProgress] = useState(0);
  const [compsLoading, setCompsLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);

  const playerOptions = useMemo(() => playersByTeam[team] ?? [], [playersByTeam, team]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setOptionsError("");
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const r = await fetch(`/api/options?season=${season}`, { cache: "no-store" });
          const j = await r.json();
          if (!active) return;
          if (!j?.ok) throw new Error(String(j?.error ?? "Failed to load options"));
          const teams = Array.isArray(j.teams) ? j.teams : [];
          const pbt = (j.playersByTeam ?? {}) as Record<string, string[]>;
          if (!teams.length) throw new Error("No teams returned");
          setTeamOptions(teams);
          setPlayersByTeam(pbt);

          const nextTeam = teams.includes(team) ? team : (teams[0] ?? "");
          if (nextTeam !== team) setTeam(nextTeam);
          const p = pbt[nextTeam] ?? [];
          if (!p.includes(player) && p[0]) setPlayer(p[0]);
          setOptionsError("");
          return;
        } catch (err) {
          if (attempt >= 3) {
            setOptionsError(err instanceof Error ? err.message : "Failed to load options");
            if (teamOptions.length === 0) setTeamOptions(ALL_TEAMS);
            return;
          }
          await new Promise((res) => setTimeout(res, 700));
        }
      }
    }
    loadOptions();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

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

  function startProgressTicker(setter: Dispatch<SetStateAction<number>>) {
    setter(10);
    const id = window.setInterval(() => {
      setter((prev) => (prev >= 90 ? prev : prev + 7));
    }, 180);
    return () => window.clearInterval(id);
  }

  async function loadHeavyPart(part: "comparisons" | "draft") {
    if (part === "comparisons") setCompsLoading(true);
    else setDraftLoading(true);
    const stop = startProgressTicker(part === "comparisons" ? setCompsProgress : setDraftProgress);
    try {
      const r = await fetch("/api/card/heavy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season, team, player, part }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(String(j?.error ?? "Heavy section failed"));
      if (part === "comparisons") setCompsHtml(String(j.html ?? ""));
      else setDraftHtml(String(j.html ?? ""));
      if (part === "comparisons") setCompsProgress(100);
      else setDraftProgress(100);
    } catch {
      if (part === "comparisons") {
        setCompsHtml("<div class='text-red-400 text-sm'>Failed to load player comparisons.</div>");
      } else {
        setDraftHtml("<div class='text-red-400 text-sm'>Failed to load draft projection.</div>");
      }
    } finally {
      stop();
      if (part === "comparisons") setCompsLoading(false);
      else setDraftLoading(false);
    }
  }

  async function runDraftBase() {
    setLoading(true);
    setMessage("Loading base card data");
    setResult(null);
    setBasePayload(null);
    setCompsHtml("");
    setDraftHtml("");
    setCompsProgress(0);
    setDraftProgress(0);
    const r = await fetch("/api/card/base", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, team, player }),
    });
    const j = await r.json();
    if (!j?.ok) {
      setLoading(false);
      setMessage(String(j?.error ?? "Failed to load base payload"));
      return;
    }
    setBasePayload(j.payload as BasePayload);
    setLoading(false);
    setMessage("Base loaded");
    void loadHeavyPart("comparisons");
    void loadHeavyPart("draft");
  }

  async function runTransferJob() {
    setLoading(true);
    setResult(null);
    setBasePayload(null);
    setCompsHtml("");
    setDraftHtml("");
    setProgress(5);
    setMessage("Queued");
    const res = await fetch("/api/jobs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobType: "card",
        request: {
          season,
          team,
          player,
          mode,
          destinationConference: mode === "transfer" ? dest : "",
        },
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

  async function run() {
    if (mode === "draft") return runDraftBase();
    return runTransferJob();
  }

  const sec = (basePayload?.sections_html ?? {}) as Record<string, string>;
  const bio = (basePayload?.bio ?? {}) as Record<string, unknown>;
  const pg = (basePayload?.per_game ?? {}) as Record<string, unknown>;

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
          <select
            className="rounded bg-zinc-900 p-3"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          >
            {SEASONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            className="rounded bg-zinc-900 p-3"
            value={team}
            onChange={(e) => {
              const nextTeam = e.target.value;
              setTeam(nextTeam);
              const nextPlayers = playersByTeam[nextTeam] ?? [];
              if (!nextPlayers.includes(player) && nextPlayers[0]) setPlayer(nextPlayers[0]);
            }}
          >
            {teamOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="rounded bg-zinc-900 p-3" value={player} onChange={(e) => setPlayer(e.target.value)}>
            {playerOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="rounded bg-zinc-900 p-3" value={mode} onChange={(e) => setMode(e.target.value as "draft" | "transfer")}>
            <option value="draft">NBA Draft</option>
            <option value="transfer">Transfer</option>
          </select>
          <select className="rounded bg-zinc-900 p-3 disabled:opacity-30" value={dest} onChange={(e) => setDest(e.target.value)} disabled={mode !== "transfer"}>
            {CONFERENCES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {optionsError && <div className="mt-2 text-sm text-rose-400">Options error: {optionsError}</div>}

        <div className="mt-4">
          <button className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={run} disabled={loading}>
            {loading ? "Running..." : "Run Card Build"}
          </button>
        </div>

        {(loading || progress > 0) && mode === "transfer" && (
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

        {mode === "draft" && basePayload && (
          <div className="mt-6 space-y-4">
            <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-2xl font-semibold">{basePayload.player} ({basePayload.season})</div>
              <div className="mt-1 text-zinc-300">{basePayload.team}</div>
              <div className="mt-3 text-sm text-zinc-400">
                Pos: {String(bio.position ?? "N/A")} | Ht: {String(bio.height ?? "N/A")} | Age: {String(bio.age_june25 ?? "N/A")} | RSCI: {String(bio.rsci ?? "N/A")}
              </div>
            </div>

            <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-2 text-lg font-semibold">Per Game</div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div>PPG: {String(pg.ppg ?? "N/A")}</div>
                <div>RPG: {String(pg.rpg ?? "N/A")}</div>
                <div>APG: {String(pg.apg ?? "N/A")}</div>
                <div>SPG: {String(pg.spg ?? "N/A")}</div>
                <div>BPG: {String(pg.bpg ?? "N/A")}</div>
                <div>FG%: {String(pg.fg_pct ?? "N/A")}</div>
                <div>3P%: {String(pg.tp_pct ?? "N/A")}</div>
                <div>FT%: {String(pg.ft_pct ?? "N/A")}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: sec.grade_boxes_html ?? "" }} />
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: sec.bt_percentiles_html ?? "" }} />
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: sec.self_creation_html ?? "" }} />
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: sec.shot_diet_html ?? "" }} />
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: sec.playstyles_html ?? "" }} />
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: sec.team_impact_html ?? "" }} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-lg font-semibold">Player Comparisons</div>
                  <div className="text-xs text-zinc-400">{compsProgress}%</div>
                </div>
                {compsLoading && (
                  <div className="mb-3 h-2 w-full rounded bg-zinc-800">
                    <div className="h-2 rounded bg-red-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, compsProgress))}%` }} />
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: compsHtml || "<div class='text-zinc-400 text-sm'>Calculating...</div>" }} />
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-lg font-semibold">Statistical NBA Draft Projection</div>
                  <div className="text-xs text-zinc-400">{draftProgress}%</div>
                </div>
                {draftLoading && (
                  <div className="mb-3 h-2 w-full rounded bg-zinc-800">
                    <div className="h-2 rounded bg-red-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, draftProgress))}%` }} />
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: draftHtml || "<div class='text-zinc-400 text-sm'>Calculating...</div>" }} />
              </div>
            </div>
          </div>
        )}

        {mode === "transfer" && result && (
          <div className="mt-6 space-y-3">
            <div className="text-sm text-zinc-400">Cache: {result.cache}</div>
            <div className="rounded border border-zinc-800 bg-zinc-900 p-4" dangerouslySetInnerHTML={{ __html: result.cardHtml ?? "" }} />
          </div>
        )}
      </div>
    </div>
  );
}
