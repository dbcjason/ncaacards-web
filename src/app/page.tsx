import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">DBCJASON.COM</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 hover:bg-zinc-800" href="/cards?gender=men">
            <div className="text-xl font-semibold">Men</div>
            <div className="mt-2 text-sm text-zinc-400">Open Men Player Profiles and Roster Construction.</div>
          </Link>
          <Link className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 hover:bg-zinc-800" href="/cards?gender=women">
            <div className="text-xl font-semibold">Women</div>
            <div className="mt-2 text-sm text-zinc-400">Open Women Player Profiles and Roster Construction.</div>
          </Link>
        </div>
      </main>
    </div>
  );
}
