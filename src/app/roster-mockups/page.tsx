"use client";

import Link from "next/link";

type Metric = {
  key: string;
  label: string;
  current: number;
  edited: number;
  currentRank: number;
  editedRank: number;
  higherIsBetter: boolean;
  group: "Offense" | "Defense" | "Shooting" | "Rebounding";
};

const TOTAL_TEAMS = 363;

const METRICS: Metric[] = [
  { key: "net", label: "Net Rtg", current: 9.3, edited: 12.4, currentRank: 66, editedRank: 31, higherIsBetter: true, group: "Offense" },
  { key: "off", label: "Off Rtg", current: 118.2, edited: 120.7, currentRank: 41, editedRank: 22, higherIsBetter: true, group: "Offense" },
  { key: "def", label: "Def Rtg", current: 108.9, edited: 105.8, currentRank: 84, editedRank: 45, higherIsBetter: false, group: "Defense" },
  { key: "ast100", label: "Ast/100", current: 20.8, edited: 22.6, currentRank: 117, editedRank: 69, higherIsBetter: true, group: "Offense" },
  { key: "tov100", label: "TOV/100", current: 15.5, edited: 14.2, currentRank: 132, editedRank: 88, higherIsBetter: false, group: "Offense" },
  { key: "stl100", label: "Stl/100", current: 8.9, edited: 9.7, currentRank: 96, editedRank: 57, higherIsBetter: true, group: "Defense" },
  { key: "blk100", label: "Blk/100", current: 6.3, edited: 7.1, currentRank: 122, editedRank: 74, higherIsBetter: true, group: "Defense" },
  { key: "reb100", label: "Reb/100", current: 38.1, edited: 40.3, currentRank: 109, editedRank: 63, higherIsBetter: true, group: "Rebounding" },
  { key: "oreb", label: "Off Reb%", current: 30.4, edited: 32.6, currentRank: 93, editedRank: 48, higherIsBetter: true, group: "Rebounding" },
  { key: "fg", label: "FG%", current: 47.0, edited: 48.6, currentRank: 101, editedRank: 60, higherIsBetter: true, group: "Shooting" },
  { key: "tp", label: "3P%", current: 35.3, edited: 37.1, currentRank: 88, editedRank: 44, higherIsBetter: true, group: "Shooting" },
  { key: "ts", label: "TS%", current: 58.1, edited: 60.0, currentRank: 95, editedRank: 49, higherIsBetter: true, group: "Shooting" },
];

function fmt(v: number): string {
  return v.toFixed(1);
}

function rankText(rank: number): string {
  return `${rank}/${TOTAL_TEAMS}`;
}

function statDelta(m: Metric): number {
  return m.edited - m.current;
}

function statDeltaText(m: Metric): string {
  const d = statDelta(m);
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

function deltaColor(m: Metric): string {
  const d = statDelta(m);
  const good = m.higherIsBetter ? d > 0 : d < 0;
  if (d === 0) return "text-[#D3D6DB]";
  return good ? "text-[#34D17B]" : "text-[#FF5D6E]";
}

function sectionTitle(title: string) {
  return <h2 className="mb-3 text-lg font-semibold text-[#F2F3F5]">{title}</h2>;
}

function sharedCardClass() {
  return "rounded-xl border border-[#2B2E36] bg-[#111319] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]";
}

function KpiCardsClassic() {
  return (
    <div className={sharedCardClass()}>
      {sectionTitle("KPI A) Classic 3-Column")}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-[#2B2E36] bg-[#0E1015] p-3">
            <div className="text-xs uppercase tracking-wide text-[#A7ADB7]">{m.label}</div>
            <div className="mt-2 grid grid-cols-3 items-end gap-2 text-center">
              <div>
                <div className="text-[10px] text-[#747C8A]">Current Roster</div>
                <div className="text-sm text-[#C6CBD3]">{fmt(m.current)}</div>
                <div className="text-[10px] text-[#747C8A]">{rankText(m.currentRank)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#747C8A]">New Roster</div>
                <div className="text-sm text-[#F2F3F5]">{fmt(m.edited)}</div>
                <div className="text-[10px] text-[#747C8A]">{rankText(m.editedRank)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#747C8A]">Stat Δ</div>
                <div className={`text-sm font-semibold ${deltaColor(m)}`}>{statDeltaText(m)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCardsTopline() {
  return (
    <div className={sharedCardClass()}>
      {sectionTitle("KPI B) Topline Delta")}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-[#2B2E36] bg-[#0E1015] p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[#E4E7EB]">{m.label}</div>
              <div className={`text-lg font-bold ${deltaColor(m)}`}>{statDeltaText(m)}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-[#161922] p-2">
                <div className="text-[#747C8A]">Current Roster</div>
                <div className="mt-1 text-base text-[#C6CBD3]">{fmt(m.current)}</div>
                <div className="text-[#A7ADB7]">{rankText(m.currentRank)}</div>
              </div>
              <div className="rounded bg-[#161922] p-2">
                <div className="text-[#747C8A]">New Roster</div>
                <div className="mt-1 text-base text-[#F2F3F5]">{fmt(m.edited)}</div>
                <div className="text-[#A7ADB7]">{rankText(m.editedRank)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCardsRowStrip() {
  return (
    <div className={sharedCardClass()}>
      {sectionTitle("KPI C) Dense Row Strips")}
      <div className="space-y-2">
        {METRICS.map((m) => (
          <div key={m.key} className="grid grid-cols-[120px_1fr_1fr_100px] items-center gap-3 rounded-lg border border-[#2B2E36] bg-[#0E1015] px-3 py-2 text-sm">
            <div className="font-medium text-[#D3D6DB]">{m.label}</div>
            <div>
              <div className="text-[#C6CBD3]">{fmt(m.current)}</div>
              <div className="text-[11px] text-[#747C8A]">Current Roster {rankText(m.currentRank)}</div>
            </div>
            <div>
              <div className="text-[#F2F3F5]">{fmt(m.edited)}</div>
              <div className="text-[11px] text-[#747C8A]">New Roster {rankText(m.editedRank)}</div>
            </div>
            <div className={`text-right font-semibold ${deltaColor(m)}`}>Δ {statDeltaText(m)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCardsGauge() {
  const max = Math.max(...METRICS.map((m) => Math.max(m.current, m.edited)), 1);
  const pct = (v: number) => (v / max) * 100;
  return (
    <div className={sharedCardClass()}>
      {sectionTitle("KPI D) Mini Gauge Cards")}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-[#2B2E36] bg-[#0E1015] p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-[#A7ADB7]">{m.label}</div>
            <div className="mb-1 text-xs text-[#A7ADB7]">Current Roster {fmt(m.current)} • {rankText(m.currentRank)}</div>
            <div className="h-2 rounded bg-[#1A1D24]"><div className="h-2 rounded bg-[#747C8A]" style={{ width: `${pct(m.current)}%` }} /></div>
            <div className="mt-2 mb-1 text-xs text-[#A7ADB7]">New Roster {fmt(m.edited)} • {rankText(m.editedRank)}</div>
            <div className="h-2 rounded bg-[#1A1D24]"><div className="h-2 rounded bg-[#5FA2FF]" style={{ width: `${pct(m.edited)}%` }} /></div>
            <div className={`mt-2 text-right text-sm font-semibold ${deltaColor(m)}`}>Stat Δ {statDeltaText(m)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCardsDualLine() {
  return (
    <div className={sharedCardClass()}>
      {sectionTitle("KPI E) Dual-Line Stat Cards")}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-[#2B2E36] bg-[#0E1015] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-[#E4E7EB]">{m.label}</div>
              <div className={`text-sm font-bold ${deltaColor(m)}`}>Δ {statDeltaText(m)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-[#161922] px-2 py-1">
                <div className="text-[#747C8A]">Current Roster</div>
                <div className="text-[#C6CBD3]">{fmt(m.current)} • {rankText(m.currentRank)}</div>
              </div>
              <div className="rounded bg-[#161922] px-2 py-1">
                <div className="text-[#747C8A]">New Roster</div>
                <div className="text-[#F2F3F5]">{fmt(m.edited)} • {rankText(m.editedRank)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RosterMockupsPage() {
  return (
    <div className="min-h-screen bg-[#0A0C10] text-[#F2F3F5]">
      <div className="mx-auto w-full max-w-[1500px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-5 text-sm">
            <Link href="/cards" className="text-[#C6CBD3]">Player Profiles</Link>
            <Link href="/roster" className="text-[#C6CBD3]">Roster Construction</Link>
            <Link href="/roster-mockups" className="text-[#FF5D6E]">Mockups</Link>
          </div>
          <Link href="/" className="text-[#A7ADB7]">Home</Link>
        </div>

        <h1 className="mb-2 text-2xl font-semibold text-[#F2F3F5]">KPI Card Design Mockups</h1>
        <p className="mb-5 text-sm text-[#A7ADB7]">All variants show Current Roster + New Roster stat/rank and Stat Δ. Rank format is rank/total-teams.</p>

        <div className="space-y-4">
          <KpiCardsClassic />
          <KpiCardsTopline />
          <KpiCardsRowStrip />
          <KpiCardsGauge />
          <KpiCardsDualLine />
        </div>
      </div>
    </div>
  );
}
