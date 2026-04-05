"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CONFERENCES, SEASONS } from "@/lib/ui-options";

type WatchlistItem = {
  id: string;
  sort_order: number;
  season: number;
  team: string;
  player: string;
  conference: string;
  class: string;
  pos: string;
  age: number | null;
  height: string;
  statistical_height: string;
  statistical_height_delta: number | null;
  rsci: number | null;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>;
  grades?: { label: string; value: string }[];
};

type JobApiResponse = {
  ok?: boolean;
  id?: string;
  error?: string;
};

type JobPollResponse = {
  ok?: boolean;
  error?: string;
  job?: {
    status?: string;
    progress?: number;
    result_json?: { cardHtml?: string } | null;
    error_text?: string | null;
  };
};

function fmtNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtStatValue(label: string, value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (label.includes("%")) return value.toFixed(1);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function WatchlistPage() {
  return (
    <Suspense fallback={null}>
      <WatchlistPageInner />
    </Suspense>
  );
}

function WatchlistPageInner() {
  const searchParams = useSearchParams();
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const [gender, setGender] = useState<"men" | "women">("men");
  const [season, setSeason] = useState(2026);
  const [team, setTeam] = useState("");
  const [player, setPlayer] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [mode, setMode] = useState<"draft" | "transfer">("transfer");
  const [dest, setDest] = useState("SEC");
  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const [playersByTeam, setPlayersByTeam] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [cardHtmlById, setCardHtmlById] = useState<Record<string, string>>({});
  const [cardLoadingById, setCardLoadingById] = useState<Record<string, boolean>>({});
  const [cardErrorById, setCardErrorById] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [watchlistError, setWatchlistError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
    const seasonParam = Number(searchParams.get("season"));
    if (Number.isFinite(seasonParam) && seasonParam > 2000) setSeason(seasonParam);
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    (async () => {
      setOptionsError("");
      try {
        const res = await fetch(`/api/options?season=${season}&gender=${gender}`, { cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          teams?: string[];
          playersByTeam?: Record<string, string[]>;
        };
        if (!active) return;
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load options");
        const nextTeams = Array.isArray(data.teams) ? data.teams : [];
        const nextPlayersByTeam = data.playersByTeam ?? {};
        const nextTeam = nextTeams.includes(team) ? team : nextTeams[0] ?? "";
        const nextPlayers = nextPlayersByTeam[nextTeam] ?? [];
        const nextPlayer = nextPlayers.includes(player) ? player : nextPlayers[0] ?? "";
        setTeamOptions(nextTeams);
        setPlayersByTeam(nextPlayersByTeam);
        setTeam(nextTeam);
        setPlayer(nextPlayer);
      } catch (err) {
        if (!active) return;
        setOptionsError(err instanceof Error ? err.message : "Failed to load options");
      }
    })();
    return () => {
      active = false;
    };
  }, [gender, season]);

  async function loadWatchlist() {
    setLoading(true);
    setWatchlistError("");
    try {
      const res = await fetch(`/api/watchlist?gender=${gender}&season=${season}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; error?: string; items?: WatchlistItem[] };
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load watchlist");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to load watchlist");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWatchlist();
  }, [gender, season]);

  const playerOptions = useMemo(() => playersByTeam[team] ?? [], [playersByTeam, team]);
  const filteredPlayerOptions = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
    if (!needle) return playerOptions;
    return playerOptions.filter((option) => option.toLowerCase().includes(needle));
  }, [playerOptions, playerSearch]);
  const navSeason = season || 2026;

  async function addPlayer() {
    if (!team || !player) return;
    setWatchlistError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender, season, team, player }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; items?: WatchlistItem[] };
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to add player");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to add player");
    }
  }

  async function removeItem(id: string) {
    setWatchlistError("");
    try {
      const res = await fetch(`/api/watchlist?gender=${gender}&season=${season}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; items?: WatchlistItem[] };
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to remove player");
      setItems(Array.isArray(data.items) ? data.items : []);
      setExpandedIds((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to remove player");
    }
  }

  async function persistOrder(nextItems: WatchlistItem[]) {
    const orderedIds = nextItems.map((item) => item.id);
    const res = await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender, season, orderedIds }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; items?: WatchlistItem[] };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to reorder watchlist");
    }
    setItems(Array.isArray(data.items) ? data.items : nextItems);
  }

  async function pollJob(id: string): Promise<string> {
    while (true) {
      const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      const data = (await res.json()) as JobPollResponse;
      if (!res.ok || !data.ok || !data.job) {
        throw new Error(data.error || "Failed to poll card build");
      }
      const status = String(data.job.status ?? "");
      if (status === "done") {
        const html = String(data.job.result_json?.cardHtml ?? "");
        if (!html) throw new Error("Card HTML missing from job result");
        return html;
      }
      if (status === "error") {
        throw new Error(String(data.job.error_text ?? "Card build failed"));
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
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

  async function hydrateTransferPanel(item: WatchlistItem) {
    const iframe = iframeRefs.current[item.id];
    if (!iframe) return;
    await waitForIframeReady(iframe);
    const doc = iframe.contentDocument;
    const placeholder = doc?.getElementById("transfer-projection-panel");
    if (!placeholder) return;
    const res = await fetch("/api/card/heavy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season: item.season,
        team: item.team,
        player: item.player,
        gender,
        destinationConference: dest,
        part: "transfer",
      }),
    });
    const data = (await res.json()) as { ok?: boolean; html?: string };
    if (!res.ok || !data.ok || !String(data.html ?? "").trim()) return;
    placeholder.outerHTML = String(data.html);
  }

  async function expandItem(item: WatchlistItem) {
    if (expandedIds[item.id]) {
      setExpandedIds((current) => ({ ...current, [item.id]: false }));
      return;
    }
    setExpandedIds((current) => ({ ...current, [item.id]: true }));
    if (cardHtmlById[item.id]) {
      if (mode === "transfer") {
        window.setTimeout(() => {
          void hydrateTransferPanel(item);
        }, 50);
      }
      return;
    }
    setCardLoadingById((current) => ({ ...current, [item.id]: true }));
    setCardErrorById((current) => ({ ...current, [item.id]: "" }));
    try {
      const res = await fetch("/api/jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType: "card",
          request: {
            gender,
            season: item.season,
            team: item.team,
            player: item.player,
            mode,
            destinationConference: mode === "transfer" ? dest : "",
          },
        }),
      });
      const data = (await res.json()) as JobApiResponse;
      if (!res.ok || !data.ok || !data.id) {
        throw new Error(data.error || "Failed to start card build");
      }
      const html = await pollJob(data.id);
      setCardHtmlById((current) => ({ ...current, [item.id]: html }));
      if (mode === "transfer") {
        window.setTimeout(() => {
          void hydrateTransferPanel(item);
        }, 50);
      }
    } catch (err) {
      setCardErrorById((current) => ({
        ...current,
        [item.id]: err instanceof Error ? err.message : "Failed to build card",
      }));
    } finally {
      setCardLoadingById((current) => ({ ...current, [item.id]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href={`/cards?gender=${gender}`} className="text-zinc-300">Player Profiles</Link>
            <Link href={`/roster?gender=${gender}`} className="text-zinc-300">Roster Construction</Link>
            <Link href={`/transfer-grades?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Transfer Grades</Link>
            <Link href={`/jason-created-stats?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Jason Created Stats</Link>
            <Link href={`/leaderboard?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Leaderboard</Link>
            <Link href={`/watchlist?gender=${gender}&season=${navSeason}`} className="text-red-400">Watchlist</Link>
            {gender === "men" && <Link href="/lineup-analysis" className="text-zinc-300">Lineup Analysis</Link>}
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Watchlist</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
            <select className="rounded bg-zinc-800 p-2" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {SEASONS.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <select
              className="rounded bg-zinc-800 p-2"
              value={team}
              onChange={(e) => {
                const nextTeam = e.target.value;
                setTeam(nextTeam);
                setPlayerSearch("");
                const nextPlayers = playersByTeam[nextTeam] ?? [];
                setPlayer(nextPlayers[0] ?? "");
              }}
            >
              {teamOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <input
              className="rounded bg-zinc-800 p-2"
              placeholder="Search player"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
            />
            <select className="rounded bg-zinc-800 p-2" value={player} onChange={(e) => setPlayer(e.target.value)}>
              {filteredPlayerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={mode} onChange={(e) => setMode(e.target.value === "draft" ? "draft" : "transfer")}>
              <option value="transfer">Transfer</option>
              <option value="draft">{gender === "women" ? "WNBA Draft" : "NBA Draft"}</option>
            </select>
            <select className="rounded bg-zinc-800 p-2" value={dest} onChange={(e) => setDest(e.target.value)} disabled={mode !== "transfer"}>
              {CONFERENCES.map((conference) => <option key={conference} value={conference}>{conference}</option>)}
            </select>
            <button type="button" className="rounded bg-red-500 px-4 py-2 font-semibold text-white" onClick={addPlayer}>
              Add Player
            </button>
          </div>
          {optionsError && <div className="mt-2 text-sm text-rose-400">{optionsError}</div>}
          {watchlistError && <div className="mt-2 text-sm text-rose-400">{watchlistError}</div>}
        </div>

        <div className="space-y-3">
          {loading ? <div className="text-sm text-zinc-500">Loading watchlist...</div> : null}
          {!loading && items.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
              No players on this watchlist yet.
            </div>
          ) : null}

          {items.map((item, index) => (
            <div
              key={item.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async () => {
                if (!dragId || dragId === item.id) return;
                const fromIndex = items.findIndex((entry) => entry.id === dragId);
                const toIndex = items.findIndex((entry) => entry.id === item.id);
                if (fromIndex < 0 || toIndex < 0) return;
                const next = [...items];
                const [moved] = next.splice(fromIndex, 1);
                next.splice(toIndex, 0, moved);
                setItems(next);
                setDragId("");
                try {
                  await persistOrder(next);
                } catch (err) {
                  setWatchlistError(err instanceof Error ? err.message : "Failed to reorder watchlist");
                  await loadWatchlist();
                }
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-bold">{index + 1}. {item.player}</div>
                  <div className="text-sm text-zinc-400">
                    {item.team} | {item.season} | Position: {item.pos || "N/A"} | Height: {item.height || "N/A"} | Statistical Height: {item.statistical_height || "N/A"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="rounded bg-zinc-800 px-3 py-2 text-sm" onClick={() => void expandItem(item)}>
                    {expandedIds[item.id] ? "Collapse" : "Expand Card"}
                  </button>
                  <button type="button" className="rounded bg-zinc-800 px-3 py-2 text-sm text-rose-300" onClick={() => void removeItem(item.id)}>
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                {Array.isArray(item.grades) && item.grades.length ? (
                  <div className="col-span-full grid grid-cols-2 gap-2 md:grid-cols-5">
                    {item.grades.slice(0, 5).map((grade) => (
                      <GradePill key={grade.label} label={grade.label} value={grade.value} />
                    ))}
                  </div>
                ) : null}
                <Stat label="MPG" value={item.values.mpg} percentile={item.percentiles.mpg} />
                <Stat label="PPG" value={item.values.ppg} percentile={item.percentiles.ppg} />
                <Stat label="APG" value={item.values.apg} percentile={item.percentiles.apg} />
                <Stat label="RPG" value={item.values.rpg} percentile={item.percentiles.rpg} />
                <Stat label="SPG" value={item.values.spg} percentile={item.percentiles.spg} />
                <Stat label="BPG" value={item.values.bpg} percentile={item.percentiles.bpg} />
                <Stat label="FG%" value={item.values.fg_pct} percentile={item.percentiles.fg_pct} />
                <Stat label="3P%" value={item.values.tp_pct} percentile={item.percentiles.tp_pct} />
                <Stat label="FT%" value={item.values.ft_pct} percentile={item.percentiles.ft_pct} />
              </div>

              {cardErrorById[item.id] ? <div className="mt-3 text-sm text-rose-400">{cardErrorById[item.id]}</div> : null}
              {cardLoadingById[item.id] ? <div className="mt-3 text-sm text-zinc-400">Building card...</div> : null}

              {expandedIds[item.id] && cardHtmlById[item.id] ? (
                <div className="mt-4 overflow-hidden rounded border border-zinc-800 bg-black">
                  <iframe
                    ref={(node) => {
                      iframeRefs.current[item.id] = node;
                    }}
                    title={`${item.player} card`}
                    srcDoc={cardHtmlById[item.id]}
                    className="h-[1500px] w-full"
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, percentile }: { label: string; value: number | null | undefined; percentile: number | null | undefined }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold">{fmtStatValue(label, value)}</div>
      <div className="text-xs text-zinc-500">P{fmtNumber(percentile)}</div>
    </div>
  );
}

function GradePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-100">{value}</div>
    </div>
  );
}
