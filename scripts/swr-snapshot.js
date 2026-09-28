#!/usr/bin/env node
/*
 * Snapshots of the South Western Railway website API, which sends no CORS headers, so the
 * page can't call it. GitHub Actions runs this script and publishes the files under data/swr/,
 * where the SWR tab reads them with SwrApi.snapshot() (formats in plan.md, "Snapshot file
 * formats").
 *
 *   node scripts/swr-snapshot.js --status --out _site/data/swr
 *       status.json: /api/overallstatus, /api/LiveInformationBoard and /api/RainbowBoard (3
 *       requests), on every deploy and every 15 minutes (.github/workflows/pages.yml). If
 *       scripts/swr-closures.js exists (package S5), its snapshot() result also goes into
 *       closures.json.
 *   node scripts/swr-snapshot.js --weekly --out data/swr [--limit N]
 *       seats/{CRS}.json, seats/index.json and performance.json (about 350 requests, around 6
 *       minutes), every Monday (.github/workflows/swr-weekly.yml). --limit N fetches only the
 *       first N stations of each list, for trying it out.
 *
 * Politeness: one request at a time, at least 1 s apart, a 30 s timeout, one retry, and a
 * User-Agent naming this repo. A failed source is recorded in the file's `errors` and never
 * fails the run; the exit code is 1 only when every source failed.
 *
 * Node 18+ (global fetch), no dependencies. The builders and matchStationName are pure and
 * exported for tests/swr-snapshot.test.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://www.southwesternrailway.com/api';
const USER_AGENT = 'tfl-dashboard (https://github.com/jinalharia/tfl-dashboard)';
const MIN_GAP_MS = 1000;
const TIMEOUT_MS = 30000;
const SEATS_TO = 'London Waterloo';
const SEATS_PAGE = 100;
const SEATS_MAX_PAGES = 10;
const PERFORMANCE_TAKE = 10;
const TARGET_ROW = 'wessex route target';
const CLOSURES_MODULE = path.join(__dirname, 'swr-closures.js');

// ---------------------------------------------------------------------------
// Station names → CRS
// ---------------------------------------------------------------------------

/**
 * "Cobham & Stoke d'Abernon" → "cobham and stoke dabernon". With dropBrackets, bracketed parts
 * go too: "Ascot (Berks)" → "ascot".
 */
function nameKey(name, dropBrackets) {
  let s = String(name == null ? '' : name).toLowerCase();
  if (dropBrackets) s = s.replace(/\([^)]*\)/g, ' ');
  return s
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Names the seat availability and station performance lists use that the rules in
 * matchStationName don't reach, keyed by nameKey(name) → CRS.
 */
const NAME_ALIASES = {
  'boxhill and westhumble': 'BXW', // seat availability; swrstations says "Box Hill & Westhumble"
};

/** Names that are placeholders rather than stations (the seat list has "NOT FOUND"). */
const NOT_STATIONS = new Set(['not found', '']);

/**
 * Pure. Maps a station name from the seat availability or station performance lists to a CRS
 * code in SWR_STATIONS ([{crs, name}]), or null.
 *   1. the same name after normalising case, "&"/"and", punctuation and brackets' parentheses
 *      ("Queenstown Road (Battersea)" = "Queenstown Road Battersea");
 *   2. the same name with bracketed parts dropped, if exactly one station has it
 *      ("Ascot" = "Ascot (Berks)", "Richmond (London)" = "Richmond");
 *   3. NAME_ALIASES.
 */
function matchStationName(name, stations) {
  const list = Array.isArray(stations) ? stations : [];
  const key = nameKey(name);
  if (NOT_STATIONS.has(key)) return null;
  const exact = list.filter((s) => s && nameKey(s.name) === key);
  if (exact.length === 1) return exact[0].crs;
  const loose = nameKey(name, true);
  const byLoose = loose ? list.filter((s) => s && nameKey(s.name, true) === loose) : [];
  if (byLoose.length === 1) return byLoose[0].crs;
  const alias = NAME_ALIASES[key];
  if (alias && list.some((s) => s && s.crs === alias)) return alias;
  return null;
}

// ---------------------------------------------------------------------------
// Builders (pure): raw responses → file contents
// ---------------------------------------------------------------------------

const errorText = (e) => String((e && e.message) || e || 'failed').slice(0, 300);

/**
 * status.json. sources: {overallstatus, liveInformationBoard, rainbowBoard}, each the raw
 * response or undefined when it failed; errors: {name: message}.
 */
function buildStatus(sources, errors, fetchedAt) {
  const src = sources || {};
  const out = { fetchedAt, errors: { ...(errors || {}) } };
  for (const key of ['overallstatus', 'liveInformationBoard', 'rainbowBoard']) {
    out[key] = src[key] === undefined ? null : src[key];
  }
  return out;
}

/**
 * The origin names to crawl from /api/seatavailability/stations/London%20Waterloo: skips
 * "NOT FOUND", London Waterloo itself, blanks and repeats.
 */
function seatOrigins(stationNames) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(stationNames) ? stationNames : []) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    const key = nameKey(name);
    if (NOT_STATIONS.has(key) || key === nameKey(SEATS_TO) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * seats/{CRS}.json and seats/index.json.
 * results: [{name, crs, items}] for each origin fetched (crs null when the name didn't match);
 * files are made only for stations with at least one item. errors: {name: message}.
 * → {files: {CRS: {fetchedAt, crs, from, to, items}}, index: {fetchedAt, stations, errors?},
 *    unmatched: [name]}
 */
function buildSeats(results, fetchedAt, errors) {
  const files = {};
  const unmatched = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r) continue;
    const items = Array.isArray(r.items) ? r.items : [];
    if (!r.crs) {
      if (items.length) unmatched.push(r.name);
      continue;
    }
    if (!items.length || files[r.crs]) continue;
    files[r.crs] = { fetchedAt, crs: r.crs, from: r.name, to: SEATS_TO, items };
  }
  const stations = Object.values(files)
    .map((f) => ({ crs: f.crs, seatName: f.from }))
    .sort((a, b) => a.seatName.localeCompare(b.seatName, 'en-GB'));
  const index = { fetchedAt, stations };
  const errs = { ...(errors || {}) };
  for (const name of unmatched) errs[name] = 'no SWR station matches this name';
  if (Object.keys(errs).length) index.errors = errs;
  return { files, index, unmatched };
}

const pct = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * performance.json. results: [{name, crs, response}] for each name fetched (crs from
 * matchStationName, or null). A name that didn't match falls back to the SWR-run row's
 * CRSCode in its response, if that's an SWR station. errors: {name: message}.
 * → {fetchedAt, period, target: {punctual, cancelled}, stations: {CRS: raw}, errors?}
 */
function buildPerformance(results, fetchedAt, errors, stations) {
  const known = new Set((Array.isArray(stations) ? stations : []).map((s) => s && s.crs));
  const out = { fetchedAt, period: null, target: null, stations: {} };
  const errs = { ...(errors || {}) };
  for (const r of Array.isArray(results) ? results : []) {
    const res = r && r.response;
    if (!res || typeof res !== 'object' || !Array.isArray(res.Items)) continue;
    let crs = r.crs;
    if (!crs) {
      const row = res.Items.find((i) => i && /^[A-Z]{3}$/.test(String(i.CRSCode || '')) && known.has(i.CRSCode));
      crs = row ? row.CRSCode : null;
    }
    if (!crs) {
      errs[r.name] = 'no SWR station matches this name';
      continue;
    }
    if (!out.stations[crs]) out.stations[crs] = res;
    if (!out.period && typeof res.Period === 'string' && res.Period.trim()) out.period = res.Period.trim();
    if (!out.target) {
      const t = res.Items.find((i) => i && nameKey(i.StationName) === TARGET_ROW);
      if (t) out.target = { punctual: pct(t.Punctal), cancelled: pct(t.Cancelled) };
    }
  }
  if (Object.keys(errs).length) out.errors = errs;
  return out;
}

// ---------------------------------------------------------------------------
// Polite HTTP client
// ---------------------------------------------------------------------------

/**
 * One request at a time, starts at least minGapMs apart (retries included), timeoutMs each,
 * one retry. fetchImpl and sleep are injectable for tests.
 */
function createClient(options) {
  const o = options || {};
  const fetchImpl = o.fetch || globalThis.fetch;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || Date.now;
  const minGap = o.minGapMs == null ? MIN_GAP_MS : o.minGapMs;
  const timeout = o.timeoutMs || TIMEOUT_MS;
  const log = o.log || (() => {});
  let last = -Infinity;
  let queue = Promise.resolve();
  let count = 0;

  async function once(url, init) {
    const wait = last + minGap - now();
    if (wait > 0) await sleep(wait);
    last = now();
    count += 1;
    const headers = { 'User-Agent': USER_AGENT, ...((init && init.headers) || {}) };
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined;
    const res = await fetchImpl(url, { ...(init || {}), headers, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function text(url, init) {
    try {
      return await once(url, init);
    } catch (e) {
      log(`retrying ${url} (${errorText(e)})`);
      return once(url, init);
    }
  }

  // Serialise every call, even ones made concurrently (e.g. by the closures hook).
  function fetchText(url, init) {
    const p = queue.then(() => text(url, init));
    queue = p.catch(() => {});
    return p;
  }

  async function fetchJson(url, init) {
    const body = await fetchText(url, { ...(init || {}), headers: { Accept: 'application/json', ...((init && init.headers) || {}) } });
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error('not JSON');
    }
  }

  return { fetchText, fetchJson, count: () => count };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + '\n');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * --status. Writes status.json (and closures.json when the S5 hook returns something).
 * → {ok, errors} where ok is false only when all three status sources failed.
 */
async function runStatus(options) {
  const o = options || {};
  const client = o.client || createClient(o);
  const log = o.log || (() => {});
  const now = o.now || (() => new Date());
  const closuresModule = o.closuresModule === undefined ? CLOSURES_MODULE : o.closuresModule;
  const sources = {};
  const errors = {};
  const endpoints = [
    ['overallstatus', `${API}/overallstatus`],
    ['liveInformationBoard', `${API}/LiveInformationBoard`],
    ['rainbowBoard', `${API}/RainbowBoard`],
  ];
  const fetchedAt = now().toISOString();
  for (const [key, url] of endpoints) {
    try {
      sources[key] = await client.fetchJson(url);
    } catch (e) {
      errors[key] = errorText(e);
      log(`${key}: ${errors[key]}`);
    }
  }

  // Package S5's optional hook: scripts/swr-closures.js exports async snapshot({fetchJson, fetchText, log}).
  if (closuresModule && fs.existsSync(closuresModule)) {
    try {
      const mod = require(closuresModule);
      const result = await mod.snapshot({ fetchJson: client.fetchJson, fetchText: client.fetchText, log });
      if (result != null) {
        const data = result && typeof result === 'object' && !Array.isArray(result) && !result.fetchedAt
          ? { fetchedAt: now().toISOString(), ...result }
          : result;
        writeJson(path.join(o.out, 'closures.json'), data);
      }
    } catch (e) {
      errors.closures = errorText(e);
      log(`closures: ${errors.closures}`);
    }
  }

  writeJson(path.join(o.out, 'status.json'), buildStatus(sources, errors, fetchedAt));
  const failed = endpoints.filter(([key]) => errors[key]).length;
  return { ok: failed < endpoints.length, errors, requests: client.count() };
}

/**
 * --weekly. Writes seats/{CRS}.json, seats/index.json and performance.json, and removes seat
 * files for stations that no longer have data. A list that couldn't be fetched leaves its old
 * files alone; a station whose own request failed keeps its old file.
 */
async function runWeekly(options) {
  const o = options || {};
  const client = o.client || createClient(o);
  const log = o.log || (() => {});
  const stations = o.stations || require('../js/swr-stations.js');
  const limit = o.limit > 0 ? o.limit : Infinity;
  const fetchedAt = (o.now || (() => new Date()))().toISOString();
  const seatsDir = path.join(o.out, 'seats');
  const summary = { seats: 0, performance: 0, unmatched: [], errors: {} };
  let sourcesOk = 0;

  // Seat availability into London Waterloo.
  let origins = null;
  try {
    origins = seatOrigins(await client.fetchJson(`${API}/seatavailability/stations/${enc(SEATS_TO)}`)).slice(0, limit);
  } catch (e) {
    summary.errors['seatavailability/stations'] = errorText(e);
    log(`seat station list: ${errorText(e)}`);
  }
  if (origins) {
    const results = [];
    const errors = {};
    const failedCrs = new Set();
    for (const name of origins) {
      const crs = matchStationName(name, stations);
      try {
        const items = [];
        for (let page = 0; page < SEATS_MAX_PAGES; page += 1) {
          const res = await client.fetchJson(`${API}/seatavailability/${enc(name)}/${enc(SEATS_TO)}?skip=${page * SEATS_PAGE}&take=${SEATS_PAGE}`);
          const got = res && Array.isArray(res.Items) ? res.Items : [];
          items.push(...got);
          const total = res && Number(res.TotalResults);
          if (!got.length || !(total > items.length)) break;
        }
        results.push({ name, crs, items });
      } catch (e) {
        errors[name] = errorText(e);
        if (crs) failedCrs.add(crs);
        log(`seats ${name}: ${errors[name]}`);
      }
    }
    if (results.length) {
      sourcesOk += 1;
      const built = buildSeats(results, fetchedAt, errors);
      // A station whose request failed this week keeps last week's file.
      for (const crs of failedCrs) {
        const old = readJson(path.join(seatsDir, `${crs}.json`));
        if (old && !built.files[crs]) {
          built.index.stations.push({ crs, seatName: old.from });
          built.files[crs] = null;
        }
      }
      built.index.stations.sort((a, b) => a.seatName.localeCompare(b.seatName, 'en-GB'));
      fs.mkdirSync(seatsDir, { recursive: true });
      for (const [crs, data] of Object.entries(built.files)) {
        if (data) writeJson(path.join(seatsDir, `${crs}.json`), data);
      }
      // Stations beyond --limit weren't asked, so their files aren't stale.
      for (const f of limit === Infinity ? fs.readdirSync(seatsDir) : []) {
        const m = /^([A-Z]{3})\.json$/.exec(f);
        if (m && !(m[1] in built.files)) {
          fs.unlinkSync(path.join(seatsDir, f));
          log(`removed stale seats/${f}`);
        }
      }
      writeJson(path.join(seatsDir, 'index.json'), built.index);
      summary.seats = built.index.stations.length;
      summary.unmatched.push(...built.unmatched);
    }
    Object.assign(summary.errors, errors);
  }

  // Station performance.
  let names = null;
  try {
    const list = await client.fetchJson(`${API}/stationperformance/GetStations`);
    names = (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim()).slice(0, limit);
  } catch (e) {
    summary.errors['stationperformance/GetStations'] = errorText(e);
    log(`performance station list: ${errorText(e)}`);
  }
  if (names) {
    const results = [];
    const errors = {};
    for (const name of names) {
      try {
        const response = await client.fetchJson(`${API}/stationperformance/${enc(name)}?skip=0&take=${PERFORMANCE_TAKE}`);
        results.push({ name, crs: matchStationName(name, stations), response });
      } catch (e) {
        errors[name] = errorText(e);
        log(`performance ${name}: ${errors[name]}`);
      }
    }
    const built = buildPerformance(results, fetchedAt, errors, stations);
    if (Object.keys(built.stations).length) {
      sourcesOk += 1;
      writeJson(path.join(o.out, 'performance.json'), built);
      summary.performance = Object.keys(built.stations).length;
    }
    for (const [name, msg] of Object.entries(built.errors || {})) {
      if (msg === 'no SWR station matches this name') summary.unmatched.push(name);
      else summary.errors[name] = msg;
    }
  }

  return { ok: sourcesOk > 0, ...summary, requests: client.count() };
}

function parseArgs(argv) {
  const out = { mode: null, out: null, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--status' || a === '--weekly') out.mode = a.slice(2);
    else if ((a === '--out' || a === '--limit') && argv[i + 1]) {
      out[a.slice(2)] = a === '--limit' ? Number(argv[i + 1]) : argv[i + 1];
      i += 1;
    } else throw new Error(`bad argument ${a}`);
  }
  if (!out.mode || !out.out) throw new Error('Usage: node scripts/swr-snapshot.js --status|--weekly --out <dir> [--limit N]');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (m) => console.log(m);
  const started = Date.now();
  const result = args.mode === 'status'
    ? await runStatus({ out: args.out, log })
    : await runWeekly({ out: args.out, limit: args.limit, log });
  const secs = Math.round((Date.now() - started) / 1000);
  if (args.mode === 'status') {
    const failed = Object.keys(result.errors);
    console.log(`Wrote ${path.join(args.out, 'status.json')} (${result.requests} requests, ${secs} s)${failed.length ? `; failed: ${failed.join(', ')}` : ''}.`);
  } else {
    console.log(`Wrote ${result.seats} seat files and performance for ${result.performance} stations to ${args.out} (${result.requests} requests, ${secs} s).`);
    if (result.unmatched.length) console.log(`Names with no SWR station: ${result.unmatched.join(', ')}`);
    const failed = Object.keys(result.errors);
    if (failed.length) console.log(`Failed: ${failed.map((k) => `${k} (${result.errors[k]})`).join(', ')}`);
  }
  if (!result.ok) {
    console.error('Every source failed.');
    process.exitCode = 1;
  }
}

module.exports = {
  nameKey,
  matchStationName,
  NAME_ALIASES,
  seatOrigins,
  buildStatus,
  buildSeats,
  buildPerformance,
  createClient,
  runStatus,
  runWeekly,
  parseArgs,
  USER_AGENT,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
