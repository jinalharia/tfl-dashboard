const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scripts/swr-snapshot.js');
const SWR_STATIONS = require('../js/swr-stations.js');

const API = 'https://www.southwesternrailway.com/api';
const AT = '2026-09-28T05:17:00.000Z';

// ---------------------------------------------------------------------------
// Fixtures: real responses from 2026-09-27, trimmed
// ---------------------------------------------------------------------------

// GET https://www.southwesternrailway.com/api/seatavailability/stations/London%20Waterloo (8 of 166 names)
const SEAT_STATIONS = ['Ascot', 'Boxhill & Westhumble', 'Kingston', 'London Waterloo', 'NOT FOUND', 'Surbiton', 'Woking', 'Queenstown Road Battersea'];

// GET https://www.southwesternrailway.com/api/stationperformance/GetStations (6 of 171 names)
const PERF_STATIONS = ['Ascot (Berks)', 'Box Hill and Westhumble', "Cobham and Stoke D'abernon", "Exeter St David's", 'Richmond (London)', 'Surbiton'];

// GET https://www.southwesternrailway.com/api/seatavailability/Woking/London%20Waterloo?skip=0&take=100 (2 of 43 items)
const WOKING_ITEMS = [
  { Id: 17, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '06:28', Arrival: '07:04', JourneyDuration: '12:34:00 AM', Via: '-', NumberOfCarriages: 8, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 223, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '06:32', Arrival: '07:24', JourneyDuration: '12:52:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' },
];

// GET https://www.southwesternrailway.com/api/seatavailability/Surbiton/London%20Waterloo?skip=0&take=10 (1 of 26 items)
const SURBITON_ITEM = { Id: 2, StationFrom: 'Surbiton', StationTo: 'London Waterloo', Departure: '06:31', Arrival: '07:03', JourneyDuration: '12:30:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' };

// GET https://www.southwesternrailway.com/api/stationperformance/Surbiton?skip=0&take=10
const PERF_SURBITON = {
  TotalResults: 2,
  Items: [
    { Id: 177, StationName: 'Surbiton', CRSCode: 'SUR', TOC: 'SWR', Punctal: '85.00', Cancelled: '3.90' },
    { Id: 194, StationName: 'Wessex route target', CRSCode: '', TOC: '', Punctal: '86.12', Cancelled: '3.68' },
  ],
  Period: '4-Week Period from 26 July to 22 August',
  Next3MonthPlan: 'Preparation & delivery for Autumn 2026 season and Winter planning - responsible for delivery: Mark Goodall',
  NextYearPlan: 'Increase usage of bodyworn cameras to deter antisocial behaviour - responsible for delivery: Stuart Meek',
  LongTermPlan: 'Proactive maintenance to reduce coupling equipment and door faults - responsible for delivery: Stuart Meek',
  WessexRouteData: '',
};

// GET https://www.southwesternrailway.com/api/stationperformance/Exeter%20St%20David's?skip=0&take=10 (one row per operator; 2 of 3 kept)
const PERF_EXETER = {
  TotalResults: 4,
  Items: [
    { Id: 69, StationName: "Exeter St David's", CRSCode: 'EXD', TOC: 'GWR', Punctal: '66.40', Cancelled: '4.00' },
    { Id: 71, StationName: "Exeter St David's", CRSCode: 'EXD', TOC: 'SWR', Punctal: '58.60', Cancelled: '10.70' },
    { Id: 194, StationName: 'Wessex route target', CRSCode: '', TOC: '', Punctal: '86.12', Cancelled: '3.68' },
  ],
  Period: '4-Week Period from 26 July to 22 August',
};

// GET https://www.southwesternrailway.com/api/overallstatus (one of two LineUpdates, Details trimmed)
const OVERALL = {
  IsOverwriteFeedStatus: false,
  Status: 'MajorDisruption',
  Summary: 'Alterations to services at Yeovil Junction',
  LineUpdates: [{
    Summary: 'Alterations to services at Yeovil Junction',
    Details: "Following a broken down train earlier today at Yeovil Junction all lines have now reopened.<br /><br /><span style='color: #0092cb;'>",
    FurtherInfo: 'An update will follow within the next 2 hours.',
    MarketingInfo: '', OperatorCode: 'SW', UpdateType: 'line', UpdatedTime: '19:18:22 27/09/2026', IncidentId: '1297592241', Colour: 'Code Red',
  }],
};

// GET https://www.southwesternrailway.com/api/LiveInformationBoard (2 of 13 groups)
const LIVE_BOARD = [
  { RouteName: 'Kingston/Shepperton', StatusText: 'Good Service', StatusId: '0' },
  { RouteName: 'Suburban Lines', StatusText: 'Major Disruption', StatusId: '2' },
];

// GET https://www.southwesternrailway.com/api/RainbowBoard (2 of 49 lines)
const RAINBOW = {
  LastUpdated: '2026-09-27T18:19:00+00:00',
  Lines: [
    { Description: 'Waterloo to Portsmouth via Guildford', Status: 'Good Service', Incidents: ' ' },
    { Description: 'Portsmouth to Waterloo via Guildford', Status: 'Minor Disruption', Incidents: 'Services may be disrupted due to a passenger being taken ill on a train between Godalming and Guildford.' },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const made = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-snapshot-test-'));
  made.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** A fetch that answers from routes {url: body | Error | (url) => body}; unknown URLs are 404. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    let body = routes[url];
    if (typeof body === 'function') body = body(url);
    if (body instanceof Error) throw body;
    if (body === undefined) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const quick = (extra) => ({ minGapMs: 0, sleep: async () => {}, now: () => new Date(AT), ...extra });

// ---------------------------------------------------------------------------
// matchStationName
// ---------------------------------------------------------------------------

test('matchStationName: the real mismatches between the seat, performance and station lists', () => {
  assert.equal(S.matchStationName('Ascot', SWR_STATIONS), 'ACT'); // swrstations: "Ascot (Berks)"
  assert.equal(S.matchStationName('Ascot (Berks)', SWR_STATIONS), 'ACT');
  assert.equal(S.matchStationName('Boxhill & Westhumble', SWR_STATIONS), 'BXW'); // alias: "Box Hill & Westhumble"
  assert.equal(S.matchStationName('Box Hill and Westhumble', SWR_STATIONS), 'BXW'); // "and" = "&"
  assert.equal(S.matchStationName('NOT FOUND', SWR_STATIONS), null);
  assert.equal(S.matchStationName('', SWR_STATIONS), null);
  assert.equal(S.matchStationName('Nowhere Parkway', SWR_STATIONS), null);
});

test('matchStationName: brackets, apostrophes and case', () => {
  assert.equal(S.matchStationName("Cobham and Stoke D'abernon", SWR_STATIONS), 'CSD');
  assert.equal(S.matchStationName("Cobham & Stoke d'Abernon", SWR_STATIONS), 'CSD');
  assert.equal(S.matchStationName("Exeter St David's", SWR_STATIONS), 'EXD');
  assert.equal(S.matchStationName('Exeter St Davids', SWR_STATIONS), 'EXD');
  assert.equal(S.matchStationName('Queenstown Road Battersea', SWR_STATIONS), 'QRB');
  assert.equal(S.matchStationName('Queenstown Road (Battersea)', SWR_STATIONS), 'QRB');
  assert.equal(S.matchStationName('Richmond (London)', SWR_STATIONS), 'RMD');
  assert.equal(S.matchStationName('Farnborough (Main)', SWR_STATIONS), 'FNB');
  assert.equal(S.matchStationName('London Road (Guildford)', SWR_STATIONS), 'LRD');
  assert.equal(S.matchStationName('Portsmouth & Southsea', SWR_STATIONS), 'PMS');
  assert.equal(S.matchStationName('WOKING', SWR_STATIONS), 'WOK');
});

test('matchStationName: dropping brackets must name exactly one station', () => {
  const stations = [{ crs: 'AAA', name: 'Hampton (London)' }, { crs: 'BBB', name: 'Hampton (Devon)' }, { crs: 'CCC', name: 'Hampton Court' }];
  assert.equal(S.matchStationName('Hampton', stations), null);
  assert.equal(S.matchStationName('Hampton (Devon)', stations), 'BBB');
  assert.equal(S.matchStationName('Hampton Court', stations), 'CCC');
  assert.equal(S.matchStationName('Boxhill & Westhumble', stations), null); // alias only if that CRS is in the list
});

test('seatOrigins skips NOT FOUND, London Waterloo itself and repeats', () => {
  assert.deepEqual(S.seatOrigins([...SEAT_STATIONS, 'Woking', ' ', null]),
    ['Ascot', 'Boxhill & Westhumble', 'Kingston', 'Surbiton', 'Woking', 'Queenstown Road Battersea']);
  assert.deepEqual(S.seatOrigins(null), []);
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

test('buildStatus keeps the three raw responses under the keys S3 reads', () => {
  const out = S.buildStatus({ overallstatus: OVERALL, liveInformationBoard: LIVE_BOARD, rainbowBoard: RAINBOW }, {}, AT);
  assert.deepEqual(Object.keys(out), ['fetchedAt', 'errors', 'overallstatus', 'liveInformationBoard', 'rainbowBoard']);
  assert.equal(out.fetchedAt, AT);
  assert.deepEqual(out.errors, {});
  assert.equal(out.overallstatus, OVERALL);
  assert.equal(out.liveInformationBoard, LIVE_BOARD);
  assert.equal(out.rainbowBoard, RAINBOW);

  const partial = S.buildStatus({ liveInformationBoard: LIVE_BOARD }, { overallstatus: 'HTTP 500', rainbowBoard: 'timeout' }, AT);
  assert.equal(partial.overallstatus, null);
  assert.equal(partial.rainbowBoard, null);
  assert.deepEqual(partial.errors, { overallstatus: 'HTTP 500', rainbowBoard: 'timeout' });
});

test('buildStatus output is read by the S3 normalisers', () => {
  const St = require('../js/swr-status.js');
  const out = S.buildStatus({ overallstatus: OVERALL, liveInformationBoard: LIVE_BOARD, rainbowBoard: RAINBOW }, {}, AT);
  const groups = St.normalizeRouteGroups(out.liveInformationBoard, out.rainbowBoard);
  assert.ok(groups.some((g) => g.name === 'Suburban Lines'));
  assert.equal(St.normalizeIncidents(out.overallstatus).incidents.length, 1);
});

test('buildSeats writes a file per station with items, and an index', () => {
  const built = S.buildSeats([
    { name: 'Woking', crs: 'WOK', items: WOKING_ITEMS },
    { name: 'Surbiton', crs: 'SUR', items: [SURBITON_ITEM] },
    { name: 'Kingston', crs: 'KNG', items: [] }, // no morning trains listed: no file
    { name: 'Nowhere Parkway', crs: null, items: [SURBITON_ITEM] },
  ], AT, { Ascot: 'HTTP 500' });
  assert.deepEqual(Object.keys(built.files).sort(), ['SUR', 'WOK']);
  assert.deepEqual(built.files.WOK, { fetchedAt: AT, crs: 'WOK', from: 'Woking', to: 'London Waterloo', items: WOKING_ITEMS });
  assert.deepEqual(built.index.stations, [{ crs: 'SUR', seatName: 'Surbiton' }, { crs: 'WOK', seatName: 'Woking' }]);
  assert.equal(built.index.fetchedAt, AT);
  assert.deepEqual(built.unmatched, ['Nowhere Parkway']);
  assert.deepEqual(built.index.errors, { Ascot: 'HTTP 500', 'Nowhere Parkway': 'no SWR station matches this name' });
  assert.equal(S.buildSeats([], AT, {}).index.errors, undefined);
});

test('buildPerformance keeps raw responses by CRS, with the target and period', () => {
  const out = S.buildPerformance([
    { name: 'Surbiton', crs: 'SUR', response: PERF_SURBITON },
    { name: "Exeter St David's", crs: null, response: PERF_EXETER }, // falls back to the response's CRSCode
    { name: 'Mystery', crs: null, response: { Items: [], Period: '' } },
    { name: 'Broken', crs: 'BRK', response: 'oops' },
  ], AT, { Ascot: 'HTTP 500' }, SWR_STATIONS);
  assert.equal(out.fetchedAt, AT);
  assert.equal(out.period, '4-Week Period from 26 July to 22 August');
  assert.deepEqual(out.target, { punctual: 86.12, cancelled: 3.68 });
  assert.deepEqual(Object.keys(out.stations), ['SUR', 'EXD']);
  assert.equal(out.stations.SUR, PERF_SURBITON);
  assert.deepEqual(out.errors, { Ascot: 'HTTP 500', Mystery: 'no SWR station matches this name' });

  const empty = S.buildPerformance([], AT, {}, SWR_STATIONS);
  assert.deepEqual(empty, { fetchedAt: AT, period: null, target: null, stations: {} });
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

test('createClient: one at a time, spaced out, one retry, User-Agent', async () => {
  let t = 0;
  const waits = [];
  let n = 0;
  const log = [];
  const client = S.createClient({
    minGapMs: 1000,
    now: () => t,
    sleep: async (ms) => { waits.push(ms); t += ms; },
    log: (m) => log.push(m),
    fetch: async (url, init) => {
      n += 1;
      assert.equal(init.headers['User-Agent'], S.USER_AGENT);
      assert.ok(init.signal);
      if (n === 2) throw new Error('socket hang up');
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    },
  });
  assert.deepEqual(await client.fetchJson('https://example.test/a'), { ok: true });
  assert.deepEqual(await client.fetchJson('https://example.test/b'), { ok: true }); // retried once
  assert.equal(client.count(), 3);
  assert.deepEqual(waits, [1000, 1000]);
  assert.equal(log.length, 1);

  const failing = S.createClient({ minGapMs: 0, fetch: async () => ({ ok: false, status: 503, text: async () => '' }) });
  await assert.rejects(failing.fetchJson('https://example.test/c'), /HTTP 503/);
  assert.equal(failing.count(), 2);
});

// ---------------------------------------------------------------------------
// Status mode, errors and the closures hook
// ---------------------------------------------------------------------------

const STATUS_ROUTES = {
  [`${API}/overallstatus`]: OVERALL,
  [`${API}/LiveInformationBoard`]: LIVE_BOARD,
  [`${API}/RainbowBoard`]: RAINBOW,
};

test('runStatus writes status.json; no closures module means no closures.json', async () => {
  const out = tmpDir();
  const { fetch } = fakeFetch(STATUS_ROUTES);
  const r = await S.runStatus(quick({ out, fetch, closuresModule: path.join(out, 'missing.js') }));
  assert.equal(r.ok, true);
  const status = readJson(path.join(out, 'status.json'));
  assert.deepEqual(status, { fetchedAt: AT, errors: {}, overallstatus: OVERALL, liveInformationBoard: LIVE_BOARD, rainbowBoard: RAINBOW });
  assert.equal(fs.existsSync(path.join(out, 'closures.json')), false);
});

test('runStatus records a failed source and still succeeds; all failing is not ok', async () => {
  const out = tmpDir();
  const { fetch } = fakeFetch({ ...STATUS_ROUTES, [`${API}/RainbowBoard`]: new Error('timed out') });
  const r = await S.runStatus(quick({ out, fetch, closuresModule: null }));
  assert.equal(r.ok, true);
  const status = readJson(path.join(out, 'status.json'));
  assert.equal(status.errors.rainbowBoard, 'timed out');
  assert.equal(status.rainbowBoard, null);
  assert.deepEqual(status.liveInformationBoard, LIVE_BOARD);

  const out2 = tmpDir();
  const down = await S.runStatus(quick({ out: out2, fetch: fakeFetch({}).fetch, closuresModule: null }));
  assert.equal(down.ok, false);
  assert.deepEqual(Object.keys(readJson(path.join(out2, 'status.json')).errors), ['overallstatus', 'liveInformationBoard', 'rainbowBoard']);
});

test('closures hook: the module gets the polite client and its result goes to closures.json', async () => {
  const out = tmpDir();
  const mod = path.join(out, 'fake-closures.js');
  fs.writeFileSync(mod, `module.exports = {
    async snapshot({ fetchJson, fetchText, log }) {
      const board = await fetchJson('${API}/LiveInformationBoard');
      const text = await fetchText('${API}/RainbowBoard');
      log('closures ok');
      return { closures: [{ route: board[0].RouteName, textLength: text.length }] };
    },
  };`);
  const { fetch, calls } = fakeFetch(STATUS_ROUTES);
  const logs = [];
  const r = await S.runStatus(quick({ out, fetch, closuresModule: mod, log: (m) => logs.push(m) }));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.init.headers['User-Agent'] === S.USER_AGENT));
  assert.deepEqual(readJson(path.join(out, 'closures.json')), { fetchedAt: AT, closures: [{ route: 'Kingston/Shepperton', textLength: JSON.stringify(RAINBOW).length }] });
  assert.deepEqual(readJson(path.join(out, 'status.json')).errors, {});
  assert.deepEqual(logs, ['closures ok']);
});

test('closures hook: null writes nothing; a throw is recorded as errors.closures', async () => {
  const out = tmpDir();
  const nullMod = path.join(out, 'null-closures.js');
  fs.writeFileSync(nullMod, 'module.exports = { snapshot: async () => null };');
  await S.runStatus(quick({ out, fetch: fakeFetch(STATUS_ROUTES).fetch, closuresModule: nullMod }));
  assert.equal(fs.existsSync(path.join(out, 'closures.json')), false);
  assert.deepEqual(readJson(path.join(out, 'status.json')).errors, {});

  const out2 = tmpDir();
  const badMod = path.join(out2, 'bad-closures.js');
  fs.writeFileSync(badMod, 'module.exports = { snapshot: async () => { throw new Error("no source yet"); } };');
  const r = await S.runStatus(quick({ out: out2, fetch: fakeFetch(STATUS_ROUTES).fetch, closuresModule: badMod }));
  assert.equal(r.ok, true);
  const status = readJson(path.join(out2, 'status.json'));
  assert.equal(status.errors.closures, 'no source yet');
  assert.deepEqual(status.liveInformationBoard, LIVE_BOARD);
  assert.equal(fs.existsSync(path.join(out2, 'closures.json')), false);
});

// ---------------------------------------------------------------------------
// Weekly mode
// ---------------------------------------------------------------------------

function seatUrl(name, skip) {
  return `${API}/seatavailability/${encodeURIComponent(name)}/London%20Waterloo?skip=${skip}&take=100`;
}
function perfUrl(name) {
  return `${API}/stationperformance/${encodeURIComponent(name)}?skip=0&take=10`;
}

test('runWeekly pages seats, skips empty stations, removes stale files and keeps failed ones', async () => {
  const out = tmpDir();
  const seats = path.join(out, 'seats');
  fs.mkdirSync(seats);
  fs.writeFileSync(path.join(seats, 'ZZZ.json'), '{}'); // a station that has no data any more
  fs.writeFileSync(path.join(seats, 'ACT.json'), JSON.stringify({ fetchedAt: 'last week', crs: 'ACT', from: 'Ascot', to: 'London Waterloo', items: [SURBITON_ITEM] }));
  const many = Array.from({ length: 130 }, (_, i) => ({ ...SURBITON_ITEM, Id: i }));
  const { fetch, calls } = fakeFetch({
    [`${API}/seatavailability/stations/London%20Waterloo`]: ['Ascot', 'Kingston', 'London Waterloo', 'NOT FOUND', 'Surbiton', 'Boxhill & Westhumble'],
    [seatUrl('Ascot', 0)]: new Error('timed out'), // keeps last week's file
    [seatUrl('Kingston', 0)]: { TotalResults: 0, Items: [] },
    [seatUrl('Surbiton', 0)]: { TotalResults: 130, Items: many.slice(0, 100) },
    [seatUrl('Surbiton', 100)]: { TotalResults: 130, Items: many.slice(100) },
    [seatUrl('Boxhill & Westhumble', 0)]: { TotalResults: 2, Items: WOKING_ITEMS },
    [`${API}/stationperformance/GetStations`]: ['Surbiton', "Exeter St David's", 'Ascot (Berks)'],
    [perfUrl('Surbiton')]: PERF_SURBITON,
    [perfUrl("Exeter St David's")]: PERF_EXETER,
  });
  const r = await S.runWeekly(quick({ out, fetch }));
  assert.equal(r.ok, true);
  assert.ok(!calls.some((c) => /NOT%20FOUND|London%20Waterloo\/London/.test(c.url)));
  assert.equal(calls.filter((c) => c.url === seatUrl('Ascot', 0)).length, 2); // one retry

  assert.deepEqual(fs.readdirSync(seats).sort(), ['ACT.json', 'BXW.json', 'SUR.json', 'index.json']);
  assert.equal(readJson(path.join(seats, 'SUR.json')).items.length, 130);
  assert.equal(readJson(path.join(seats, 'ACT.json')).fetchedAt, 'last week');
  const index = readJson(path.join(seats, 'index.json'));
  assert.deepEqual(index.stations, [{ crs: 'ACT', seatName: 'Ascot' }, { crs: 'BXW', seatName: 'Boxhill & Westhumble' }, { crs: 'SUR', seatName: 'Surbiton' }]);
  assert.equal(index.errors.Ascot, 'timed out');

  const perf = readJson(path.join(out, 'performance.json'));
  assert.deepEqual(Object.keys(perf.stations), ['SUR', 'EXD']);
  assert.deepEqual(perf.target, { punctual: 86.12, cancelled: 3.68 });
  assert.equal(perf.errors['Ascot (Berks)'], 'HTTP 404');
  assert.equal(r.errors['Ascot (Berks)'], 'HTTP 404');
});

test('runWeekly: a list that fails leaves the old files; everything failing is not ok', async () => {
  const out = tmpDir();
  fs.mkdirSync(path.join(out, 'seats'));
  fs.writeFileSync(path.join(out, 'seats', 'WOK.json'), '{"old":true}');
  fs.writeFileSync(path.join(out, 'performance.json'), '{"old":true}');
  const r = await S.runWeekly(quick({ out, fetch: fakeFetch({}).fetch }));
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['seatavailability/stations', 'stationperformance/GetStations']);
  assert.deepEqual(readJson(path.join(out, 'seats', 'WOK.json')), { old: true });
  assert.deepEqual(readJson(path.join(out, 'performance.json')), { old: true });
});

test('runWeekly --limit asks only the first N of each list and removes nothing', async () => {
  const out = tmpDir();
  fs.mkdirSync(path.join(out, 'seats'));
  fs.writeFileSync(path.join(out, 'seats', 'WOK.json'), '{"old":true}');
  const { fetch, calls } = fakeFetch({
    [`${API}/seatavailability/stations/London%20Waterloo`]: ['Surbiton', 'Woking'],
    [seatUrl('Surbiton', 0)]: { TotalResults: 1, Items: [SURBITON_ITEM] },
    [`${API}/stationperformance/GetStations`]: ['Surbiton', 'Woking'],
    [perfUrl('Surbiton')]: PERF_SURBITON,
  });
  const r = await S.runWeekly(quick({ out, fetch, limit: 1 }));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(readJson(path.join(out, 'seats', 'WOK.json')), { old: true });
});

test('parseArgs', () => {
  assert.deepEqual(S.parseArgs(['--status', '--out', 'x']), { mode: 'status', out: 'x', limit: 0 });
  assert.deepEqual(S.parseArgs(['--weekly', '--out', 'd', '--limit', '3']), { mode: 'weekly', out: 'd', limit: 3 });
  assert.throws(() => S.parseArgs(['--status']), /Usage/);
  assert.throws(() => S.parseArgs(['--nope']), /bad argument/);
});
