"use client";

import { useEffect } from "react";

export function HomeNoticePopup({
  notice,
  popup,
}: {
  notice: string;
  popup: boolean;
}) {
  useEffect(() => {
    if (!popup || !notice) return;
    window.alert(notice);
  }, [popup, notice]);

  return null;
}

