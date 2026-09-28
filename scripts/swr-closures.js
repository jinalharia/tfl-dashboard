/*
 * Package S5: SWR planned closures (engineering works) for the next 14 days, for the SWR tab's
 * #swr-closures section (js/swr-closures.js).
 *
 * An optional hook of package S7: `node scripts/swr-snapshot.js --status` requires this file and
 * calls its snapshot({fetchJson, fetchText, log}), then writes the result to data/swr/closures.json.
 * National Rail's pages send no CORS headers, so browsers can't read them directly.
 *
 * Sources (found on 2026-09-28; see plan.md, Package S5):
 *   GET https://www.nationalrail.co.uk/engineering-works/
 *       National Rail's planned engineering works for today, all operators. A Next.js page: the data is
 *       the JSON in <script id="__NEXT_DATA__">: buildId, and props.pageProps.data {requestParams{date},
 *       engineeringWorks[{name, slug, summary (rich text), startDateTime, endDateTime, priority,
 *       operatorsAffectedCollection[{name, code}], sys{id, publishedAt}}]}.
 *   GET https://www.nationalrail.co.uk/_next/data/{buildId}/engineering-works.json?date=YYYYMMDD
 *       The same data for another day, as {pageProps} (what the page loads when you pick a date).
 *       The HTML page takes ?date=YYYYMMDD too, but National Rail's CDN caches it without the query
 *       string, so it often answers with another day's listing; it's only a fallback, and every
 *       listing is checked against its requestParams.date. (&operatorCode=SW would filter to one
 *       operator; asking for all covers Island Line (IL) too.)
 *   GET https://www.nationalrail.co.uk/engineering-works/{slug}-{YYYYMMDD of startDateTime}/
 *       One notice: props.pageProps.plannedIncident {summary, routesAffected, description (rich text), …}.
 *   GET https://api.tfl.gov.uk/Line/south-western-railway/Route/Sequence/outbound
 *       orderedLineRoutes[{name, naptanIds[]}]: consecutive stops give a track graph, used to work out the
 *       stations between the two ends of a closure ("between Hounslow and Virginia Water" → Feltham,
 *       Ashford, Staines, Egham too).
 *   GET https://jinalharia.github.io/tfl-dashboard/data/swr/closures.json
 *       The last published file. The status run is every 15 minutes, but works are announced weeks
 *       ahead, so it's reused as is while it's under 6 hours old, and its notices are reused while
 *       National Rail's publishedAt is unchanged. A normal run makes 1 request; a refresh about 17–30.
 *
 * Output (FORMAT 1): see plan.md, "Snapshot file formats", and parseClosures() below.
 *
 * Node 18+, no dependencies, CommonJS. Uses only the fetchJson/fetchText it's given (S7's polite
 * client: one request at a time, 1 s apart, a 30 s timeout, one retry). The parsing is pure and
 * exported for tests/swr-closures.test.js.
 */
'use strict';

const NR_BASE = 'https://www.nationalrail.co.uk';
const TFL_ROUTES_URL = 'https://api.tfl.gov.uk/Line/south-western-railway/Route/Sequence/outbound';
const PREVIOUS_URL = 'https://jinalharia.github.io/tfl-dashboard/data/swr/closures.json';
const FORMAT = 1;
const DAYS = 14;
const REFRESH_HOURS = 6;
const OPERATORS = ['SW', 'IL']; // South Western Railway, Island Line
// stationsBetween() weighs each hop as km^HOP_EXPONENT: above 1, so a fast train's skip over stations costs more
// than the stopping route, but low enough that a long detour through many short hops doesn't win.
const HOP_EXPONENT = 1.25;
const LINK_HOSTS = ['nationalrail.co.uk', 'southwesternrailway.com', 'networkrail.co.uk', 'tfl.gov.uk'];

// ---------------------------------------------------------------------------
// Dates (Europe/London calendar days)
// ---------------------------------------------------------------------------

/** → 'YYYY-MM-DD', the London calendar date of an instant. */
function londonDate(ms) {
  const p = {};
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (calendar arithmetic, so clock changes don't matter). */
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The London dates to ask National Rail about: today and the next DAYS - 1. */
function windowDates(now, days) {
  const first = londonDate(now instanceof Date ? now.getTime() : Number(now));
  const out = [];
  for (let i = 0; i < (days || DAYS); i++) out.push(addDays(first, i));
  return out;
}

const compact = (ymd) => String(ymd).replace(/-/g, '');

/** The listing page (HTML). Without a date it's today's, and its __NEXT_DATA__ carries the buildId. */
function listingUrl(ymd) {
  return ymd ? `${NR_BASE}/engineering-works/?date=${compact(ymd)}` : `${NR_BASE}/engineering-works/`;
}

/** The same listing as Next.js's JSON data route ({pageProps}), which the page itself loads when the date changes. */
function listingDataUrl(buildId, ymd) {
  return `${NR_BASE}/_next/data/${encodeURIComponent(buildId)}/engineering-works.json?date=${compact(ymd)}`;
}

/**
 * The London date a listing is really for: its requestParams.date (London midnight in UTC for a dated
 * listing, "now" for today's). National Rail's CDN ignores the query string on the HTML page, so a
 * dated HTML request can come back as some other day's cached listing; this catches that. → 'YYYY-MM-DD' | null
 */
function listingDate(nextData) {
  const data = nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.data;
  const t = Date.parse(data && data.requestParams && data.requestParams.date);
  return Number.isNaN(t) ? null : londonDate(t);
}

/** A _next/data response ({pageProps}) in the same shape as __NEXT_DATA__ ({props: {pageProps}}). */
function asNextData(body) {
  if (body && body.props) return body;
  return body && body.pageProps ? { props: { pageProps: body.pageProps } } : null;
}

/**
 * National Rail's own link for a notice: /engineering-works/{slug}-{YYYYMMDD}/, the date being the
 * start date as written in startDateTime (which carries the London offset).
 */
function detailUrl(slug, startDateTime) {
  const day = String(startDateTime || '').slice(0, 10);
  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `${NR_BASE}/engineering-works/${encodeURIComponent(slug)}-${compact(day)}/`;
}

// ---------------------------------------------------------------------------
// Page data
// ---------------------------------------------------------------------------

/** A Next.js page's HTML → its __NEXT_DATA__ object, or null. */
function extractNextData(html) {
  const m = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** An https link to one of LINK_HOSTS, or null. */
function safeLink(raw) {
  let href = String(raw == null ? '' : raw).trim().replace(/^https?:\/\/+(?=https?:\/\/)/i, '');
  if (/^\//.test(href)) href = NR_BASE + href; // National Rail's own relative links
  let url;
  try { url = new URL(href); } catch (e) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  return LINK_HOSTS.some((d) => host === d || host.endsWith('.' + d)) ? url.href : null;
}

const BLOCK_NODES = new Set(['paragraph', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'blockquote']);

/**
 * Contentful rich text ({json: {nodeType: 'document', content}} or the document itself) →
 * paragraphs [{text, parts: [{text} | {text, href}]}], the shape SwrApi.htmlToText returns, so the page
 * renders them with SwrApi.renderParagraphs. List items become "• …" paragraphs. Only https links to
 * LINK_HOSTS are kept; other links keep their text.
 */
function richTextParagraphs(rich) {
  const doc = rich && rich.json ? rich.json : rich;
  const out = [];
  let parts = null;
  let bullet = false;
  const push = (text, href) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (!href && last && !last.href) last.text += text;
    else parts.push(href ? { text, href } : { text });
  };
  const inline = (n, href) => {
    if (!n || typeof n !== 'object') return;
    if (n.nodeType === 'text') return push(String(n.value || ''), href);
    if (n.nodeType === 'hyperlink') {
      const link = safeLink(n.data && n.data.uri);
      for (const c of n.content || []) inline(c, link || null);
      return;
    }
    for (const c of n.content || []) inline(c, href);
  };
  const flush = () => {
    if (!parts) return;
    // Tidy whitespace: collapse runs, trim the ends.
    for (const p of parts) p.text = p.text.replace(/\s+/g, ' ');
    while (parts.length && !parts[0].text.trim()) parts.shift();
    while (parts.length && !parts[parts.length - 1].text.trim()) parts.pop();
    if (parts.length) {
      parts[0].text = parts[0].text.replace(/^\s+/, '');
      parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, '');
      if (bullet) {
        if (parts[0].href) parts.unshift({ text: '• ' });
        else parts[0].text = '• ' + parts[0].text;
      }
      const text = parts.map((p) => p.text).join('');
      if (text.trim()) out.push({ text, parts });
    }
    parts = null;
  };
  const block = (n, inList) => {
    if (!n || typeof n !== 'object') return;
    if (BLOCK_NODES.has(n.nodeType)) {
      flush();
      parts = [];
      bullet = inList;
      for (const c of n.content || []) inline(c, null);
      flush();
      return;
    }
    if (n.nodeType === 'text' || n.nodeType === 'hyperlink') {
      if (!parts) { parts = []; bullet = inList; }
      inline(n, null);
      return;
    }
    const list = n.nodeType === 'list-item' ? true : inList;
    for (const c of n.content || []) block(c, list);
    if (n.nodeType === 'list-item') flush();
  };
  if (doc && typeof doc === 'object') block(doc, false);
  flush();
  return out;
}

/** Rich text → one line of plain text. */
function richTextPlain(rich) {
  return clean(richTextParagraphs(rich).map((p) => p.text).join(' '));
}

/**
 * A listing page's __NEXT_DATA__ → [{id, slug, name, title, from, to, operators, priority, publishedAt}]
 * for SWR and Island Line notices only. [] when the page isn't the expected shape.
 */
function parseListing(nextData, operators) {
  const ops = operators || OPERATORS;
  const data = nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.data;
  const list = data && Array.isArray(data.engineeringWorks) ? data.engineeringWorks : [];
  const out = [];
  for (const e of list) {
    if (!e || !e.slug) continue;
    const codes = (Array.isArray(e.operatorsAffectedCollection) ? e.operatorsAffectedCollection : (e.operatorsAffectedCollection && e.operatorsAffectedCollection.items) || [])
      .map((o) => clean(o && (o.code || o.operatorCode)).toUpperCase()).filter(Boolean);
    if (!codes.some((c) => ops.includes(c))) continue;
    const from = clean(e.startDateTime) || null;
    const to = clean(e.endDateTime) || null;
    if (!from || Number.isNaN(Date.parse(from))) continue;
    out.push({
      id: clean(e.sys && e.sys.id) || `${e.slug}-${compact(from.slice(0, 10))}`,
      slug: clean(e.slug),
      name: clean(e.name),
      title: richTextPlain(e.summary) || clean(e.name),
      from,
      to: to && !Number.isNaN(Date.parse(to)) ? to : null,
      operators: codes,
      priority: clean(e.priority) || null,
      publishedAt: clean(e.sys && e.sys.publishedAt) || null,
    });
  }
  return out;
}

/** A notice page's __NEXT_DATA__ → {routes: text, details: paragraphs} or null. */
function parseDetail(nextData) {
  const pp = nextData && nextData.props && nextData.props.pageProps;
  const inc = pp && (pp.plannedIncident || pp.unplannedIncident);
  if (!inc || typeof inc !== 'object') return null;
  return {
    routes: richTextPlain(inc.routesAffected),
    details: richTextParagraphs(inc.description),
  };
}

// ---------------------------------------------------------------------------
// Stations named in a notice, and the stations between them
// ---------------------------------------------------------------------------

/** Normalises names and text the same way: & → and, no brackets, dots or apostrophes, hyphens as spaces. Keeps case. */
function normText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, ' and ')
    .replace(/[()[\]]/g, ' ')
    .replace(/[-‐‑–—]/g, ' ')
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Short names that would match ordinary words or other places.
const SKIP_ALIASES = new Set(['Dean', 'London Road']);
const EXTRA_ALIASES = { WAT: ['Waterloo'] };

/**
 * SWR_STATIONS → a matcher {re, byName}. Each station matches its full name and its name without the
 * bracketed part ("Ascot (Berks)" → "Ascot"), case-sensitively on whole words, longest name first so
 * "Ash Vale" isn't read as "Ash".
 */
function stationMatcher(stations) {
  const byName = new Map();
  for (const s of stations || []) {
    if (!s || !s.crs || !s.name) continue;
    const names = [s.name, s.name.replace(/\s*\([^)]*\)\s*/g, ' ')].concat(EXTRA_ALIASES[s.crs] || []);
    for (const n of names) {
      const key = normText(n);
      if (!key || SKIP_ALIASES.has(key) || byName.has(key)) continue;
      byName.set(key, s.crs);
    }
  }
  const alts = [...byName.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = alts.length ? new RegExp(`(?<![A-Za-z0-9])(?:${alts.join('|')})(?![A-Za-z0-9])`, 'g') : null;
  return { re, byName };
}

/** Text → {crs: [CRS in order of first mention], masked: the normalised text with each name as §CRS§}. */
function findStations(text, matcher) {
  const norm = normText(text);
  const crs = [];
  if (!matcher || !matcher.re) return { crs, masked: norm };
  const masked = norm.replace(matcher.re, (name) => {
    const c = matcher.byName.get(name);
    if (!crs.includes(c)) crs.push(c);
    return `§${c}§`;
  });
  return { crs, masked };
}

const GROUP = '§[A-Z]{3}§(?:\\s*(?:\\/|,|or)\\s*§[A-Z]{3}§)*';
const BETWEEN_RE = new RegExp(`(?:between|and\\s+also(?:\\s+between)?)\\s+(${GROUP})\\s+and\\s+(?:(?:all\\s+)?stations\\s+(?:via|to)\\s+)?(${GROUP})`, 'gi');
const codesIn = (group) => (group.match(/§([A-Z]{3})§/g) || []).map((g) => g.slice(1, 4));

/** Masked text → [[fromCRS[], toCRS[]]] for each "between A / B and C / D". */
function betweenPairs(masked) {
  const out = [];
  BETWEEN_RE.lastIndex = 0;
  let m;
  while ((m = BETWEEN_RE.exec(String(masked || '')))) out.push([codesIn(m[1]), codesIn(m[2])]);
  return out;
}

/**
 * TfL /Route/Sequence → the track graph: Map CRS → Map neighbour CRS → km, from consecutive stops on
 * every ordered route (via each station's naptan; stations TfL doesn't have, such as the Island Line,
 * are left out). Fast routes add "skip" edges (Waterloo → Surbiton); stationsBetween() avoids them.
 */
function parseRoutes(sequence, stations) {
  const byNaptan = new Map();
  const where = new Map();
  for (const s of stations || []) {
    if (!s) continue;
    if (s.naptan) byNaptan.set(s.naptan, s.crs);
    if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) where.set(s.crs, s);
  }
  const graph = new Map();
  const link = (a, b) => {
    const pa = where.get(a);
    const pb = where.get(b);
    if (!pa || !pb || a === b) return;
    const km = distanceKm(pa, pb);
    if (!graph.has(a)) graph.set(a, new Map());
    if (!graph.has(b)) graph.set(b, new Map());
    graph.get(a).set(b, km);
    graph.get(b).set(a, km);
  };
  const routes = sequence && Array.isArray(sequence.orderedLineRoutes) ? sequence.orderedLineRoutes : [];
  for (const r of routes) {
    const list = (r && Array.isArray(r.naptanIds) ? r.naptanIds : []).map((id) => byNaptan.get(id)).filter(Boolean);
    for (let i = 1; i < list.length; i++) link(list[i - 1], list[i]);
  }
  return graph;
}

function distanceKm(a, b) {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * The stations from a to b along the track graph, both included. The path minimises the sum of
 * km^HOP_EXPONENT per hop, so it follows the all-stations route rather than a fast train's skip from one
 * end to the other (Waterloo → Exeter St Davids goes via Woking and Salisbury, calling everywhere).
 * → [CRS]; [a, b] when the graph doesn't connect them.
 */
function stationsBetween(a, b, graph) {
  if (a === b) return [a];
  if (!graph || !graph.has(a) || !graph.has(b)) return [a, b];
  const dist = new Map([[a, 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let u = null;
    for (const [k, d] of dist) if (!done.has(k) && (u === null || d < dist.get(u))) u = k;
    if (u === null) return [a, b];
    if (u === b) break;
    done.add(u);
    for (const [v, km] of graph.get(u)) {
      const d = dist.get(u) + Math.pow(km, HOP_EXPONENT);
      if (!dist.has(v) || d < dist.get(v)) {
        dist.set(v, d);
        prev.set(v, u);
      }
    }
  }
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0]));
  return path;
}

/**
 * Text → [CRS]: every station named, plus (unless expand is false) the stations between each
 * "between A and B" pair along the track graph.
 */
function affectedStations(text, matcher, graph, expand) {
  const { crs, masked } = findStations(text, matcher);
  const out = crs.slice();
  if (expand === false) return out;
  for (const [from, to] of betweenPairs(masked)) {
    for (const a of from) for (const b of to) for (const c of stationsBetween(a, b, graph)) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** What kind of closure a notice's title describes, for the page's label. */
function closureKind(title) {
  const t = String(title || '').toLowerCase();
  if (/buses? replace|replacement bus/.test(t)) return 'buses';
  if (/no trains|\bclosed\b|closure|line(s)? (will be )?closed/.test(t)) return 'closed';
  if (/station (improvement|upgrade|work)|step-free|lift/.test(t)) return 'station';
  return 'amended';
}

// ---------------------------------------------------------------------------
// Building closures.json
// ---------------------------------------------------------------------------

/**
 * One item of closures.json from a listing entry and its (optional) notice.
 *   {id, title, summary, from, to, kind, operators, stations, routeStations, routes, details, url, publishedAt}
 * stations: where trains don't run or the station itself is affected: every station the title names;
 *   when buses replace trains or the line is closed, the stations between its ends; and the stretch in
 *   National Rail's usual first line, "Engineering work is taking place between A and B, closing all lines"
 *   (or "closing lines through X").
 * routeStations: those, plus the stretch from that first line when it closes only "some" or "various"
 *   lines, plus every station named under "routes affected" (trains to or from there run differently),
 *   without filling in the stations between. An amended timetable over a long stretch ("between London
 *   Waterloo and Exeter St Davids") isn't filled in either: trains still run.
 */
function buildItem(entry, detail, matcher, graph) {
  const d = detail || { routes: '', details: [] };
  const kind = closureKind(entry.title);
  const first = (d.details || []).find((p) => p.text && p.text.length > 20);
  const add = (list, more) => { for (const c of more) if (!list.includes(c)) list.push(c); };
  const stations = affectedStations(entry.title, matcher, graph, kind === 'buses' || kind === 'closed');
  const works = first && /engineering work is taking place/i.test(first.text) ? first.text : '';
  if (works && /closing (all lines|(the )?lines through)/i.test(works)) add(stations, affectedStations(works, matcher, graph, true));
  const routeStations = stations.slice();
  if (works) add(routeStations, affectedStations(works, matcher, graph, true));
  add(routeStations, findStations(d.routes, matcher).crs);
  return {
    id: entry.id,
    title: entry.title,
    summary: first ? first.text : null,
    from: entry.from,
    to: entry.to,
    kind,
    operators: entry.operators,
    stations,
    routeStations,
    routes: d.routes ? [d.routes] : [],
    details: d.details || [],
    url: detailUrl(entry.slug, entry.from),
    publishedAt: entry.publishedAt,
  };
}

/**
 * Raw pages → the closures.json object.
 *   raw = {fetchedAt, dates: ['YYYY-MM-DD'…], listings: [nextData | null per date],
 *          details: {id: nextData | parsed {routes, details}}, routes: TfL sequence | null,
 *          stations: SWR_STATIONS, errors: {}}
 * Items overlap the window (end on or after its first day, start on or before its last), SWR's first,
 * sorted by start then title; each notice once however many days list it.
 */
function parseClosures(raw) {
  const r = raw || {};
  const stations = r.stations || [];
  const matcher = stationMatcher(stations);
  const graph = r.routes ? parseRoutes(r.routes, stations) : null;
  const dates = r.dates || [];
  const first = dates[0] || null;
  const last = dates[dates.length - 1] || null;
  const entries = new Map();
  for (const page of r.listings || []) {
    for (const e of parseListing(page)) if (!entries.has(e.id)) entries.set(e.id, e);
  }
  const items = [];
  for (const e of entries.values()) {
    const start = e.from.slice(0, 10);
    const end = (e.to || e.from).slice(0, 10);
    if (first && end < first) continue;
    if (last && start > last) continue;
    let detail = r.details && r.details[e.id];
    if (detail && detail.props) detail = parseDetail(detail);
    items.push(buildItem(e, detail || null, matcher, graph));
  }
  items.sort((a, b) => Date.parse(a.from) - Date.parse(b.from) || a.title.localeCompare(b.title));
  return {
    format: FORMAT,
    fetchedAt: r.fetchedAt || new Date().toISOString(),
    source: 'National Rail planned engineering works (nationalrail.co.uk/engineering-works/)',
    window: { from: first, to: last },
    errors: r.errors || {},
    items,
  };
}

/** A previous closures.json that can be reused as is: same format, under maxAgeHours old. */
function reusable(previous, now, maxAgeHours) {
  if (!previous || typeof previous !== 'object' || previous.format !== FORMAT || !Array.isArray(previous.items)) return false;
  const t = Date.parse(previous.fetchedAt);
  const n = now instanceof Date ? now.getTime() : Number(now);
  const age = n - t;
  return Number.isFinite(age) && age >= 0 && age < (maxAgeHours == null ? REFRESH_HOURS : maxAgeHours) * 3600 * 1000;
}

const errorText = (e) => clean((e && e.message) || e) || 'failed';

/**
 * The S7 hook. → the closures.json object, or null when nothing could be fetched and there's no
 * previous file. Options: fetchJson, fetchText, log (from S7); now, previousUrl, stations, days,
 * maxAgeHours (for tests and local runs; previousUrl: null skips the reuse).
 */
async function snapshot(options) {
  const o = options || {};
  const log = o.log || (() => {});
  const now = o.now ? new Date(o.now) : new Date();
  const stations = o.stations || require('../js/swr-stations.js');
  const previousUrl = o.previousUrl === undefined ? (process.env.SWR_CLOSURES_PREVIOUS_URL || PREVIOUS_URL) : o.previousUrl;

  let previous = null;
  if (previousUrl) {
    try { previous = await o.fetchJson(previousUrl); } catch (e) { log(`closures: no previous file (${errorText(e)})`); }
    if (reusable(previous, now, o.maxAgeHours)) {
      log(`closures: reusing the file from ${previous.fetchedAt}`);
      return previous;
    }
  }

  const errors = {};
  const dates = windowDates(now, o.days || DAYS);
  const listings = [];
  const fail = (key, e) => {
    errors[key] = errorText(e);
    log(`closures: ${key}: ${errors[key]}`);
  };

  // Today's listing page gives the buildId for the JSON data route, and usually today's listing.
  let buildId = null;
  let todayDone = false;
  try {
    const page = extractNextData(await o.fetchText(listingUrl(null)));
    if (!page) throw new Error('no page data');
    buildId = page.buildId || null;
    if (listingDate(page) === dates[0]) {
      listings.push(page);
      todayDone = true;
    }
  } catch (e) {
    fail('listing page', e);
  }
  for (const day of dates) {
    if (day === dates[0] && todayDone) continue;
    let page = null;
    let why = null;
    // The JSON data route is cached per query string; the HTML page isn't (see listingDate), so it's the fallback.
    const attempts = buildId ? [() => o.fetchJson(listingDataUrl(buildId, day)), () => o.fetchText(listingUrl(day))] : [() => o.fetchText(listingUrl(day))];
    for (const attempt of attempts) {
      try {
        const body = await attempt();
        const candidate = typeof body === 'string' ? extractNextData(body) : asNextData(body);
        if (!candidate) throw new Error('no page data');
        const got = listingDate(candidate);
        if (got !== day) throw new Error(`got the listing for ${got || 'an unknown day'}`);
        page = candidate;
        break;
      } catch (e) {
        why = e;
      }
    }
    if (page) listings.push(page);
    else fail(`listing ${day}`, why);
  }
  if (!listings.length) {
    if (previous && previous.format === FORMAT && Array.isArray(previous.items)) {
      log('closures: every listing failed; keeping the previous file');
      return previous;
    }
    throw new Error('every National Rail listing failed');
  }

  let routes = null;
  try { routes = await o.fetchJson(TFL_ROUTES_URL); } catch (e) { fail('TfL routes', e); }

  // Notices: reuse the previous file's copy while National Rail's publishedAt is unchanged.
  const known = new Map();
  for (const it of (previous && Array.isArray(previous.items) ? previous.items : [])) {
    if (it && it.id && it.publishedAt) known.set(it.id, it);
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  const details = {};
  const wanted = new Map();
  for (const page of listings) for (const e of parseListing(page)) if (!wanted.has(e.id)) wanted.set(e.id, e);
  for (const e of wanted.values()) {
    if ((e.to || e.from).slice(0, 10) < first || e.from.slice(0, 10) > last) continue;
    const old = known.get(e.id);
    if (old && old.publishedAt === e.publishedAt) {
      details[e.id] = { routes: (old.routes || []).join(' '), details: old.details || [] };
      continue;
    }
    const url = detailUrl(e.slug, e.from);
    if (!url) continue;
    try {
      const page = extractNextData(await o.fetchText(url));
      if (!page || !parseDetail(page)) throw new Error('no page data');
      details[e.id] = page;
    } catch (err) {
      fail(`notice ${e.slug}`, err);
    }
  }

  const result = parseClosures({ fetchedAt: now.toISOString(), dates, listings, details, routes, stations, errors });
  log(`closures: ${result.items.length} notices for ${first} to ${last}`);
  return result;
}

module.exports = {
  FORMAT,
  DAYS,
  REFRESH_HOURS,
  PREVIOUS_URL,
  TFL_ROUTES_URL,
  londonDate,
  addDays,
  windowDates,
  listingUrl,
  listingDataUrl,
  listingDate,
  asNextData,
  detailUrl,
  extractNextData,
  safeLink,
  richTextParagraphs,
  richTextPlain,
  parseListing,
  parseDetail,
  normText,
  stationMatcher,
  findStations,
  betweenPairs,
  parseRoutes,
  distanceKm,
  stationsBetween,
  affectedStations,
  closureKind,
  buildItem,
  parseClosures,
  reusable,
  snapshot,
};
