import fs from "node:fs";

const apiKey = process.env.API_FOOTBALL_KEY;
const API_URL = "https://v3.football.api-sports.io/fixtures?league=1&season=2026";

if (!apiKey) {
  console.log("API_FOOTBALL_KEY is not set. Leaving results.json unchanged.");
  process.exit(0);
}

// Team names used by the sweepstake app. API names are normalised to these names.
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
  "Spain","Iran","Congo DR","France","Australia","Saudi Arabia","England","Tunisia","South Africa",
  "Portugal","Bosnia & Herz.","Panama","Argentina","South Korea","Cape Verde","Brazil","Algeria","Qatar",
  "Germany","Ghana","Uzbekistan","Netherlands","Egypt","New Zealand","Norway","Paraguay","Iraq",
  "Belgium","Czechia","Jordan","Colombia","Ivory Coast","Curacao","Morocco","Scotland","Haiti",
  "United States","Canada","Switzerland","Austria","Uruguay","Sweden","Japan","Senegal","Mexico","Croatia","Ecuador","Turkey"
]);

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function appTeam(apiName) {
  if (!apiName) return null;
  if (TEAM_ALIASES.has(apiName)) return TEAM_ALIASES.get(apiName);
  for (const [from, to] of TEAM_ALIASES) {
    if (norm(apiName) === norm(from)) return to;
  }
  for (const t of APP_TEAMS) {
    if (norm(apiName) === norm(t)) return t;
  }
  return apiName;
}

function getGroupStageMapFromIndex() {
  const html = fs.readFileSync("index.html", "utf8");
  const match = html.match(/var\s+SCH\s*=\s*(\[[\s\S]*?\]);\s*var\s+STAGES/);
  if (!match) return new Map();
  const sch = Function(`"use strict"; return (${match[1]});`)();
  const map = new Map();
  for (const f of sch) {
    const h = appTeam(f.h);
    const a = appTeam(f.a);
    const key = [norm(h), norm(a)].sort().join("|");
    map.set(key, f.st); // gs1, gs2, gs3
  }
  return map;
}

function stageFromFixture(fixture, home, away, groupStageMap) {
  const key = [norm(home), norm(away)].sort().join("|");
  if (groupStageMap.has(key)) return groupStageMap.get(key);

  const round = String(fixture.league?.round || fixture.fixture?.round || "").toLowerCase();
  if (round.includes("round of 32")) return "r32";
  if (round.includes("round of 16")) return "r16";
  if (round.includes("quarter")) return "qf";
  if (round.includes("semi")) return "sf";
  if (round.includes("final")) return "f";

  // Fallback: if API round has group matchday wording.
  if (round.includes("group") && round.includes("1")) return "gs1";
  if (round.includes("group") && round.includes("2")) return "gs2";
  if (round.includes("group") && round.includes("3")) return "gs3";

  return null;
}

function resultFor(goalsFor, goalsAgainst, isKnockoutWinner) {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  if (isKnockoutWinner === true) return "W";
  if (isKnockoutWinner === false) return "L";
  return "D";
}

function completedStatus(short) {
  return ["FT", "AET", "PEN"].includes(short);
}

const response = await fetch(API_URL, {
  headers: { "x-apisports-key": apiKey }
});

if (!response.ok) {
  const err = await response.text();
  throw new Error(`API-Football error ${response.status}: ${err}`);
}

const data = await response.json();
console.log("API response keys:", Object.keys(data));
console.log("API errors:", JSON.stringify(data.errors || {}, null, 2));
console.log("API results count:", data.results);
console.log("API response length:", Array.isArray(data.response) ? data.response.length : "not an array");

if (Array.isArray(data.response) && data.response.length > 0) {
  console.log("First fixture sample:", JSON.stringify(data.response[0], null, 2));
}

if (!Array.isArray(data.response)) {
  throw new Error("API-Football response did not contain a response array.");
}

const groupStageMap = getGroupStageMapFromIndex();
const resultRows = [];
let matchesPlayed = 0;

for (const f of data.response) {
  const status = f.fixture?.status?.short;
  if (!completedStatus(status)) continue;

  const home = appTeam(f.teams?.home?.name);
  const away = appTeam(f.teams?.away?.name);
  if (!APP_TEAMS.has(home) || !APP_TEAMS.has(away)) continue;

  const stage = stageFromFixture(f, home, away, groupStageMap);
  if (!stage) {
    console.log(`Skipping completed match because stage could not be mapped: ${home} vs ${away} (${f.league?.round || "unknown round"})`);
    continue;
  }

  const hg = f.goals?.home;
  const ag = f.goals?.away;
  if (typeof hg !== "number" || typeof ag !== "number") continue;

  const score = `${hg}-${ag}`;
  const homeWinner = f.teams?.home?.winner;
  const awayWinner = f.teams?.away?.winner;

  resultRows.push({ team: home, stage, result: resultFor(hg, ag, homeWinner), score });
  resultRows.push({ team: away, stage, result: resultFor(ag, hg, awayWinner), score });
  matchesPlayed += 1;
}

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
