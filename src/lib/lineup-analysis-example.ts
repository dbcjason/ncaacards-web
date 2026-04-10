export type DukeExampleLineup = {
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
};

export const DUKE_EXAMPLE_SEASON = "2025";
export const DUKE_EXAMPLE_TEAM = "Duke";
export const ARIZONA_EXAMPLE_SEASON = "2026";
export const ARIZONA_EXAMPLE_TEAM = "Arizona";

export const DUKE_EXAMPLE_PLAYERS = [
  "Tyrese Proctor",
  "Kon Knueppel",
  "Sion James",
  "Cooper Flagg",
  "Khaman Maluach",
  "Caleb Foster",
  "Isaiah Evans",
  "Maliq Brown",
  "Mason Gillis",
  "Patrick Ngongba II",
] as const;

export const DUKE_EXAMPLE_LINEUPS: DukeExampleLineup[] = [
  {
    id: "L1",
    players: ["Tyrese Proctor", "Kon Knueppel", "Sion James", "Cooper Flagg", "Khaman Maluach"],
    minutes: 128.4,
    possessions: 262,
    pointsFor: 326,
    pointsAgainst: 232,
    fgm: 116,
    fga: 214,
    tpm: 33,
    tpa: 86,
  },
  {
    id: "L2",
    players: ["Tyrese Proctor", "Kon Knueppel", "Cooper Flagg", "Maliq Brown", "Khaman Maluach"],
    minutes: 86.1,
    possessions: 173,
    pointsFor: 205,
    pointsAgainst: 145,
    fgm: 72,
    fga: 149,
    tpm: 19,
    tpa: 54,
  },
  {
    id: "L3",
    players: ["Tyrese Proctor", "Sion James", "Isaiah Evans", "Cooper Flagg", "Khaman Maluach"],
    minutes: 73.9,
    possessions: 149,
    pointsFor: 181,
    pointsAgainst: 148,
    fgm: 63,
    fga: 136,
    tpm: 21,
    tpa: 61,
  },
  {
    id: "L4",
    players: ["Caleb Foster", "Kon Knueppel", "Sion James", "Cooper Flagg", "Khaman Maluach"],
    minutes: 61.7,
    possessions: 121,
    pointsFor: 147,
    pointsAgainst: 108,
    fgm: 54,
    fga: 111,
    tpm: 16,
    tpa: 40,
  },
  {
    id: "L5",
    players: ["Tyrese Proctor", "Kon Knueppel", "Sion James", "Mason Gillis", "Khaman Maluach"],
    minutes: 57.3,
    possessions: 114,
    pointsFor: 128,
    pointsAgainst: 101,
    fgm: 46,
    fga: 100,
    tpm: 15,
    tpa: 44,
  },
  {
    id: "L6",
    players: ["Tyrese Proctor", "Kon Knueppel", "Isaiah Evans", "Cooper Flagg", "Maliq Brown"],
    minutes: 51.8,
    possessions: 103,
    pointsFor: 116,
    pointsAgainst: 94,
    fgm: 42,
    fga: 91,
    tpm: 14,
    tpa: 39,
  },
  {
    id: "L7",
    players: ["Caleb Foster", "Isaiah Evans", "Sion James", "Cooper Flagg", "Khaman Maluach"],
    minutes: 43.6,
    possessions: 88,
    pointsFor: 99,
    pointsAgainst: 79,
    fgm: 35,
    fga: 82,
    tpm: 13,
    tpa: 36,
  },
  {
    id: "L8",
    players: ["Tyrese Proctor", "Kon Knueppel", "Sion James", "Maliq Brown", "Patrick Ngongba II"],
    minutes: 39.2,
    possessions: 79,
    pointsFor: 85,
    pointsAgainst: 73,
    fgm: 31,
    fga: 70,
    tpm: 10,
    tpa: 28,
  },
  {
    id: "L9",
    players: ["Tyrese Proctor", "Isaiah Evans", "Sion James", "Mason Gillis", "Khaman Maluach"],
    minutes: 32.7,
    possessions: 67,
    pointsFor: 74,
    pointsAgainst: 63,
    fgm: 27,
    fga: 62,
    tpm: 9,
    tpa: 26,
  },
  {
    id: "L10",
    players: ["Caleb Foster", "Kon Knueppel", "Isaiah Evans", "Cooper Flagg", "Maliq Brown"],
    minutes: 28.4,
    possessions: 58,
    pointsFor: 66,
    pointsAgainst: 57,
    fgm: 24,
    fga: 55,
    tpm: 8,
    tpa: 23,
  },
  {
    id: "L11",
    players: ["Tyrese Proctor", "Kon Knueppel", "Mason Gillis", "Cooper Flagg", "Patrick Ngongba II"],
    minutes: 24.8,
    possessions: 49,
    pointsFor: 53,
    pointsAgainst: 46,
    fgm: 19,
    fga: 44,
    tpm: 7,
    tpa: 18,
  },
  {
    id: "L12",
    players: ["Caleb Foster", "Sion James", "Isaiah Evans", "Maliq Brown", "Khaman Maluach"],
    minutes: 22.6,
    possessions: 46,
    pointsFor: 48,
    pointsAgainst: 44,
    fgm: 17,
    fga: 43,
    tpm: 5,
    tpa: 17,
  },
  {
    id: "L13",
    players: ["Tyrese Proctor", "Kon Knueppel", "Sion James", "Cooper Flagg", "Mason Gillis"],
    minutes: 19.9,
    possessions: 40,
    pointsFor: 51,
    pointsAgainst: 34,
    fgm: 18,
    fga: 36,
    tpm: 8,
    tpa: 19,
  },
  {
    id: "L14",
    players: ["Caleb Foster", "Kon Knueppel", "Sion James", "Maliq Brown", "Patrick Ngongba II"],
    minutes: 17.3,
    possessions: 34,
    pointsFor: 36,
    pointsAgainst: 31,
    fgm: 13,
    fga: 32,
    tpm: 4,
    tpa: 13,
  },
];

export const ARIZONA_EXAMPLE_LINEUPS: DukeExampleLineup[] = [
  { id: "AZ1", players: ["Brayden Burries", "Ivan Kharchenkov", "Jaden Bradley", "Koa Peat", "Motiejus Krivas"], minutes: 200.4, possessions: 501, pointsFor: 549, pointsAgainst: 458, fgm: 188, fga: 411, tpm: 52, tpa: 148 },
  { id: "AZ2", players: ["Brayden Burries", "Ivan Kharchenkov", "Jaden Bradley", "Koa Peat", "Tobe Awaka"], minutes: 53.6, possessions: 134, pointsFor: 176, pointsAgainst: 152, fgm: 59, fga: 125, tpm: 16, tpa: 45 },
  { id: "AZ3", players: ["Anthony Dell'Orso", "Brayden Burries", "Dwayne Aristode", "Koa Peat", "Tobe Awaka"], minutes: 50.8, possessions: 127, pointsFor: 138, pointsAgainst: 112, fgm: 50, fga: 104, tpm: 13, tpa: 37 },
  { id: "AZ4", players: ["Brayden Burries", "Ivan Kharchenkov", "Jaden Bradley", "Motiejus Krivas", "Tobe Awaka"], minutes: 36, possessions: 90, pointsFor: 109, pointsAgainst: 98, fgm: 37, fga: 86, tpm: 11, tpa: 31 },
  { id: "AZ5", players: ["Anthony Dell'Orso", "Brayden Burries", "Dwayne Aristode", "Motiejus Krivas", "Tobe Awaka"], minutes: 34.8, possessions: 87, pointsFor: 97, pointsAgainst: 76, fgm: 32, fga: 75, tpm: 9, tpa: 27 },
  { id: "AZ6", players: ["Anthony Dell'Orso", "Ivan Kharchenkov", "Jaden Bradley", "Koa Peat", "Motiejus Krivas"], minutes: 34.8, possessions: 87, pointsFor: 113, pointsAgainst: 91, fgm: 37, fga: 74, tpm: 9, tpa: 27 },
  { id: "AZ7", players: ["Anthony Dell'Orso", "Dwayne Aristode", "Jaden Bradley", "Koa Peat", "Tobe Awaka"], minutes: 32, possessions: 80, pointsFor: 87, pointsAgainst: 82, fgm: 29, fga: 65, tpm: 8, tpa: 23 },
  { id: "AZ8", players: ["Anthony Dell'Orso", "Dwayne Aristode", "Jaden Bradley", "Motiejus Krivas", "Tobe Awaka"], minutes: 26.4, possessions: 66, pointsFor: 79, pointsAgainst: 53, fgm: 27, fga: 65, tpm: 8, tpa: 23 },
  { id: "AZ9", players: ["Anthony Dell'Orso", "Ivan Kharchenkov", "Jaden Bradley", "Koa Peat", "Tobe Awaka"], minutes: 25.2, possessions: 63, pointsFor: 89, pointsAgainst: 68, fgm: 28, fga: 56, tpm: 7, tpa: 20 },
  { id: "AZ10", players: ["Anthony Dell'Orso", "Brayden Burries", "Ivan Kharchenkov", "Koa Peat", "Motiejus Krivas"], minutes: 24, possessions: 60, pointsFor: 55, pointsAgainst: 63, fgm: 20, fga: 45, tpm: 6, tpa: 16 },
  { id: "AZ11", players: ["Anthony Dell'Orso", "Brayden Burries", "Jaden Bradley", "Koa Peat", "Motiejus Krivas"], minutes: 18.4, possessions: 46, pointsFor: 57, pointsAgainst: 36, fgm: 19, fga: 38, tpm: 5, tpa: 14 },
  { id: "AZ12", players: ["Anthony Dell'Orso", "Brayden Burries", "Ivan Kharchenkov", "Jaden Bradley", "Motiejus Krivas"], minutes: 18, possessions: 45, pointsFor: 37, pointsAgainst: 45, fgm: 16, fga: 35, tpm: 4, tpa: 13 },
  { id: "AZ13", players: ["Anthony Dell'Orso", "Dwayne Aristode", "Jaden Bradley", "Koa Peat", "Motiejus Krivas"], minutes: 14.8, possessions: 37, pointsFor: 42, pointsAgainst: 24, fgm: 14, fga: 33, tpm: 4, tpa: 12 },
  { id: "AZ14", players: ["Anthony Dell'Orso", "Brayden Burries", "Jaden Bradley", "Motiejus Krivas", "Tobe Awaka"], minutes: 14.4, possessions: 36, pointsFor: 48, pointsAgainst: 38, fgm: 16, fga: 39, tpm: 5, tpa: 14 },
];

export const ARIZONA_EXAMPLE_PLAYERS = Array.from(
  new Set(ARIZONA_EXAMPLE_LINEUPS.flatMap((lineup) => lineup.players)),
).sort();

export const LINEUP_ANALYSIS_OPTIONS = [
  { key: "duke-2025", label: "Duke 2025", season: DUKE_EXAMPLE_SEASON, team: DUKE_EXAMPLE_TEAM, players: [...DUKE_EXAMPLE_PLAYERS], lineups: DUKE_EXAMPLE_LINEUPS },
  { key: "arizona-2026", label: "Arizona 2026", season: ARIZONA_EXAMPLE_SEASON, team: ARIZONA_EXAMPLE_TEAM, players: ARIZONA_EXAMPLE_PLAYERS, lineups: ARIZONA_EXAMPLE_LINEUPS },
] as const;

export type LineupAnalysisOptionKey = (typeof LINEUP_ANALYSIS_OPTIONS)[number]["key"];
