#!/usr/bin/env node
/*
 * Generates js/swr-stations.js: every South Western Railway station, with the matching TfL
 * stop (NaPTAN and hub) where TfL has one, for the SWR tab's station picker and the links
 * between the TfL and SWR tabs.
 *
 * Sources:
 *   GET https://www.southwesternrailway.com/api/swrstations
 *       [{Name, CrsCode, NationalLocationCode, Latitude, Longitude, Url}]  (204 on 2026-09-27)
 *   GET https://api.tfl.gov.uk/Line/south-western-railway/StopPoints
 *       [{naptanId, commonName, lat, lon, hubNaptanCode, lines, children}]  (202 on 2026-09-27)
 *
 * Each SWR station is matched to the nearest TfL rail stop (910G…) within 400 m whose name
 * agrees with it. The output is a classic script, not JSON, so the page works when index.html
 * is opened from disk. Rerun by hand when SWR's station list changes:
 *
 *   node scripts/swr-stations.js                      fetch both lists and write js/swr-stations.js
 *   node scripts/swr-stations.js --swr a.json --tfl b.json [--out file]   use saved responses
 *
 * Node 18+ (global fetch), no dependencies. The matching functions are exported for the tests.
 */
'use strict';

const SWR_URL = 'https://www.southwesternrailway.com/api/swrstations';
const TFL_URL = 'https://api.tfl.gov.uk/Line/south-western-railway/StopPoints';
const USER_AGENT = 'tfl-dashboard (https://github.com/jinalharia/tfl-dashboard)';
const MAX_DISTANCE_M = 400;
// Stops this close together count as the same place; the one with more lines wins
// (Reading's 910GRDNGSTN, which has the Elizabeth line, over 910GRDNG4AB at the same point).
const SAME_PLACE_M = 25;

/** Straight-line distance in metres (equirectangular; plenty for a few hundred metres). */
function distanceM(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  const y = (lat2 - lat1) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** "Ascot (Berks)" → "ascot", "Box Hill & Westhumble Rail Station" → "box hill and westhumble". */
function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/\b(rail|railway)?\s*station\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How well two station names agree: 3 = same, 2 = one's words are all in the other
 * ("gillingham dorset" / "gillingham"), 0 = different. Sharing only some words isn't enough:
 * Windsor & Eton Riverside is 376 m from Windsor & Eton Central.
 */
function nameScore(a, b) {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 3;
  const ta = ka.split(' ');
  const tb = kb.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t)) ? 2 : 0;
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Pure matcher. swrStations: the /api/swrstations array; tflStops: the
 * /Line/south-western-railway/StopPoints array.
 * → {stations: [{crs, name, nlc, lat, lon, naptan, tflHub, url}], unmatched: [{crs, name, nearest}]}
 */
function matchStations(swrStations, tflStops, options) {
  const maxDistance = (options && options.maxDistanceM) || MAX_DISTANCE_M;
  const stops = (Array.isArray(tflStops) ? tflStops : [])
    .filter((s) => s && /^910G/.test(String(s.naptanId || s.id || '')) && Number.isFinite(num(s.lat)) && Number.isFinite(num(s.lon)));
  const stations = [];
  const unmatched = [];
  for (const raw of Array.isArray(swrStations) ? swrStations : []) {
    const crs = String((raw && raw.CrsCode) || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(crs)) continue;
    const lat = num(raw.Latitude);
    const lon = num(raw.Longitude);
    const name = String(raw.Name || crs).trim();
    const located = Number.isFinite(lat) && Number.isFinite(lon);
    const candidates = located
      ? stops.map((s) => ({ s, distance: distanceM(lat, lon, num(s.lat), num(s.lon)), score: nameScore(name, s.commonName) }))
      : [];
    const near = candidates
      .filter((c) => c.distance <= maxDistance && c.score > 0)
      .sort((a, b) => b.score - a.score
        || Math.floor(a.distance / SAME_PLACE_M) - Math.floor(b.distance / SAME_PLACE_M)
        || ((b.s.lines || []).length - (a.s.lines || []).length)
        || ((b.s.children || []).length - (a.s.children || []).length)
        || a.distance - b.distance
        || String(a.s.naptanId).localeCompare(String(b.s.naptanId)));
    const best = near[0] ? near[0].s : null;
    if (!best) {
      const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
      unmatched.push({
        crs, name,
        nearest: closest ? { naptan: closest.s.naptanId, name: closest.s.commonName, distance: Math.round(closest.distance) } : null,
      });
    }
    const url = typeof raw.Url === 'string' && raw.Url.startsWith('/') ? raw.Url : null;
    stations.push({
      crs,
      name,
      nlc: raw.NationalLocationCode === null || raw.NationalLocationCode === undefined ? null : String(raw.NationalLocationCode),
      lat: located ? round6(lat) : null,
      lon: located ? round6(lon) : null,
      naptan: best ? String(best.naptanId) : null,
      tflHub: best && best.hubNaptanCode ? String(best.hubNaptanCode) : null,
      url,
    });
  }
  stations.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  return { stations, unmatched };
}

/** The committed file: a classic script that sets window.SWR_STATIONS and exports it for Node. */
function renderStationsFile(result, generatedOn) {
  const lines = result.stations.map((s) => `    ${JSON.stringify(s)},`);
  const unmatched = result.unmatched.length
    ? result.unmatched.map((u) => ` *   ${u.crs} ${u.name}`).join('\n')
    : ' *   (none)';
  return `/*
 * South Western Railway stations, generated by scripts/swr-stations.js on ${generatedOn}.
 * Do not edit by hand: rerun the script when SWR's station list changes.
 *
 * Sources: ${SWR_URL}
 *          ${TFL_URL}
 * Each station: {crs, name, nlc, lat, lon, naptan, tflHub, url}. naptan/tflHub are the nearest
 * TfL rail stop within ${MAX_DISTANCE_M} m whose name agrees, or null. url is a path on
 * www.southwesternrailway.com.
 *
 * ${result.stations.length} stations. No TfL stop for:
${unmatched}
 */
(function (root) {
  'use strict';

  const SWR_STATIONS = [
${lines.join('\n')}
  ];

  root.SWR_STATIONS = SWR_STATIONS;
  if (typeof module !== 'undefined' && module.exports) module.exports = SWR_STATIONS;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.json();
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastError;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--(swr|tfl|out)$/.exec(argv[i]);
    if (!m || !argv[i + 1]) throw new Error(`Usage: node scripts/swr-stations.js [--swr file.json] [--tfl file.json] [--out file.js] (bad argument ${argv[i]})`);
    out[m[1]] = argv[i + 1];
    i += 1;
  }
  return out;
}

async function main() {
  const fs = require('fs');
  const path = require('path');
  const args = parseArgs(process.argv.slice(2));
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const swr = args.swr ? read(args.swr) : await fetchJson(SWR_URL);
  if (!args.swr) await new Promise((r) => setTimeout(r, 1000)); // one request at a time, politely spaced
  const tfl = args.tfl ? read(args.tfl) : await fetchJson(TFL_URL);
  const result = matchStations(swr, tfl);
  const out = args.out || path.join(__dirname, '..', 'js', 'swr-stations.js');
  fs.writeFileSync(out, renderStationsFile(result, new Date().toISOString().slice(0, 10)));
  const matched = result.stations.length - result.unmatched.length;
  console.log(`Wrote ${out}: ${result.stations.length} SWR stations, ${matched} matched to a TfL stop, ${result.stations.filter((s) => s.tflHub).length} with a TfL hub.`);
  if (result.unmatched.length) {
    console.log('No TfL stop within ' + MAX_DISTANCE_M + ' m with a matching name:');
    for (const u of result.unmatched) {
      console.log(`  ${u.crs} ${u.name}${u.nearest ? ` (nearest: ${u.nearest.name}, ${u.nearest.distance} m)` : ''}`);
    }
  }
}

module.exports = { matchStations, nameKey, nameScore, distanceM, renderStationsFile, MAX_DISTANCE_M };

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
