"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error", error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-77px)] items-center justify-center px-6 py-12">
      <div className="site-panel w-full max-w-xl rounded-xl p-6 text-zinc-100">
        <div className="space-y-3">
          <div className="text-2xl font-semibold">Something went wrong</div>
          <p className="text-sm text-zinc-400">
            The page hit an unexpected error. We can retry it without kicking you out of the site.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" className="site-button" onClick={() => reset()}>
            Try Again
          </button>
          <Link href="/" className="site-button-secondary text-center">
            Back to Log-In
          </Link>
        </div>
        {error?.digest ? (
          <div className="mt-6 text-xs text-zinc-500">Error reference: {error.digest}</div>
        ) : null}
      </div>
    </div>
  );
}
