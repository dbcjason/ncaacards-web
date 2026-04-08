"use client";

import { useEffect, useMemo, useState } from "react";

type WatchlistSummary = {
  id: string;
  name: string;
  sort_order: number;
  item_count: number;
};

type WatchlistApiResp = {
  ok?: boolean;
  error?: string;
  watchlists?: WatchlistSummary[];
  activeListId?: string;
};

export function AddToWatchlistDialog({
  open,
  gender,
  season,
  team,
  player,
  onClose,
}: {
  open: boolean;
  gender: "men" | "women";
  season: number;
  team: string;
  player: string;
  onClose: () => void;
}) {
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [activeListId, setActiveListId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const query = new URLSearchParams({
          gender,
          season: String(season),
        });
        const res = await fetch(`/api/watchlist?${query.toString()}`, { cache: "no-store" });
        const data = (await res.json()) as WatchlistApiResp;
        if (!active) return;
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load watchlists");
        const nextWatchlists = Array.isArray(data.watchlists) ? data.watchlists : [];
        setWatchlists(nextWatchlists);
        const fallback = nextWatchlists[0]?.id ? String(nextWatchlists[0].id) : "";
        setActiveListId(String(data.activeListId || fallback));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load watchlists");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, gender, season]);

  useEffect(() => {
    if (!open || !success) return;
    const timeout = window.setTimeout(() => {
      setSuccess("");
      onClose();
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [open, success, onClose]);

  const title = useMemo(() => {
    if (!player) return "Add to Watchlist";
    return `Add ${player} to Watchlist`;
  }, [player]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <div className="mb-1 text-lg font-semibold text-zinc-100">Add to Watchlist</div>
        <div className="mb-3 text-sm text-zinc-300">{title}</div>
        <div className="mb-3 rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-400">
          {team} • {season}
        </div>

        <div className="space-y-3">
          <select
            className="w-full rounded bg-zinc-800 p-2 text-zinc-100"
            value={activeListId}
            onChange={(e) => setActiveListId(e.target.value)}
            disabled={loading || saving || !watchlists.length}
          >
            {watchlists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>

          {loading ? <div className="text-xs text-zinc-400">Loading watchlists...</div> : null}
          {error ? <div className="text-xs text-rose-400">{error}</div> : null}
          {success ? <div className="text-xs text-emerald-400">{success}</div> : null}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={saving || loading || !activeListId || !player || !team}
            onClick={async () => {
              setSaving(true);
              setError("");
              setSuccess("");
              try {
                const res = await fetch("/api/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "addItem",
                    gender,
                    season,
                    listId: activeListId,
                    team,
                    player,
                  }),
                });
                const data = (await res.json()) as WatchlistApiResp;
                if (!res.ok || !data.ok) throw new Error(data.error || "Failed to add player");
                setSuccess("Player added.");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to add player");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Adding..." : "Add to Watchlist"}
          </button>
        </div>
      </div>
    </div>
  );
}
