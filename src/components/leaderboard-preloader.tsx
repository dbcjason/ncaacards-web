"use client";

import { useEffect } from "react";

type LeaderboardPreloaderProps = {
  accessScope: "men" | "women" | "both";
};

const SEASON = 2026;
const STORAGE_KEY_PREFIX = "leaderboard-preload";

async function warmLeaderboard(gender: "men" | "women") {
  try {
    const res = await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gender,
        season: SEASON,
        sortBy: "ppg",
        sortMode: "stat",
        sortDir: "desc",
        limit: 750,
        minMpg: 10,
        filters: [],
      }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) return;
    const key = `${STORAGE_KEY_PREFIX}:${gender}:${SEASON}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        ts: Date.now(),
        data,
      }),
    );
  } catch {
    // best-effort preloader
  }
}

export function LeaderboardPreloader({ accessScope }: LeaderboardPreloaderProps) {
  useEffect(() => {
    const enabled = String(process.env.NEXT_PUBLIC_ENABLE_LEADERBOARD_PRELOAD ?? "0").trim() === "1";
    if (!enabled) return;

    const preload = () => {
      if (accessScope !== "women") void warmLeaderboard("men");
      if (accessScope !== "men") void warmLeaderboard("women");
    };

    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof ric === "function") {
      ric(preload);
      return;
    }
    const id = window.setTimeout(preload, 200);
    return () => window.clearTimeout(id);
  }, [accessScope]);

  return null;
}
