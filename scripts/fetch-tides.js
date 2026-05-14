#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// fetch-tides.js
//
// Pulls high/low tide predictions for Balboa, Canal Zone (NOAA station
// 9812501 — the official reference station for Pacific Panama tides)
// and writes tides.json in the exact shape the Casa Xa'Vaa page expects.
//
// NOAA's CO-OPS "datagetter" API is open: no API key, no registration,
// no quota. The only required courtesy parameter is `application`.
//
// Runs daily via .github/workflows/update-tides.yml. Needs nothing but
// Node 18+ (for the global fetch); no npm dependencies.
// ─────────────────────────────────────────────────────────────────────

const fs = require("fs");

const STATION     = "9812501";          // Balboa, Canal Zone (Pacific)
const DAYS_AHEAD  = 90;                 // length of the forecast window
const OUT_PATH    = "tides.json";

// "2026-05-14 01:15" -> "2026-05-14"
function isoDate(t) {
  return t.slice(0, 10);
}

// "2026-05-14 01:15" -> 75   (minutes since local midnight)
function minutesOfDay(t) {
  const hh = parseInt(t.slice(11, 13), 10);
  const mm = parseInt(t.slice(14, 16), 10);
  return hh * 60 + mm;
}

// Date -> "YYYYMMDD" (the format NOAA's begin_date/end_date expect)
function yyyymmdd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function main() {
  const now   = new Date();
  const begin = new Date(now); begin.setUTCDate(begin.getUTCDate() - 1);          // include yesterday
  const end   = new Date(now); end.setUTCDate(end.getUTCDate() + DAYS_AHEAD);

  const url =
    "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter" +
    "?product=predictions" +
    "&application=casa-xavaa-mareas" +
    "&station="    + STATION +
    "&begin_date=" + yyyymmdd(begin) +
    "&end_date="   + yyyymmdd(end) +
    "&datum=MLLW" +              // chart datum — matches the page's legend
    "&time_zone=lst_ldt" +       // station local time (Panama = UTC-5, no DST)
    "&units=metric" +            // heights in meters
    "&interval=hilo" +           // just the highs and lows
    "&format=json";

  console.log("Requesting:", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("NOAA API returned HTTP " + res.status);

  const json = await res.json();
  if (json.error) {
    throw new Error("NOAA API error: " + JSON.stringify(json.error));
  }
  if (!Array.isArray(json.predictions) || json.predictions.length === 0) {
    throw new Error("NOAA API returned no predictions: " +
      JSON.stringify(json).slice(0, 300));
  }

  // Reshape NOAA's flat list into { "YYYY-MM-DD": [{m,h,k}, ...], ... }
  const events = {};
  for (const p of json.predictions) {
    const date = isoDate(p.t);
    if (!events[date]) events[date] = [];
    events[date].push({
      m: minutesOfDay(p.t),
      h: Math.round(parseFloat(p.v) * 100) / 100,
      k: p.type.toLowerCase() === "h" ? "h" : "l",
    });
  }
  // Keep each day's events in chronological order.
  for (const date of Object.keys(events)) {
    events[date].sort((a, b) => a.m - b.m);
  }

  const out = {
    station:   "NOAA 9812501 - Balboa, Canal Zone (Pacific)",
    generated: new Date().toISOString(),
    events,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(
    `Wrote ${OUT_PATH}: ${Object.keys(events).length} days, ` +
    `${json.predictions.length} tide events.`
  );
}

main().catch(err => {
  console.error("fetch-tides failed:", err.message);
  process.exit(1);
});
