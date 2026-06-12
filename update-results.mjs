import fs from "node:fs";

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

if (!apiKey) {
  console.log("ANTHROPIC_API_KEY is not set. Leaving results.json unchanged.");
  process.exit(0);
}

const teams = [
  "Spain","Iran","Congo DR","France","Australia","Saudi Arabia","England","Tunisia","South Africa",
  "Portugal","Bosnia & Herz.","Panama","Argentina","South Korea","Cape Verde","Brazil","Algeria","Qatar",
  "Germany","Ghana","Uzbekistan","Netherlands","Egypt","New Zealand","Norway","Paraguay","Iraq",
  "Belgium","Czechia","Jordan","Colombia","Ivory Coast","Curacao","Morocco","Scotland","Haiti",
  "United States","Canada","Switzerland","Austria","Uruguay","Sweden","Japan","Senegal","Mexico","Croatia","Ecuador","Turkey"
];

const today = new Date().toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London"
});

const prompt = `Today is ${today}. Search the web for the latest 2026 FIFA World Cup match results.

I need results only for these exact team names:
${teams.join(", ")}

Return ONLY valid JSON, with no markdown fences, in this format:
{
  "date": "${today}",
  "matchesPlayed": 2,
  "results": [
    {"team":"Mexico","stage":"gs1","result":"W","score":"2-0"},
    {"team":"South Africa","stage":"gs1","result":"L","score":"0-2"},
    {"team":"Spain","qualify_r32":true}
  ]
}

Rules:
- Include only completed matches.
- For group games, use stage gs1, gs2, or gs3.
- For knockouts, use r32, r16, qf, sf, or f.
- Result must be W, D, or L.
- Team names must match the exact list above.
- Include both teams from each completed match.
- Add qualify_r32:true only once a team is mathematically qualified from the group stage.`;

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  },
  body: JSON.stringify({
    model,
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }]
  })
});

if (!response.ok) {
  const err = await response.text();
  throw new Error(`Anthropic API error ${response.status}: ${err}`);
}

const data = await response.json();
const text = (data.content || [])
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("")
  .replace(/```json|```/g, "")
  .trim();

const match = text.match(/\{[\s\S]*\}/);
const parsed = JSON.parse(match ? match[0] : text);

if (!parsed || !Array.isArray(parsed.results)) {
  throw new Error("Model response did not contain a results array.");
}

fs.writeFileSync("results.json", JSON.stringify(parsed, null, 2) + "\n", "utf8");
console.log(`Updated results.json with ${parsed.results.length} result rows.`);
