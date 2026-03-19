import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{process.env.NEXT_PUBLIC_APP_NAME ?? "DBCJASON-NCAAM"}</h1>
          <p className="text-zinc-400">Fast card + roster app scaffold (Vercel + DB + Redis).</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 hover:bg-zinc-800" href="/cards">
            <div className="text-xl font-semibold">Player Profiles</div>
            <div className="mt-2 text-sm text-zinc-400">Build cards and run transfer/draft mode.</div>
          </Link>
          <Link className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 hover:bg-zinc-800" href="/roster">
            <div className="text-xl font-semibold">Roster Construction</div>
            <div className="mt-2 text-sm text-zinc-400">Simulate add/remove and team metric changes.</div>
          </Link>
        </div>
      </main>
    </div>
  );
}
