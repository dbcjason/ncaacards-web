export const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026] as const;

export const CONFERENCES = [
  "ACC",
  "America East",
  "American",
  "ASUN",
  "Atlantic 10",
  "Big Sky",
  "Big 12",
  "Big East",
  "Big Ten",
  "Big West",
  "CAA",
  "Conference USA",
  "Horizon",
  "Ivy",
  "MAAC",
  "MAC",
  "MEAC",
  "Missouri Valley",
  "Mountain West",
  "Northeast",
  "Ohio Valley",
  "Patriot",
  "SEC",
  "SoCon",
  "Southland",
  "Summit",
  "Sun Belt",
  "SWAC",
  "WAC",
  "WCC",
] as const;

type TeamRosterMap = Record<number, Record<string, string[]>>;

export const TEAM_ROSTERS: TeamRosterMap = {
  2026: {
    Louisville: ["Mikel Brown", "Ryan Conwell", "Khani Rooths"],
    UCLA: ["Aday Mara", "Donovan Dent", "Tyler Bilodeau"],
    Arkansas: ["Darius Acuff Jr.", "Trevon Brazile", "Boogie Fland"],
    "St. Thomas": ["Nolan Minessale", "Kendall Blue", "Drake Dobbs"],
    Vanderbilt: ["Tyler Tanner", "Jason Edwards", "Jaylen Carey"],
  },
  2025: {
    Louisville: ["Chucky Hepburn", "Terrence Edwards", "J'Vonne Hadley"],
    UCLA: ["Sebastian Mack", "Adem Bona", "Lazar Stefanovic"],
    Arkansas: ["Tramon Mark", "Trevon Brazile", "Davonte Davis"],
    "St. Thomas": ["Nolan Minessale", "Parker Bjorklund", "Brooks Allen"],
    Vanderbilt: ["Ezra Manjon", "Tyrin Lawrence", "Myles Stute"],
  },
  2024: {
    Louisville: ["Skyy Clark", "Mike James", "Brandon Huntley-Hatfield"],
    UCLA: ["Adem Bona", "Sebastian Mack", "Dylan Andrews"],
    Arkansas: ["Tramon Mark", "Davonte Davis", "Khalif Battle"],
    "St. Thomas": ["Parker Bjorklund", "Brooks Allen", "Riley Miller"],
    Vanderbilt: ["Ezra Manjon", "Jordan Wright", "Tyrin Lawrence"],
  },
  2023: {
    Louisville: ["El Ellis", "Jae'Lyn Withers", "Brandon Huntley-Hatfield"],
    UCLA: ["Jaime Jaquez Jr.", "Tyger Campbell", "Amari Bailey"],
    Arkansas: ["Anthony Black", "Nick Smith Jr.", "Ricky Council IV"],
    "St. Thomas": ["Andrew Rohde", "Parker Bjorklund", "Riley Miller"],
    Vanderbilt: ["Scotty Pippen Jr.", "Liam Robbins", "Jordan Wright"],
  },
  2022: {
    Louisville: ["Noah Locke", "Sydney Curry", "Malik Williams"],
    UCLA: ["Johnny Juzang", "Tyger Campbell", "Jules Bernard"],
    Arkansas: ["JD Notae", "Jaylin Williams", "Au'Diese Toney"],
    "St. Thomas": ["Parker Bjorklund", "Anders Nelson", "Riley Miller"],
    Vanderbilt: ["Scotty Pippen Jr.", "Myles Stute", "Jordan Wright"],
  },
  2021: {
    Louisville: ["David Johnson", "Carontez Lester", "Carlik Jones"],
    UCLA: ["Johnny Juzang", "Jaime Jaquez Jr.", "Tyger Campbell"],
    Arkansas: ["Moses Moody", "Justin Smith", "JD Notae"],
    "St. Thomas": ["Anders Nelson", "Parker Bjorklund", "Ryan Lindberg"],
    Vanderbilt: ["Scotty Pippen Jr.", "Dylan Disu", "Max Evans"],
  },
};

export const ALL_TEAMS = Array.from(
  new Set(Object.values(TEAM_ROSTERS).flatMap((seasonMap) => Object.keys(seasonMap))),
).sort();

export const TRANSFER_CANDIDATES = Array.from(
  new Set(
    Object.values(TEAM_ROSTERS)
      .flatMap((seasonMap) => Object.values(seasonMap))
      .flatMap((players) => players),
  ),
).sort();

export function rosterForTeamSeason(team: string, season: number): string[] {
  return TEAM_ROSTERS[season]?.[team] ?? [];
}

export function playersForTeamSeason(team: string, season: number): string[] {
  const roster = rosterForTeamSeason(team, season);
  return roster.length ? roster : TRANSFER_CANDIDATES.slice(0, 20);
}
