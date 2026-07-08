import fs from "node:fs";

const token = process.env.FOOTBALL_DATA_TOKEN;
const API_URL = "https://api.football-data.org/v4/competitions/WC/matches?season=2026";

if (!token) {
  throw new Error("FOOTBALL_DATA_TOKEN is not set. Check GitHub Settings → Secrets and variables → Actions.");
}

console.log("FOOTBALL_DATA_TOKEN detected. Calling football-data.org...");

const TEAM_ALIASES = new Map(Object.entries({
  "USA": "United States",
  "United States": "United States",
  "United States of America": "United States",

  "Korea Republic": "South Korea",
  "South Korea": "South Korea",

  "Czech Republic": "Czechia",
  "Czechia": "Czechia",

  "Bosnia and Herzegovina": "Bosnia & Herz.",
  "Bosnia & Herzegovina": "Bosnia & Herz.",
  "Bosnia-Herzegovina": "Bosnia & Herz.",
  "Bosnia & Herz.": "Bosnia & Herz.",

  "DR Congo": "Congo DR",
  "Congo DR": "Congo DR",
  "Congo Democratic Republic": "Congo DR",

  "Curaçao": "Curacao",
  "Curacao": "Curacao",

  "Côte d'Ivoire": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "Ivory Coast": "Ivory Coast",

  "Saudi Arabia": "Saudi Arabia",
  "Cape Verde": "Cape Verde",
  "New Zealand": "New Zealand",
  "South Africa": "South Africa"
}));

const APP_TEAMS = new Set([
  "Spain", "Iran", "Congo DR",
  "France", "Australia", "Saudi Arabia",
  "England", "Tunisia", "South Africa",
  "Portugal", "Bosnia & Herz.", "Panama",
  "Argentina", "South Korea", "Cape Verde",
  "Brazil", "Algeria", "Qatar",
  "Germany", "Ghana", "Uzbekistan",
  "Netherlands", "Egypt", "New Zealand",
  "Norway", "Paraguay", "Iraq",
  "Belgium", "Czechia", "Jordan",
  "Colombia", "Ivory Coast", "Curacao",
  "Morocco", "Scotland", "Haiti",
  "United States", "Canada",
  "Switzerland", "Austria",
  "Uruguay", "Sweden",
  "Japan", "Senegal",
  "Mexico", "Croatia",
  "Ecuador", "Turkey"
]);

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function appTeam(apiName) {
  if (!apiName) return null;

  if (TEAM_ALIASES.has(apiName)) {
    return TEAM_ALIASES.get(apiName);
  }

  for (const [from, to] of TEAM_ALIASES) {
    if (norm(apiName) === norm(from)) {
      return to;
    }
  }

  for (const team of APP_TEAMS) {
    if (norm(apiName) === norm(team)) {
      return team;
    }
  }

  return apiName;
}

function getGroupStageMapFromIndex() {
  const html = fs.readFileSync("index.html", "utf8");
  const match = html.match(/var\s+SCH\s*=\s*(\[[\s\S]*?\]);\s*var\s+STAGES/);

  if (!match) {
    console.log("Could not find SCH schedule in index.html. Group stage mapping may be incomplete.");
    return new Map();
  }

  const schedule = Function(`"use strict"; return (${match[1]});`)();
  const map = new Map();

  for (const fixture of schedule) {
    const home = appTeam(fixture.h);
    const away = appTeam(fixture.a);
    const key = [norm(home), norm(away)].sort().join("|");
    map.set(key, fixture.st); // gs1, gs2, gs3
  }

  console.log(`Loaded ${map.size} scheduled fixtures from index.html.`);
  return map;
}

function stageFromMatch(match, home, away, groupStageMap) {
  const key = [norm(home), norm(away)].sort().join("|");

  if (groupStageMap.has(key)) {
    return groupStageMap.get(key);
  }

  const stage = String(match.stage || "").toUpperCase();
  const matchday = Number(match.matchday || 0);

  if (stage === "GROUP_STAGE") {
    if (matchday === 1) return "gs1";
    if (matchday === 2) return "gs2";
    if (matchday === 3) return "gs3";
    return "gs1";
  }

  if (stage.includes("LAST_32") || stage.includes("ROUND_OF_32")) return "r32";
  if (stage.includes("LAST_16") || stage.includes("ROUND_OF_16")) return "r16";
  if (stage.includes("QUARTER")) return "qf";
  if (stage.includes("SEMI")) return "sf";
  if (stage.includes("FINAL")) return "f";

  return null;
}

function resultFor(goalsFor, goalsAgainst, penaltyFor, penaltyAgainst) {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";

  if (typeof penaltyFor === "number" && typeof penaltyAgainst === "number") {
    if (penaltyFor > penaltyAgainst) return "W";
    if (penaltyFor < penaltyAgainst) return "L";
  }

  return "D";
}

function isFinished(match) {
  return match.status === "FINISHED";
}

const response = await fetch(API_URL, {
  headers: {
    "X-Auth-Token": token
  }
});

console.log(`football-data.org response status: ${response.status}`);

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`football-data.org error ${response.status}: ${errorText}`);
}

const data = await response.json();

console.log("API response keys:", Object.keys(data));
console.log("API matches count:", Array.isArray(data.matches) ? data.matches.length : "not an array");

if (!Array.isArray(data.matches)) {
  throw new Error("football-data.org response did not contain a matches array.");
}

if (data.matches.length > 0) {
  console.log("First match sample:", JSON.stringify(data.matches[0], null, 2));
}

const groupStageMap = getGroupStageMapFromIndex();
const resultRows = [];
let matchesPlayed = 0;

for (const match of data.matches) {
  if (!isFinished(match)) continue;

  const home = appTeam(match.homeTeam?.name);
  const away = appTeam(match.awayTeam?.name);

  if (!APP_TEAMS.has(home) || !APP_TEAMS.has(away)) {
    console.log(`Skipping unknown team mapping: ${match.homeTeam?.name} vs ${match.awayTeam?.name}`);
    continue;
  }

  const stage = stageFromMatch(match, home, away, groupStageMap);

  if (!stage) {
    console.log(`Skipping completed match because stage could not be mapped: ${home} vs ${away}, stage=${match.stage}`);
    continue;
  }

  const homeGoals = match.score?.fullTime?.home;
  const awayGoals = match.score?.fullTime?.away;

  if (typeof homeGoals !== "number" || typeof awayGoals !== "number") {
    console.log(`Skipping match with missing full-time score: ${home} vs ${away}`);
    continue;
  }

  const homePens = match.score?.penalties?.home;
  const awayPens = match.score?.penalties?.away;

  const score = `${homeGoals}-${awayGoals}`;

  resultRows.push({
    team: home,
    stage,
    result: resultFor(homeGoals, awayGoals, homePens, awayPens),
    score
  });

  resultRows.push({
    team: away,
    stage,
    result: resultFor(awayGoals, homeGoals, awayPens, homePens),
    score
  });

  matchesPlayed += 1;
}

// Manual overrides for games missing from the API
const manualResults = [
  {
    team: "Spain",
    stage: "gs1",
    result: "D",
    score: "0-0"
  },
  {
    team: "Cape Verde",
    stage: "gs1",
    result: "D",
    score: "0-0"
  },
    {
    team: "Uruguay",
    stage: "gs2",
    result: "D",
    score: "2-2"
  },
  {
    team: "Cape Verde",
    stage: "gs2",
    result: "D",
    score: "2-2"
  },
    {
    team: "Cape Verde",
    stage: "gs3",
    result: "D",
    score: "0-0"
  },
    {
    team: "Saudi Arabia",
    stage: "gs3",
    result: "D",
    score: "0-0"
  },
  {
    team: "Portugal",
    stage: "gs2",
    result: "W",
    score: "5-0"
  },
  {
    team: "Uzbekistan",
    stage: "gs2",
    result: "L",
    score: "5-0"
  },
    {
    team: "Colombia",
    stage: "gs2",
    result: "W",
    score: "1-0"
  },
   {
    team: "Congo DR",
    stage: "gs2",
    result: "L",
    score: "1-0"
  },
   {
      "team": "Argentina",
      "stage": "r32",
      "result": "W",
      "score": "3-2"
    },
    {
      "team": "Cape Verde",
      "stage": "r32",
      "result": "L",
      "score": "3-2"
    },
];

// Add manual results only if they are missing
for (const manualResult of manualResults) {
  const alreadyExists = resultRows.some(
    row =>
      row.team === manualResult.team &&
      row.stage === manualResult.stage
  );

  if (!alreadyExists) {
    console.log(`Adding manual result: ${manualResult.team} ${manualResult.stage}`);
    resultRows.push(manualResult);
  }
}

// Recalculate matches played after adding manual results
matchesPlayed = Math.floor(resultRows.length / 2);

const output = {
  date: new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London"
  }),
  matchesPlayed,
  results: resultRows
};

fs.writeFileSync("results.json", JSON.stringify(output, null, 2) + "\n", "utf8");

console.log(`Updated results.json with ${matchesPlayed} completed matches and ${resultRows.length} team rows.`);
