import { redirect } from "next/navigation";

export default async function JasonCreatedStatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ gender?: string; season?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const gender = params.gender === "women" ? "women" : "men";
  const season = String(params.season ?? "2026").trim() || "2026";
  redirect(`/leaderboard?gender=${gender}&season=${encodeURIComponent(season)}`);
}
