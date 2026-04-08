"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CONFERENCES, SEASONS } from "@/lib/ui-options";
import {
  buildWatchlistWarmRequest,
  getCachedWatchlistProfile,
  warmWatchlistProfile,
} from "@/lib/watchlist-profile-session";

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

type TransferGradeRow = Record<string, string>;
type WatchlistSummary = {
  id: string;
  name: string;
  sort_order: number;
  item_count: number;
};

type PlayerChoice = {
  value: string;
  player: string;
  team: string;
  label: string;
};

type NoteSaveState = "idle" | "saved";
const CARD_IFRAME_BASE_WIDTH = 1110;
const CARD_IFRAME_BASE_HEIGHT = 2300;

function fmtNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtStatValue(label: string, value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (label.includes("%")) return value.toFixed(1);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtPercentile(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value)}%tile`;
}

function percentileTone(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-zinc-500";
  if (value >= 75) return "text-emerald-400";
  if (value <= 25) return "text-rose-400";
  return "text-zinc-500";
}

function transferConferenceCandidates(raw: string) {
  const value = String(raw || "").trim();
  const compact = value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const map: Record<string, string[]> = {
    ACC: ["ACC"],
    AMERICAEAST: ["AE", "America East"],
    AMERICAN: ["AMER", "American"],
    ASUN: ["ASUN"],
    ATLANTIC10: ["A10", "Atlantic 10"],
    BIGSKY: ["BSKY", "Big Sky"],
    BIG12: ["B12", "Big 12"],
    BIGEAST: ["BE", "Big East"],
    BIGTEN: ["B10", "Big Ten"],
    BIGWEST: ["BW", "Big West"],
    CAA: ["CAA"],
    CONFERENCEUSA: ["CUSA", "Conference USA"],
    HORIZON: ["HORZ", "Horizon"],
    IVY: ["Ivy"],
    MAAC: ["MAAC"],
    MAC: ["MAC"],
    MEAC: ["MEAC"],
    MISSOURIVALLEY: ["MVC", "Missouri Valley"],
    MOUNTAINWEST: ["Mountain West"],
    NORTHEAST: ["NEC", "Northeast"],
    OHIOVALLEY: ["OVC", "Ohio Valley"],
    PATRIOT: ["PAT", "Patriot"],
    SEC: ["SEC"],
    SOCON: ["SC", "SoCon"],
    SOUTHLAND: ["SLND", "Southland"],
    SUMMIT: ["SUM", "Summit"],
    SUNBELT: ["SB", "Sun Belt"],
    SWAC: ["SWAC"],
    WAC: ["WAC"],
    WCC: ["WCC"],
  };
  return map[compact] ?? [value];
}

function parseTransferGradeFromHtml(html: string) {
  const match = html.match(/Transfer Grade:\s*([ABCDF][+-]?)/i);
  return match ? String(match[1]).toUpperCase() : "";
}

function ScaledCardFrame({
  html,
  title,
  setFrameRef,
}: {
  html: string;
  title: string;
  setFrameRef: (node: HTMLIFrameElement | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.325);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const updateScale = () => {
      const nextScale = node.clientWidth / CARD_IFRAME_BASE_WIDTH;
      if (Number.isFinite(nextScale) && nextScale > 0) {
        setScale(nextScale);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scaledHeight = Math.round(CARD_IFRAME_BASE_HEIGHT * scale);

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded">
      <div className="relative w-full" style={{ height: `${scaledHeight}px` }}>
        <iframe
          ref={setFrameRef}
          title={title}
          srcDoc={html}
          className="absolute left-0 top-0 rounded border-0"
          style={
            {
              width: `${CARD_IFRAME_BASE_WIDTH}px`,
              height: `${CARD_IFRAME_BASE_HEIGHT}px`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            } as CSSProperties
          }
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
    </div>
  );
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
  const [favoriteTeam, setFavoriteTeam] = useState("");
  const [favoriteConference, setFavoriteConference] = useState("SEC");
  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const [playersByTeam, setPlayersByTeam] = useState<Record<string, string[]>>({});
  const [playerChoiceValue, setPlayerChoiceValue] = useState("");
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [transferRows, setTransferRows] = useState<TransferGradeRow[]>([]);
  const [liveTransferGrades, setLiveTransferGrades] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [cardHtmlById, setCardHtmlById] = useState<Record<string, string>>({});
  const [cardRequestKeyById, setCardRequestKeyById] = useState<Record<string, string>>({});
  const [cardLoadingById, setCardLoadingById] = useState<Record<string, boolean>>({});
  const [cardErrorById, setCardErrorById] = useState<Record<string, string>>({});
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [noteSaveStateById, setNoteSaveStateById] = useState<Record<string, NoteSaveState>>({});
  const [dragId, setDragId] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [watchlistError, setWatchlistError] = useState("");
  const [loading, setLoading] = useState(false);
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [activeListId, setActiveListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [renameListName, setRenameListName] = useState("");
  const [multiWatchlistsEnabled, setMultiWatchlistsEnabled] = useState(true);
  const activeConference = (dest || favoriteConference || "SEC").trim() || "SEC";

  const noteStorageKeyFor = (item: WatchlistItem) =>
    `watchlist-note::${gender}::${item.season}::${item.team.trim().toLowerCase()}::${item.player.trim().toLowerCase()}`;
  const requestKeyForItem = useCallback((item: Pick<WatchlistItem, "season" | "team" | "player">) => {
    return [
      gender,
      String(item.season),
      item.team.trim().toLowerCase(),
      item.player.trim().toLowerCase(),
      mode,
      mode === "transfer" ? activeConference.toLowerCase() : "",
    ].join("::");
  }, [activeConference, gender, mode]);

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

  useEffect(() => {
    const g = searchParams.get("gender");
    setGender(g === "women" ? "women" : "men");
    const seasonParam = Number(searchParams.get("season"));
    if (Number.isFinite(seasonParam) && seasonParam > 2000) setSeason(seasonParam);
  }, [searchParams]);

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
        setFavoriteConference(nextFavoriteConference);
        setDest((current) => (current === "SEC" ? nextFavoriteConference : current));
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, []);

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
        const nextTeam = nextTeams.includes(team)
          ? team
          : favoriteTeam && nextTeams.includes(favoriteTeam)
            ? favoriteTeam
            : nextTeams[0] ?? "";
        const nextPlayers = nextPlayersByTeam[nextTeam] ?? [];
        const nextPlayer = nextPlayers.includes(player) ? player : nextPlayers[0] ?? "";
        setTeamOptions(nextTeams);
        setPlayersByTeam(nextPlayersByTeam);
        setTeam(nextTeam);
        setPlayer(nextPlayer);
        setPlayerChoiceValue(nextPlayer && nextTeam ? `${nextPlayer}|||${nextTeam}` : "");
      } catch (err) {
        if (!active) return;
        setOptionsError(err instanceof Error ? err.message : "Failed to load options");
      }
    })();
    return () => {
      active = false;
    };
  }, [gender, season, favoriteTeam]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/transfer-grades?gender=${gender}&season=${season}`, { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; rows?: TransferGradeRow[] };
        if (!active || !res.ok || !data.ok) return;
        setTransferRows(Array.isArray(data.rows) ? data.rows : []);
      } catch {
        if (active) setTransferRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [gender, season]);

  const loadWatchlist = useCallback(async (listId?: string) => {
    setLoading(true);
    setWatchlistError("");
    try {
      const query = new URLSearchParams({ gender, season: String(season) });
      if (listId) query.set("listId", listId);
      const res = await fetch(`/api/watchlist?${query.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: WatchlistItem[];
        watchlists?: WatchlistSummary[];
        activeListId?: string;
        multiWatchlistsEnabled?: boolean;
      };
      if (isAuthError(res.status, data.error)) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load watchlist");
      setItems(Array.isArray(data.items) ? data.items : []);
      const nextWatchlists = Array.isArray(data.watchlists) ? data.watchlists : [];
      setWatchlists(nextWatchlists);
      setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
      const nextActive = String(data.activeListId ?? "");
      setActiveListId(nextActive);
      const currentActive = nextWatchlists.find((entry) => entry.id === nextActive);
      if (currentActive) setRenameListName(currentActive.name);
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to load watchlist");
      setItems([]);
      setWatchlists([]);
      setActiveListId("");
      setMultiWatchlistsEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [gender, season]);

  useEffect(() => {
    void loadWatchlist();
  }, [loadWatchlist]);

  useEffect(() => {
    if (!items.length) return;
    const hydrated: Record<string, string> = {};
    const hydratedKeys: Record<string, string> = {};
    for (const item of items) {
      const req = buildWatchlistWarmRequest({
        gender,
        season: item.season,
        team: item.team,
        player: item.player,
        mode,
        destinationConference: activeConference,
      });
      const cached = getCachedWatchlistProfile(req);
      if (!cached) continue;
      hydrated[item.id] = cached;
      hydratedKeys[item.id] = requestKeyForItem(item);
    }
    if (!Object.keys(hydrated).length) return;
    setCardHtmlById((current) => ({ ...current, ...hydrated }));
    setCardRequestKeyById((current) => ({ ...current, ...hydratedKeys }));
  }, [activeConference, gender, items, mode, requestKeyForItem]);

  useEffect(() => {
    if (!items.length) return;
    let active = true;
    const queue = items.map((item) => ({
      id: item.id,
      req: buildWatchlistWarmRequest({
        gender,
        season: item.season,
        team: item.team,
        player: item.player,
        mode,
        destinationConference: activeConference,
      }),
    }));

    (async () => {
      for (const entry of queue) {
        try {
          const html = await warmWatchlistProfile(entry.req);
          if (!active || !html) continue;
          setCardHtmlById((current) => {
            if (current[entry.id]) return current;
            return { ...current, [entry.id]: html };
          });
          setCardRequestKeyById((current) => {
            if (current[entry.id]) return current;
            const source = items.find((item) => item.id === entry.id);
            if (!source) return current;
            return { ...current, [entry.id]: requestKeyForItem(source) };
          });
        } catch {}
      }
    })();

    return () => {
      active = false;
    };
  }, [activeConference, gender, items, mode, requestKeyForItem]);

  useEffect(() => {
    if (!watchlists.length) return;
    const currentActive = watchlists.find((entry) => entry.id === activeListId);
    if (currentActive) setRenameListName(currentActive.name);
  }, [activeListId, watchlists]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const item of items) {
      try {
        const saved = window.localStorage.getItem(noteStorageKeyFor(item));
        next[item.id] = saved ?? "";
      } catch {
        next[item.id] = "";
      }
    }
    setNotesById(next);
    setNoteSaveStateById({});
  }, [items, gender]);

  const allPlayerChoices = useMemo<PlayerChoice[]>(() => {
    const out: PlayerChoice[] = [];
    for (const [teamName, players] of Object.entries(playersByTeam)) {
      for (const playerName of players) {
        out.push({
          value: `${playerName}|||${teamName}`,
          player: playerName,
          team: teamName,
          label: `${playerName} - ${teamName}`,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [playersByTeam]);
  const filteredPlayerOptions = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
    if (!needle) return allPlayerChoices;
    return allPlayerChoices.filter((option) => option.label.toLowerCase().includes(needle));
  }, [allPlayerChoices, playerSearch]);

  useEffect(() => {
    if (!filteredPlayerOptions.length) {
      setPlayerChoiceValue("");
      setPlayer("");
      return;
    }
    const selectedStillVisible = filteredPlayerOptions.some((option) => option.value === playerChoiceValue);
    if (selectedStillVisible) return;
    const next = filteredPlayerOptions[0];
    setPlayerChoiceValue(next.value);
    setPlayer(next.player);
    setTeam(next.team);
  }, [filteredPlayerOptions, playerChoiceValue]);
  const navSeason = season || 2026;
  const transferRowByKey = useMemo(() => {
    const map = new Map<string, TransferGradeRow>();
    for (const row of transferRows) {
      const key = `${String(row.season || "").trim()}::${String(row.team || "").trim().toLowerCase()}::${String(row.player || "").trim().toLowerCase()}`;
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  }, [transferRows]);
  const transferRowByPlayerKey = useMemo(() => {
    const grouped = new Map<string, TransferGradeRow[]>();
    for (const row of transferRows) {
      const key = `${String(row.season || "").trim()}::${String(row.player || "").trim().toLowerCase()}`;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    const unique = new Map<string, TransferGradeRow>();
    for (const [key, list] of grouped.entries()) {
      if (list.length === 1) unique.set(key, list[0]);
    }
    return unique;
  }, [transferRows]);

  function getTransferRow(item: { season: number; team: string; player: string }) {
    const exactKey = `${item.season}::${item.team.trim().toLowerCase()}::${item.player.trim().toLowerCase()}`;
    const exact = transferRowByKey.get(exactKey);
    if (exact) return exact;
    const playerOnlyKey = `${item.season}::${item.player.trim().toLowerCase()}`;
    return transferRowByPlayerKey.get(playerOnlyKey);
  }

  useEffect(() => {
    if (mode !== "transfer" || !items.length) return;
    const conference = dest || favoriteConference || "SEC";
    const missing = items.filter((item) => {
      const baseKey = `${item.season}::${item.team.trim().toLowerCase()}::${item.player.trim().toLowerCase()}`;
      const row = getTransferRow(item);
      const csvGrade = row
        ? transferConferenceCandidates(conference)
            .map((candidate) => String(row[candidate] || "").trim())
            .find(Boolean)
        : "";
      return !csvGrade && !liveTransferGrades[`${baseKey}::${conference}`];
    });
    if (!missing.length) return;

    let active = true;
    (async () => {
      for (const item of missing) {
        const baseKey = `${item.season}::${item.team.trim().toLowerCase()}::${item.player.trim().toLowerCase()}`;
        try {
          const res = await fetch("/api/card/heavy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              season: item.season,
              team: item.team,
              player: item.player,
              gender,
              destinationConference: conference,
              part: "transfer",
            }),
          });
          const data = (await res.json()) as { ok?: boolean; html?: string };
          if (!active || !res.ok || !data.ok) continue;
          const grade = parseTransferGradeFromHtml(String(data.html ?? ""));
          if (grade) {
            setLiveTransferGrades((current) => ({ ...current, [`${baseKey}::${conference}`]: grade }));
          }
        } catch {}
      }
    })();

    return () => {
      active = false;
    };
  }, [dest, favoriteConference, gender, items, liveTransferGrades, mode, transferRowByKey, transferRowByPlayerKey]);

  async function addPlayer() {
    const selectedOption = allPlayerChoices.find((option) => option.value === playerChoiceValue);
    const nextPlayer = String(selectedOption?.player || "").trim();
    const nextTeam = String(selectedOption?.team || "").trim();
    if (!nextTeam || !nextPlayer) {
      setWatchlistError("Select a player from the dropdown before adding.");
      return;
    }
    setWatchlistError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender, season, listId: activeListId, team: nextTeam, player: nextPlayer }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: WatchlistItem[];
        watchlists?: WatchlistSummary[];
        activeListId?: string;
        multiWatchlistsEnabled?: boolean;
      };
      if (isAuthError(res.status, data.error)) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to add player");
      setItems(Array.isArray(data.items) ? data.items : []);
      setWatchlists(Array.isArray(data.watchlists) ? data.watchlists : []);
      setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
      setActiveListId(String(data.activeListId ?? activeListId));
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to add player");
    }
  }

  async function removeItem(id: string) {
    setWatchlistError("");
    try {
      const query = new URLSearchParams({ gender, season: String(season), id });
      if (activeListId) query.set("listId", activeListId);
      const res = await fetch(`/api/watchlist?${query.toString()}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: WatchlistItem[];
        watchlists?: WatchlistSummary[];
        activeListId?: string;
        multiWatchlistsEnabled?: boolean;
      };
      if (isAuthError(res.status, data.error)) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to remove player");
      setItems(Array.isArray(data.items) ? data.items : []);
      setWatchlists(Array.isArray(data.watchlists) ? data.watchlists : []);
      setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
      setActiveListId(String(data.activeListId ?? activeListId));
      setExpandedIds((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setCardHtmlById((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setCardRequestKeyById((current) => {
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
      body: JSON.stringify({ gender, season, listId: activeListId, orderedIds }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      items?: WatchlistItem[];
      watchlists?: WatchlistSummary[];
      activeListId?: string;
      multiWatchlistsEnabled?: boolean;
    };
    if (isAuthError(res.status, data.error)) {
      redirectToLogin();
      return;
    }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to reorder watchlist");
    }
    setItems(Array.isArray(data.items) ? data.items : nextItems);
    setWatchlists(Array.isArray(data.watchlists) ? data.watchlists : []);
    setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
    setActiveListId(String(data.activeListId ?? activeListId));
  }

  async function createWatchlist() {
    const name = newListName.trim();
    if (!name) return;
    if (!multiWatchlistsEnabled) {
      setWatchlistError("Multiple watchlists will activate after database migration runs.");
      return;
    }
    setWatchlistError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createList", gender, season, name }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: WatchlistItem[];
        watchlists?: WatchlistSummary[];
        activeListId?: string;
        multiWatchlistsEnabled?: boolean;
      };
      if (isAuthError(res.status, data.error)) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to create watchlist");
      setItems(Array.isArray(data.items) ? data.items : []);
      const nextWatchlists = Array.isArray(data.watchlists) ? data.watchlists : [];
      setWatchlists(nextWatchlists);
      setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
      const nextActive = String(data.activeListId ?? "");
      setActiveListId(nextActive);
      const currentActive = nextWatchlists.find((entry) => entry.id === nextActive);
      if (currentActive) setRenameListName(currentActive.name);
      setNewListName("");
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to create watchlist");
    }
  }

  async function renameWatchlist() {
    const name = renameListName.trim();
    if (!activeListId || !name) return;
    if (!multiWatchlistsEnabled) {
      setWatchlistError("Multiple watchlists will activate after database migration runs.");
      return;
    }
    setWatchlistError("");
    const previous = watchlists;
    setWatchlists((current) => current.map((entry) => (entry.id === activeListId ? { ...entry, name } : entry)));
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renameList",
          gender,
          season,
          listId: activeListId,
          name,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: WatchlistItem[];
        watchlists?: WatchlistSummary[];
        activeListId?: string;
        multiWatchlistsEnabled?: boolean;
      };
      if (isAuthError(res.status, data.error)) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to rename watchlist");
      setItems(Array.isArray(data.items) ? data.items : []);
      setWatchlists(Array.isArray(data.watchlists) ? data.watchlists : []);
      setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
      setActiveListId(String(data.activeListId ?? activeListId));
    } catch (err) {
      setWatchlists(previous);
      setWatchlistError(err instanceof Error ? err.message : "Failed to rename watchlist");
    }
  }

  async function deleteWatchlist() {
    if (!activeListId) return;
    if (!multiWatchlistsEnabled) {
      setWatchlistError("Multiple watchlists will activate after database migration runs.");
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this watchlist and all players in it?");
      if (!confirmed) return;
    }
    setWatchlistError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteList",
          gender,
          season,
          listId: activeListId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: WatchlistItem[];
        watchlists?: WatchlistSummary[];
        activeListId?: string;
        multiWatchlistsEnabled?: boolean;
      };
      if (isAuthError(res.status, data.error)) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to delete watchlist");
      setItems(Array.isArray(data.items) ? data.items : []);
      const nextWatchlists = Array.isArray(data.watchlists) ? data.watchlists : [];
      setWatchlists(nextWatchlists);
      setMultiWatchlistsEnabled(data.multiWatchlistsEnabled !== false);
      const nextActive = String(data.activeListId ?? "");
      setActiveListId(nextActive);
      const currentActive = nextWatchlists.find((entry) => entry.id === nextActive);
      if (currentActive) setRenameListName(currentActive.name);
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to delete watchlist");
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
    const itemRequestKey = requestKeyForItem(item);
    if (expandedIds[item.id]) {
      setExpandedIds((current) => ({ ...current, [item.id]: false }));
      return;
    }
    setExpandedIds((current) => ({ ...current, [item.id]: true }));
    if (cardHtmlById[item.id] && cardRequestKeyById[item.id] === itemRequestKey) {
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
      const req = buildWatchlistWarmRequest({
        gender,
        season: item.season,
        team: item.team,
        player: item.player,
        mode,
        destinationConference: activeConference,
      });
      const html = await warmWatchlistProfile(req);
      setCardHtmlById((current) => ({ ...current, [item.id]: html }));
      setCardRequestKeyById((current) => ({ ...current, [item.id]: itemRequestKey }));
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

  function saveNote(item: WatchlistItem) {
    try {
      window.localStorage.setItem(noteStorageKeyFor(item), String(notesById[item.id] ?? ""));
      setNoteSaveStateById((current) => ({ ...current, [item.id]: "saved" }));
      window.setTimeout(() => {
        setNoteSaveStateById((current) => ({ ...current, [item.id]: "idle" }));
      }, 1500);
    } catch {
      setWatchlistError("Could not save note in this browser.");
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
            <Link href={`/leaderboard?gender=${gender}&season=${navSeason}`} className="text-zinc-300">Leaderboard</Link>
            <Link href={`/watchlist?gender=${gender}&season=${navSeason}`} className="text-red-400">Watchlist</Link>
          </div>
          <Link href={`/?gender=${gender}`} className="text-zinc-400">Home</Link>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="mb-2 text-lg font-bold">Watchlist</div>
          <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1.2fr_1fr_auto_0.8fr_auto_auto]">
            <select
              className="rounded bg-zinc-800 p-2"
              value={activeListId}
              onChange={(e) => {
                const nextId = e.target.value;
                setActiveListId(nextId);
                void loadWatchlist(nextId);
              }}
            >
              {watchlists.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <input
              className="rounded bg-zinc-800 p-2"
              placeholder="New watchlist name"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              disabled={!multiWatchlistsEnabled}
            />
            <button
              type="button"
              className="rounded bg-zinc-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={createWatchlist}
              disabled={!multiWatchlistsEnabled}
            >
              Create List
            </button>
            <input
              className="rounded bg-zinc-800 p-2"
              placeholder="Rename current list"
              value={renameListName}
              onChange={(e) => setRenameListName(e.target.value)}
              disabled={!activeListId || !multiWatchlistsEnabled}
            />
            <button
              type="button"
              className="rounded bg-zinc-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={renameWatchlist}
              disabled={!activeListId || !multiWatchlistsEnabled}
            >
              Rename
            </button>
            <button
              type="button"
              className="rounded bg-rose-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={deleteWatchlist}
              disabled={!activeListId || !multiWatchlistsEnabled}
            >
              Delete List
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
            <select className="rounded bg-zinc-800 p-2" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {SEASONS.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <input
              className="rounded bg-zinc-800 p-2"
              placeholder="Search any player"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
            />
            <select
              className="rounded bg-zinc-800 p-2"
              value={playerChoiceValue}
              onChange={(e) => {
                const value = e.target.value;
                setPlayerChoiceValue(value);
                const [nextPlayer, nextTeam] = value.split("|||");
                setPlayer(nextPlayer || "");
                if (nextTeam) setTeam(nextTeam);
              }}
            >
              {!filteredPlayerOptions.length ? <option value="">No matching players</option> : null}
              {filteredPlayerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="rounded bg-zinc-800 p-2" value={mode} onChange={() => setMode("transfer")}>
              <option value="transfer">Transfer</option>
            </select>
            <select className="rounded bg-zinc-800 p-2" value={dest} onChange={(e) => setDest(e.target.value)} disabled={mode !== "transfer"}>
              {CONFERENCES.map((conference) => <option key={conference} value={conference}>{conference}</option>)}
            </select>
            <button
              type="button"
              className="rounded bg-red-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={addPlayer}
              disabled={!activeListId}
            >
              Add Player
            </button>
          </div>
          {optionsError && <div className="mt-2 text-sm text-rose-400">{optionsError}</div>}
          {!multiWatchlistsEnabled ? (
            <div className="mt-2 text-sm text-amber-300">
              Multiple watchlists are pending a database migration. Your current watchlist is still saved.
            </div>
          ) : null}
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
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto]">
                <div>
                  <div className="text-xl font-bold">{index + 1}. {item.player}</div>
                  <div className="text-sm text-zinc-400">
                    {item.team} | {item.conference || "N/A"} | {item.season} | Class: {item.class || "N/A"} | Position: {item.pos || "N/A"} | {gender === "men" ? `Age: ${fmtNumber(item.age)} | ` : ""}Height: {item.height || "N/A"} | Statistical Height: {item.statistical_height || "N/A"}
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {Array.isArray(item.grades) && item.grades.length ? item.grades.slice(0, 5).map((grade) => (
                    <GradePill key={grade.label} label={grade.label} value={grade.value} />
                  )) : null}
                  <TransferGradePill
                    conference={dest || favoriteConference || "SEC"}
                    value={(() => {
                      const conference = dest || favoriteConference || "SEC";
                      const baseKey = `${item.season}::${item.team.trim().toLowerCase()}::${item.player.trim().toLowerCase()}`;
                      const row = getTransferRow(item);
                      const csvGrade = row
                        ? transferConferenceCandidates(conference)
                            .map((candidate) => String(row[candidate] || "").trim())
                            .find(Boolean)
                        : "";
                      return csvGrade || liveTransferGrades[`${baseKey}::${conference}`] || "N/A";
                    })()}
                  />
                </div>
                <div className="flex gap-2 xl:justify-end">
                  <button type="button" className="rounded bg-zinc-800 px-3 py-2 text-sm" onClick={() => void expandItem(item)}>
                    {expandedIds[item.id] ? "Collapse" : "Expand Card"}
                  </button>
                  <button type="button" className="rounded bg-zinc-800 px-3 py-2 text-sm text-rose-300" onClick={() => void removeItem(item.id)}>
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-8">
                <Stat label="PPG" value={item.values.ppg} percentile={item.percentiles.ppg} />
                <Stat label="APG" value={item.values.apg} percentile={item.percentiles.apg} />
                <Stat label="RPG" value={item.values.rpg} percentile={item.percentiles.rpg} />
                <Stat label="SPG" value={item.values.spg} percentile={item.percentiles.spg} />
                <Stat label="BPG" value={item.values.bpg} percentile={item.percentiles.bpg} />
                <Stat label="FG%" value={item.values.fg_pct} percentile={item.percentiles.fg_pct} />
                <Stat label="3P%" value={item.values.tp_pct} percentile={item.percentiles.tp_pct} />
                <Stat label="FT%" value={item.values.ft_pct} percentile={item.percentiles.ft_pct} />
                </div>
              </div>

              {cardErrorById[item.id] ? <div className="mt-3 text-sm text-rose-400">{cardErrorById[item.id]}</div> : null}
              {cardLoadingById[item.id] ? <div className="mt-3 text-sm text-zinc-400">Building card...</div> : null}

              {expandedIds[item.id] ? (
                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className="overflow-hidden rounded border border-zinc-800 bg-black">
                    {cardHtmlById[item.id] ? (
                      <ScaledCardFrame
                        html={cardHtmlById[item.id]}
                        title={`${item.player} card`}
                        setFrameRef={(node) => {
                          iframeRefs.current[item.id] = node;
                        }}
                      />
                    ) : (
                      <div className="flex min-h-[420px] items-center justify-center text-sm text-zinc-400">
                        {cardLoadingById[item.id] ? "Building card..." : "Card preview unavailable."}
                      </div>
                    )}
                  </div>
                  <div className="flex h-full flex-col rounded border border-zinc-800 bg-zinc-950 p-4">
                    <div className="mb-2 text-base font-semibold text-zinc-100">Notes</div>
                    <textarea
                      className="min-h-[320px] w-full flex-1 rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                      placeholder="Add notes on this player..."
                      value={notesById[item.id] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNotesById((current) => ({ ...current, [item.id]: value }));
                        setNoteSaveStateById((current) => ({ ...current, [item.id]: "idle" }));
                      }}
                    />
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => saveNote(item)}
                      >
                        Save
                      </button>
                      {noteSaveStateById[item.id] === "saved" ? (
                        <span className="text-xs text-emerald-400">Saved</span>
                      ) : (
                        <span className="text-xs text-zinc-500">Notes are saved per player on this account/browser.</span>
                      )}
                    </div>
                  </div>
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
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold">{fmtStatValue(label, value)}</div>
      <div className={`text-xs ${percentileTone(percentile)}`}>{fmtPercentile(percentile)}</div>
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

function TransferGradePill({ conference, value }: { conference: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Transfer Grade ({conference || "SEC"})</div>
      <div className="text-sm font-semibold text-zinc-100">{value || "N/A"}</div>
    </div>
  );
}
