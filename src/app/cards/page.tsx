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

type BasePayload = {
  player: string;
  team: string;
  season: string | number;
  bio?: Record<string, unknown>;
  per_game?: Record<string, unknown>;
  shot_chart?: {
    attempts?: number;
    makes?: number;
    fg_pct?: number;
    pps_over_expectation_line?: string;
    shots?: Array<{ x?: number; y?: number; made?: boolean }>;
  };
  sections_html?: Record<string, string>;
};

const CARD_STYLE = `
:root {
  --bg: #0a0a0a;
  --panel: #141414;
  --line: #3b3b3b;
  --text: #f5f5f5;
  --muted: #d4d4d4;
  --accent: #ffffff;
  --bar: #22c55e;
  --panel-alt: #1f1f1f;
  --bar-track: #2a2a2a;
}
body { margin: 0; background: var(--bg); color: var(--text); font-family: "Segoe UI", Arial, sans-serif; }
.wrap { max-width: 1100px; margin: 18px auto; padding: 16px; }
.card { border: 2px solid var(--line); border-radius: 12px; background: #000; padding: 16px; }
.title { font-size: 44px; line-height: 1; font-weight: 800; color: var(--accent); margin: 0 0 8px 0; }
.title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sub { color: var(--muted); margin: 0 0 12px 0; font-size: 20px; }
.grade-strip { display: grid; grid-template-columns: repeat(5, minmax(96px, 1fr)); gap: 8px; min-width: 560px; }
.panel { border: 1px solid var(--line); border-radius: 12px; background: linear-gradient(180deg, #0f0f0f 0%, #171717 100%); padding: 12px; }
.panel h3 { margin: 0 0 8px 0; font-size: 38px; line-height: 1.05; }
.per-game-panel h3 { margin-bottom: 10px; }
.stat-strip { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 8px; }
.chip { border: 1px solid var(--line); border-radius: 10px; padding: 8px; text-align: center; background: var(--panel-alt); }
.chip .k { color: var(--muted); font-size: 18px; line-height: 1; }
.chip .v { font-size: 31px; font-weight: 800; line-height: 1.2; color: var(--accent); }
.chip .p { color: var(--muted); font-size: 14px; line-height: 1; }
.lower-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 14px; align-items: start; }
.col-stack { display: grid; gap: 14px; align-content: start; }
.shot-meta { color: var(--muted); font-size: 18px; line-height: 1.3; margin-bottom: 8px; }
.shot-meta-xs { color: var(--muted); font-size: 14px; line-height: 1.25; margin-top: 6px; }
.shot-svg { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #000; }
.footer-tag { margin-top: 6px; font-weight: 800; color: #60a5fa; font-size: 20px; }
@media (max-width: 1200px) {
  .title { font-size: 34px; }
  .panel h3 { font-size: 30px; }
  .grade-strip { min-width: 0; width: 100%; }
  .stat-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .lower-grid { grid-template-columns: 1fr; }
}
`;

function esc(v: unknown): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function num(v: unknown, digits = 1): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

function perGameChip(label: string, value: unknown, pct: unknown = null): string {
  const ptxt = Number.isFinite(Number(pct)) ? `${Math.round(Number(pct))}%` : "--";
  return `<div class="chip"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div><div class="p">${esc(ptxt)}</div></div>`;
}

function buildShotSvg(shots: Array<{ x?: number; y?: number; made?: boolean }>): string {
  const dots = shots
    .filter((s) => Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y)))
    .map((s) => {
      const cx = Number(s.x);
      const cy = Number(s.y);
      const color = s.made ? "#22c55e" : "#ef4444";
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="5.2" fill="${color}" fill-opacity="0.9" />`;
    })
    .join("");

  return `
  <svg viewBox="0 0 400 520" class="shot-svg" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="398" height="518" fill="#000" stroke="#fff" stroke-width="2"/>
    <rect x="130" y="36" width="140" height="190" fill="none" stroke="#fff" stroke-width="4"/>
    <circle cx="200" cy="126" r="60" fill="none" stroke="#fff" stroke-width="4"/>
    <path d="M 48 126 A 152 152 0 0 1 352 126" fill="none" stroke="#fff" stroke-width="4"/>
    <line x1="48" y1="126" x2="48" y2="36" stroke="#fff" stroke-width="4"/>
    <line x1="352" y1="126" x2="352" y2="36" stroke="#fff" stroke-width="4"/>
    ${dots}
  </svg>`;
}

function composeCardHtml(payload: BasePayload): string {
  const bio = payload.bio ?? {};
  const per = payload.per_game ?? {};
  const sections = (payload.sections_html ?? {}) as Record<string, string>;
  const shot = payload.shot_chart ?? {};
  const shots = Array.isArray(shot.shots) ? shot.shots : [];
  const percentiles =
    per.percentiles && typeof per.percentiles === "object"
      ? (per.percentiles as Record<string, unknown>)
      : {};

  const gradeStrip = sections.grade_boxes_html ?? "";
  const percentilesHtml = sections.bt_percentiles_html ?? "";
  const selfCreationHtml = sections.self_creation_html ?? "";
  const playstylesHtml = sections.playstyles_html ?? "";
  const teamImpactHtml = sections.team_impact_html ?? "";
  const shotDietHtml = sections.shot_diet_html ?? "";
  const compsHtml = sections.player_comparisons_html ?? "";
  const draftHtml = sections.draft_projection_html ?? "";

  const shotMeta = `Attempts: ${num(shot.attempts, 0)} | Made: ${num(shot.makes, 0)} | FG%: ${num(shot.fg_pct, 1)}`;

  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${CARD_STYLE}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="title-row">
          <h1 class="title">${esc(payload.player)} (${esc(payload.season)})</h1>
          <div class="grade-strip">${gradeStrip}</div>
        </div>
        <div class="sub">
          ${esc(payload.team)} | ${esc(payload.season)} | Position: ${esc(bio.position ?? "N/A")}
          | Age: ${esc(bio.age_june25 ?? "N/A")} | Height: ${esc(bio.height ?? "N/A")} | RSCI: ${esc(bio.rsci ?? "N/A")}
        </div>

        <div class="panel per-game-panel">
          <h3>Per Game</h3>
          <div class="stat-strip">
            ${perGameChip("PPG", num(per.ppg), percentiles.ppg)}
            ${perGameChip("RPG", num(per.rpg), percentiles.rpg)}
            ${perGameChip("APG", num(per.apg), percentiles.apg)}
            ${perGameChip("SPG", num(per.spg), percentiles.spg)}
            ${perGameChip("BPG", num(per.bpg), percentiles.bpg)}
            ${perGameChip("FG%", num(per.fg_pct), percentiles.fg_pct)}
            ${perGameChip("3P%", num(per.tp_pct), percentiles.tp_pct)}
            ${perGameChip("FT%", num(per.ft_pct), percentiles.ft_pct)}
          </div>
        </div>

        ${percentilesHtml}

        <div class="lower-grid">
          <div class="col-stack">
            <div class="panel">
              <h3>Shot Chart</h3>
              <div class="shot-meta">${esc(shotMeta)}</div>
              <div class="shot-meta-xs">${esc(shot.pps_over_expectation_line ?? "")}</div>
              ${buildShotSvg(shots)}
            </div>
            ${shotDietHtml}
            ${draftHtml}
          </div>
          <div class="col-stack">
            ${selfCreationHtml}
            ${playstylesHtml}
          </div>
          <div class="col-stack">
            ${teamImpactHtml}
            ${compsHtml}
            <div class="footer-tag">CREATED BY @DBCJASON</div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

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
  const draftLabel = process.env.NEXT_PUBLIC_DRAFT_LABEL || "NBA Draft";

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
          const selectedPlayer = selectedPlayers.includes(player) ? player : selectedPlayers[0] ?? "";
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
  }, [season, gender, player, team]);

  async function pollJob(id: string, onProgress?: (p: number) => void): Promise<CardJobResult | null> {
    while (true) {
      const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      const j = (await r.json()) as JobPollResponse;
      if (!j?.ok || !j.job) throw new Error(String(j?.error ?? "Failed to poll job"));
      const status = String(j.job.status ?? "");
      onProgress?.(Number(j.job.progress ?? 0));
      if (status === "done") return (j.job.result_json ?? null) as CardJobResult | null;
      if (status === "error") throw new Error(String(j.job.error_text ?? "Card build failed"));
      await new Promise((res) => setTimeout(res, 900));
    }
  }

  async function fallbackGithubBuild(reqA: Record<string, unknown>) {
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

    const idA = await startJob(reqA);
    const outA = await pollJob(idA, (p) => setProgress(p));
    const htmlA = String(outA?.cardHtml ?? "");
    if (!htmlA) throw new Error("Card HTML missing from job result");
    setResultHtml(htmlA);
    setResultCache(String(outA?.cache ?? ""));
  }

  async function runCardBuild() {
    if (!optionsLoaded || !team || !player) return;

    setLoading(true);
    setProgress(5);
    setRunError("");
    setResultCache("");
    setResultHtml("");

    const reqA = {
      gender,
      season,
      team,
      player,
      mode,
      destinationConference: mode === "transfer" ? dest : "",
    };

    try {
      // Transfer mode still uses full workflow until transfer projection section is fully payload-driven.
      if (mode === "transfer") {
        await fallbackGithubBuild(reqA as unknown as Record<string, unknown>);
        setProgress(100);
        return;
      }

      const baseRes = await fetch("/api/card/base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqA),
      });
      const baseJson = (await baseRes.json()) as { ok?: boolean; error?: string; payload?: BasePayload };
      if (!baseJson?.ok || !baseJson.payload) {
        throw new Error(String(baseJson?.error ?? "Base payload unavailable"));
      }

      const basePayload: BasePayload = structuredClone(baseJson.payload);
      setResultHtml(composeCardHtml(basePayload));
      setResultCache("static");
      setProgress(45);

      const loadPart = async (part: "comparisons" | "draft") => {
        const r = await fetch("/api/card/heavy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ season, team, player, part }),
        });
        const j = (await r.json()) as { ok?: boolean; html?: string; error?: string };
        if (!j?.ok) throw new Error(String(j?.error ?? `${part} failed`));
        return String(j.html ?? "");
      };

      const [cmpRes, draftRes] = await Promise.allSettled([loadPart("comparisons"), loadPart("draft")]);
      if (!basePayload.sections_html) basePayload.sections_html = {};
      if (cmpRes.status === "fulfilled") {
        basePayload.sections_html.player_comparisons_html = cmpRes.value;
      }
      setProgress(75);
      if (draftRes.status === "fulfilled") {
        basePayload.sections_html.draft_projection_html = draftRes.value;
      }
      setResultHtml(composeCardHtml(basePayload));
      setProgress(100);
    } catch (e) {
      // Fallback keeps the app usable for uncached players.
      try {
        await fallbackGithubBuild(reqA as unknown as Record<string, unknown>);
        setProgress(100);
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        setRunError(e instanceof Error ? `${e.message} | ${msg}` : msg);
        setProgress(100);
      }
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
            <iframe
              title="Player Card"
              srcDoc={resultHtml}
              className="h-[2300px] w-full rounded"
              sandbox="allow-same-origin allow-scripts"
            />
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

