"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global app error", error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-900 bg-black">
          <div className="mx-auto flex w-full max-w-[1900px] items-center justify-between px-6 py-5">
            <Link href="/" className="text-[15px] font-semibold tracking-[0.28em] text-white uppercase">
              DBCJASON
            </Link>
          </div>
        </header>
        <main className="flex min-h-[calc(100vh-77px)] items-center justify-center px-6 py-12">
          <div className="site-panel w-full max-w-xl rounded-xl p-6 text-zinc-100">
            <div className="space-y-3">
              <div className="text-2xl font-semibold">The site hit an unexpected error</div>
              <p className="text-sm text-zinc-400">
                The safest move is to retry the page. If this keeps happening, the app will still keep you inside the branded flow instead of dropping to a raw platform error.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" className="site-button" onClick={() => reset()}>
                Retry
              </button>
              <Link href="/" className="site-button-secondary text-center">
                Back to Log-In
              </Link>
            </div>
            {error?.digest ? (
              <div className="mt-6 text-xs text-zinc-500">Error reference: {error.digest}</div>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
