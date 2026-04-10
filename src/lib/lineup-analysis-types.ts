export type LineupRow = {
  id: string;
  players: [string, string, string, string, string];
  minutes: number;
  possessions: number;
  pointsFor: number;
  pointsAgainst: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  offRimRate?: number;
  offRimPct?: number;
  defRimRate?: number;
  defRimPct?: number;
};

export type LineupOptionSummary = {
  key: string;
  label: string;
  season: string;
  team: string;
  lineupCount: number;
};

export type LineupOptionPayload = {
  key: string;
  label: string;
  season: string;
  team: string;
  players: string[];
  lineups: LineupRow[];
};

export type LineupGender = "men" | "women";
