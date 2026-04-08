"use client";

import { useEffect } from "react";
import { warmAllWatchlistsForSession } from "@/lib/watchlist-profile-session";

export function WatchlistSessionPreloader({
  accessScope,
  favoriteConference,
}: {
  accessScope: "men" | "women" | "both";
  favoriteConference: string;
}) {
  useEffect(() => {
    void warmAllWatchlistsForSession({
      accessScope,
      favoriteConference,
    });
  }, [accessScope, favoriteConference]);

  return null;
}
