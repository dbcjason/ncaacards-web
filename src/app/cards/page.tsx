"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toCanvas } from "html-to-image";
import { CONFERENCES, seasonsForGender } from "@/lib/ui-options";

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

type PersistedCardRun = {
  v: 1;
  gender: "men" | "women";
  compare: boolean;
  idA: string;
  idB?: string;
};

const CARD_RUN_STORAGE_KEY = "ncaacards:player-profile:active-run";

export default function CardsPage() {
  return (
    <Suspense fallback={null}>
      <CardsPageInner />
    </Suspense>
  );
}

function CardsPageInner() {
  const searchParams = useSearchParams();
  const [gender, setGender] = useState<"men" | "women">("men");
  const iframeRefA = useRef<HTMLIFrameElement | null>(null);
  const iframeRefB = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
  }, [searchParams]);
  const [season, setSeason] = useState(2026);
  const [seasonB, setSeasonB] = useState(2026);
  const [team, setTeam] = useState("");
  const [player, setPlayer] = useState("");
  const [compare, setCompare] = useState(false);
  const [teamB, setTeamB] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [mode, setMode] = useState<"draft" | "transfer">("draft");
  const [dest, setDest] = useState("SEC");
  const [favoriteTeam, setFavoriteTeam] = useState("");

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
  const [exportBusy, setExportBusy] = useState<"" | "download" | "clipboard">("");
  const [exportError, setExportError] = useState("");
  const seasonOptions = useMemo(() => seasonsForGender(gender), [gender]);
  useEffect(() => {
    if (!seasonOptions.length) return;
    if (!seasonOptions.includes(season)) {
      setSeason(seasonOptions[0]);
    }
    if (!seasonOptions.includes(seasonB)) {
      setSeasonB(seasonOptions[0]);
    }
  }, [season, seasonB, seasonOptions]);
  const draftLabel =
    gender === "women"
      ? "WNBA Draft"
      : process.env.NEXT_PUBLIC_DRAFT_LABEL_MEN || process.env.NEXT_PUBLIC_DRAFT_LABEL || "NBA Draft";

  const playerOptions = useMemo(() => playersByTeam[team] ?? [], [playersByTeam, team]);
  const playerOptionsB = useMemo(() => playersByTeamB[teamB] ?? [], [playersByTeamB, teamB]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/me/preferences", { cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          favoriteTeam?: string;
          favoriteConference?: string;
        };
        if (!active || !res.ok || !data.ok) return;
        const nextFavoriteTeam = String(data.favoriteTeam ?? "").trim();
        const nextFavoriteConference = String(data.favoriteConference ?? "SEC").trim() || "SEC";
        setFavoriteTeam(nextFavoriteTeam);
        setDest((current) => (current === "SEC" ? nextFavoriteConference : current));
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, []);

  function redirectToLogin() {
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/?next=${encodeURIComponent(next)}`;
  }

  function isAuthError(status: number, error?: string) {
    return (
      status === 401 ||
      String(error ?? "") === "UNAUTHENTICATED" ||
      String(error ?? "") === "ACCOUNT_EXPIRED"
    );
  }

  async function waitForIframeReady(iframe: HTMLIFrameElement) {
    if (iframe.contentDocument?.readyState === "complete") return;
    await new Promise<void>((resolve) => {
      const onLoad = () => {
        iframe.removeEventListener("load", onLoad);
        resolve();
      };
      iframe.addEventListener("load", onLoad, { once: true });
    });
  }

  async function hydrateTransferPanel(
    iframe: HTMLIFrameElement,
    req: {
      season: number;
      team: string;
      player: string;
      gender: "men" | "women";
      destinationConference: string;
    },
  ) {
    await waitForIframeReady(iframe);
    const doc = iframe.contentDocument;
    if (!doc) return;
    const placeholder = doc.getElementById("transfer-projection-panel");
    if (!placeholder) return;

    const res = await fetch("/api/card/heavy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season: req.season,
        team: req.team,
        player: req.player,
        gender: req.gender,
        destinationConference: req.destinationConference,
        part: "transfer",
      }),
    });
    const data = (await res.json()) as { ok?: boolean; html?: string };
    if (!res.ok || !data?.ok) return;
    const html = String(data.html ?? "").trim();
    if (!html) return;
    placeholder.outerHTML = html;
  }

  function persistActiveRun(run: PersistedCardRun) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(CARD_RUN_STORAGE_KEY, JSON.stringify(run));
  }

  function clearActiveRun() {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(CARD_RUN_STORAGE_KEY);
  }

  function loadActiveRun(): PersistedCardRun | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(CARD_RUN_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedCardRun;
      if (!parsed || parsed.v !== 1 || !parsed.idA) return null;
      return parsed;
    } catch {
      return null;
    }
  }

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
          if (isAuthError(r.status, j?.error)) {
            redirectToLogin();
            return;
          }
          if (!j?.ok) throw new Error(String(j?.error ?? "Failed to load options"));

          const teams = Array.isArray(j.teams) ? j.teams : [];
          const pbt = (j.playersByTeam ?? {}) as Record<string, string[]>;
          if (!teams.length) throw new Error("No teams returned for this season");

          setTeamOptions(teams);
          setPlayersByTeam(pbt);

          const selectedTeam = teams.includes(team)
            ? team
            : favoriteTeam && teams.includes(favoriteTeam)
              ? favoriteTeam
              : teams[0] ?? "";
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
  }, [season, gender, favoriteTeam]);

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
          if (isAuthError(r.status, j?.error)) {
            redirectToLogin();
            return;
          }
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
      if (isAuthError(r.status, j?.error)) {
        redirectToLogin();
        throw new Error("UNAUTHENTICATED");
      }
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = loadActiveRun();
    if (!saved) return;
    if (saved.gender !== gender) return;

    let active = true;
    (async () => {
      setLoading(true);
      setRunError("");
      setProgress(5);
      try {
        if (!saved.compare) {
          const outA = await pollJob(saved.idA, (p) => {
            if (active) setProgress(p);
          });
          if (!active) return;
          const htmlA = String(outA?.cardHtml ?? "");
          if (!htmlA) throw new Error("Card HTML missing from resumed job result");
          setResultHtml(htmlA);
          setResultHtmlB("");
          setResultCache(String(outA?.cache ?? ""));
        } else {
          const idB = String(saved.idB || "").trim();
          if (!idB) throw new Error("Missing comparison job id");
          let pA = 5;
          let pB = 5;
          const updateCombined = () => {
            if (!active) return;
            setProgress(Math.max(5, Math.min(100, Math.round((pA + pB) / 2))));
          };
          const [outA, outB] = await Promise.all([
            pollJob(saved.idA, (p) => {
              pA = p;
              updateCombined();
            }),
            pollJob(idB, (p) => {
              pB = p;
              updateCombined();
            }),
          ]);
          if (!active) return;
          const htmlA = String(outA?.cardHtml ?? "");
          const htmlB = String(outB?.cardHtml ?? "");
          if (!htmlA || !htmlB) throw new Error("Comparison card HTML missing from resumed job result");
          setResultHtml(htmlA);
          setResultHtmlB(htmlB);
          setResultCache(String(outA?.cache ?? outB?.cache ?? ""));
        }
        setProgress(100);
        clearActiveRun();
      } catch (e) {
        if (!active) return;
        setRunError(e instanceof Error ? e.message : "Failed to resume active card build");
        setProgress(100);
        clearActiveRun();
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [gender]);

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
        if (isAuthError(res.status, data?.error)) {
          redirectToLogin();
          throw new Error("UNAUTHENTICATED");
        }
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
        persistActiveRun({
          v: 1,
          gender,
          compare: false,
          idA,
        });
        const outA = await pollJob(idA, (p) => setProgress(p));
        const htmlA = String(outA?.cardHtml ?? "");
        if (!htmlA) throw new Error("Card HTML missing from job result");
        setResultHtml(htmlA);
        setResultCache(String(outA?.cache ?? ""));
        clearActiveRun();
      } else {
        const [idA, idB] = await Promise.all([startJob(reqA), startJob(reqB)]);
        persistActiveRun({
          v: 1,
          gender,
          compare: true,
          idA,
          idB,
        });
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
        clearActiveRun();
      }

      setProgress(100);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Card build failed");
      setProgress(100);
      clearActiveRun();
    } finally {
      setLoading(false);
    }
  }

  async function captureCardCanvas(iframe: HTMLIFrameElement) {
    const doc = iframe.contentDocument;
    if (!doc?.body) {
      throw new Error("Card preview is still loading.");
    }

    const cardRoot =
      (doc.querySelector(".wrap > .card") as HTMLElement | null) ??
      (doc.querySelector(".card") as HTMLElement | null) ??
      doc.body;

    const width = Math.max(
      Math.ceil(cardRoot.scrollWidth || cardRoot.clientWidth || cardRoot.getBoundingClientRect().width),
      900,
    );
    const height = Math.max(
      Math.ceil(cardRoot.scrollHeight || cardRoot.clientHeight || cardRoot.getBoundingClientRect().height),
      1200,
    );

    return toCanvas(cardRoot, {
      cacheBust: true,
      backgroundColor: "#09090b",
      pixelRatio: 1,
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
    });
  }

  async function composeExportCanvas() {
    const iframeA = iframeRefA.current;
    if (!iframeA) {
      throw new Error("No finished card is available yet.");
    }

    const canvasA = await captureCardCanvas(iframeA);
    const iframeB = compare ? iframeRefB.current : null;

    if (!compare || !resultHtmlB || !iframeB) {
      return canvasA;
    }

    const canvasB = await captureCardCanvas(iframeB);
    const gap = 24;
    const width = canvasA.width + canvasB.width + gap;
    const height = Math.max(canvasA.height, canvasB.height);
    const combined = document.createElement("canvas");
    combined.width = width;
    combined.height = height;
    const ctx = combined.getContext("2d");
    if (!ctx) {
      throw new Error("Could not prepare the combined export image.");
    }
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvasA, 0, 0);
    ctx.drawImage(canvasB, canvasA.width + gap, 0);
    return combined;
  }

  function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not create the image file."));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }

  function exportFileName() {
    if (compare && playerB) {
      return `${player}_vs_${playerB}_${gender}.png`.replace(/\s+/g, "_");
    }
    return `${player}_${gender}.png`.replace(/\s+/g, "_");
  }

  async function handleDownloadImage() {
    setExportBusy("download");
    setExportError("");
    try {
      const canvas = await composeExportCanvas();
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFileName();
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not download the card image.");
    } finally {
      setExportBusy("");
    }
  }

  async function handleCopyImage() {
    setExportBusy("clipboard");
    setExportError("");
    try {
      const canvas = await composeExportCanvas();
      const blob = await canvasToBlob(canvas);
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("Clipboard image copy is not supported in this browser.");
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not copy the card image.");
    } finally {
      setExportBusy("");
    }
  }

  useEffect(() => {
    if (!resultHtml || mode !== "transfer") return;
    const iframe = iframeRefA.current;
    if (!iframe || !team || !player) return;
    void hydrateTransferPanel(iframe, {
      season,
      team,
      player,
      gender,
      destinationConference: dest,
    });
  }, [resultHtml, mode, season, team, player, gender, dest]);

  useEffect(() => {
    if (!compare || !resultHtmlB || mode !== "transfer") return;
    const iframe = iframeRefB.current;
    if (!iframe || !teamB || !playerB) return;
    void hydrateTransferPanel(iframe, {
      season: seasonB,
      team: teamB,
      player: playerB,
      gender,
      destinationConference: dest,
    });
  }, [compare, resultHtmlB, mode, seasonB, teamB, playerB, gender, dest]);

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
            <Link href={`/transfer-grades?gender=${gender}&season=${season}`} className="text-zinc-300">
              Transfer Grades
            </Link>
            <Link href={`/leaderboard?gender=${gender}&season=${season}`} className="text-zinc-300">
              Leaderboard
            </Link>
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">
            Home
          </Link>
        </div>

        <div className="mb-3">
          <div className="group relative inline-block">
            <span className="cursor-help font-bold underline decoration-2 underline-offset-2">
              NOTE
            </span>
            <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-[560px] rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200 shadow-xl group-hover:block">
              Player profiles take approximately 20 seconds to build.
            </div>
          </div>
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
              seasonOptions.map((y) => (
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
                seasonOptions.map((y) => (
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
            <div className="mb-3 flex flex-wrap gap-2 px-2 pt-2">
              <button
                type="button"
                className="site-button"
                onClick={handleDownloadImage}
                disabled={exportBusy !== ""}
              >
                {exportBusy === "download" ? "Downloading..." : "Download Image"}
              </button>
              <button
                type="button"
                className="site-button-secondary"
                onClick={handleCopyImage}
                disabled={exportBusy !== ""}
              >
                {exportBusy === "clipboard" ? "Copying..." : "Save Image to Clipboard"}
              </button>
              {compare && resultHtmlB ? (
                <div className="self-center text-xs text-zinc-500">
                  Export includes both profiles side by side.
                </div>
              ) : null}
            </div>
            {exportError ? (
              <div className="mb-3 px-2 text-sm text-rose-400">{exportError}</div>
            ) : null}
            <div className={`grid gap-1 ${compare && resultHtmlB ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
              <div className={compare && resultHtmlB ? "h-[1500px] overflow-hidden rounded" : "rounded"}>
                <iframe
                  ref={iframeRefA}
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
                    ref={iframeRefB}
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
