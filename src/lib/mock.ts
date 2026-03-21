export function buildCardPayload(input: {
  season: number;
  team: string;
  player: string;
  mode: "draft" | "transfer";
  destinationConference?: string;
}) {
  return {
    ok: true,
    source: "mock",
    generatedAt: new Date().toISOString(),
    input,
    cardHtml: `<div style="font-family: system-ui; padding: 16px;">
      <h2>${input.player} (${input.season})</h2>
      <p>Team: ${input.team}</p>
      <p>Mode: ${input.mode}</p>
      <p>Destination: ${input.destinationConference || "N/A"}</p>
    </div>`,
  };
}

export function buildRosterPayload(input: {
  season: number;
  team: string;
  addPlayers: string[];
  removePlayers: string[];
  addMinutes?: Record<string, number>;
  removeMinutes?: Record<string, number>;
}) {
  return {
    ok: true,
    source: "mock",
    generatedAt: new Date().toISOString(),
    input,
    metrics: [
      { metric: "Net Rtg", current: 12.1, edited: 13.4, delta: 1.3, current_rank: 61, edited_rank: 39, total_teams: 363 },
      { metric: "Off Rtg", current: 118.0, edited: 119.2, delta: 1.2, current_rank: 44, edited_rank: 28, total_teams: 363 },
      { metric: "Def Rtg", current: 105.9, edited: 105.8, delta: -0.1, current_rank: 88, edited_rank: 83, total_teams: 363 },
      { metric: "Ast/100", current: 20.4, edited: 21.0, delta: 0.6, current_rank: 122, edited_rank: 97, total_teams: 363 },
      { metric: "TOV/100", current: 14.5, edited: 14.2, delta: -0.3, current_rank: 130, edited_rank: 103, total_teams: 363 },
      { metric: "Stl/100", current: 8.7, edited: 8.9, delta: 0.2, current_rank: 109, edited_rank: 93, total_teams: 363 },
      { metric: "Blk/100", current: 4.0, edited: 4.2, delta: 0.2, current_rank: 141, edited_rank: 119, total_teams: 363 },
      { metric: "Reb/100", current: 36.4, edited: 37.2, delta: 0.8, current_rank: 126, edited_rank: 92, total_teams: 363 },
      { metric: "Off Reb%", current: 28.1, edited: 28.6, delta: 0.5, current_rank: 116, edited_rank: 95, total_teams: 363 },
    ],
  };
}
