const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tfl-api.js');

test('normalizeLive reads percentageOfBaseline in either casing', () => {
  assert.deepEqual(
    T.normalizeLive({ dataAvailable: true, percentageOfBaseline: 0.42, timeUtc: 'u', timeLocal: 'l' }),
    { available: true, value: 0.42, timeLocal: 'l', timeUtc: 'u' }
  );
  assert.equal(T.normalizeLive({ dataAvailable: true, percentageOfBaseLine: 0.3 }).value, 0.3);
  assert.equal(T.normalizeLive({ dataAvailable: false, percentageOfBaseline: 0 }).available, false);
  assert.equal(T.normalizeLive({}).available, false);
  // Real "no data" response, e.g. /crowding/910GSTFD/Live
  assert.equal(T.normalizeLive({ dataAvailable: false, percentageOfBaseline: 0, timeUtc: null, timeLocal: null }).available, false);
});

test('toFraction tolerates percentages', () => {
  assert.equal(T.toFraction(0.5), 0.5);
  assert.equal(T.toFraction(55), 0.55);
  assert.equal(T.toFraction(null), null);
  assert.equal(T.toFraction('x'), null);
});

test('normalizeDay handles the single-day and all-days shapes', () => {
  const bands = [
    { timeBand: '05:00-05:15', percentageOfBaseLine: 0.02 },
    { timeBand: '00:15-00:30', percentageOfBaseLine: 0.05 },
    { timeBand: '08:00-08:15', percentageOfBaseLine: 0.9 },
  ];
  const single = T.normalizeDay({ dayOfWeek: 'MON', amPeakTimeBand: '08:00-08:15', timeBands: bands, isFound: true }, 'MON');
  assert.equal(single.found, true);
  assert.equal(single.amPeak, '08:00-08:15');
  // Sorted by service day (from 04:00), so the after-midnight band comes last.
  assert.deepEqual(single.bands.map((b) => b.start), [300, 480, 15]);

  const all = T.normalizeDay({ daysOfWeek: [{ dayOfWeek: 'SUN', timeBands: [] }, { dayOfWeek: 'MON', timeBands: bands }], isFound: true }, 'MON');
  assert.equal(all.bands.length, 3);
  assert.equal(T.normalizeDay({ isFound: false }, 'MON').found, false);
});

test('bandAt finds the band containing a time, including after midnight', () => {
  const day = T.normalizeDay({ timeBands: [
    { timeBand: '08:00-08:15', percentageOfBaseLine: 0.8 },
    { timeBand: '08:15-08:30', percentageOfBaseLine: 0.9 },
    { timeBand: '00:15-00:30', percentageOfBaseLine: 0.1 },
  ] }, 'MON');
  assert.equal(T.bandAt(day.bands, 8 * 60 + 20).value, 0.9);
  assert.equal(T.bandAt(day.bands, 20).value, 0.1);
  assert.equal(T.bandAt(day.bands, 14 * 60), null);
});

test('crowdingLevel bands', () => {
  assert.equal(T.crowdingLevel(0.1).key, 'quiet');
  assert.equal(T.crowdingLevel(0.3).key, 'moderate');
  assert.equal(T.crowdingLevel(0.6).key, 'busy');
  assert.equal(T.crowdingLevel(1.2).key, 'very-busy');
  assert.equal(T.crowdingLevel(null).key, 'unknown');
});

test('buildStationModel groups lines by station NaPTAN and drops bus', () => {
  const hub = {
    id: 'HUBSRA', commonName: 'Stratford',
    additionalProperties: [{ key: 'Zone', value: '2/3' }],
    lineGroup: [], lineModeGroups: [],
    children: [
      {
        naptanId: '940GZZLUSTD', lines: [{ id: 'central', name: 'Central' }, { id: 'jubilee', name: 'Jubilee' }],
        lineGroup: [{ stationAtcoCode: '940GZZLUSTD', lineIdentifier: ['central', 'jubilee'] }],
        lineModeGroups: [{ modeName: 'tube', lineIdentifier: ['central', 'jubilee'] }],
        children: [{ naptanId: '9400ZZLUSTD1', lineGroup: [{ naptanIdReference: '9400ZZLUSTD1', stationAtcoCode: '940GZZLUSTD', lineIdentifier: ['central'] }] }],
      },
      {
        naptanId: '910GSTFD', lines: [{ id: 'elizabeth', name: 'Elizabeth line' }],
        lineGroup: [{ stationAtcoCode: '910GSTFD', lineIdentifier: ['elizabeth'] }],
        lineModeGroups: [{ modeName: 'elizabeth-line', lineIdentifier: ['elizabeth'] }],
      },
      {
        naptanId: '490G00012345', lines: [{ id: '25', name: '25' }],
        lineGroup: [{ naptanIdReference: '490000012345', lineIdentifier: ['25'] }],
        lineModeGroups: [{ modeName: 'bus', lineIdentifier: ['25'] }],
      },
    ],
  };
  const m = T.buildStationModel(hub);
  assert.equal(m.name, 'Stratford');
  assert.equal(m.zone, '2/3');
  assert.deepEqual(m.lines.map((l) => [l.id, l.naptan]), [
    ['central', '940GZZLUSTD'], ['jubilee', '940GZZLUSTD'], ['elizabeth', '910GSTFD'],
  ]);
  assert.deepEqual(m.naptans.map((n) => [n.id, n.label]), [['940GZZLUSTD', 'Underground'], ['910GSTFD', 'Elizabeth line']]);
});

test('normalizeStatuses keeps the worst severity', () => {
  const s = T.normalizeStatuses([
    { id: 'northern', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }, { statusSeverity: 6, statusSeverityDescription: 'Severe Delays', reason: 'Signal failure' }] },
  ]).get('northern');
  assert.equal(s.cls, 'serious');
  assert.equal(s.description, 'Good Service, Severe Delays');
  assert.deepEqual(s.reasons, ['Signal failure']);
});

test('summarizeArrivals groups by platform and sorts by time', () => {
  const out = T.summarizeArrivals([
    { lineId: 'victoria', platformName: 'Southbound - Platform 6', destinationName: 'Brixton Underground Station', timeToStation: 250 },
    { lineId: 'victoria', platformName: 'Southbound - Platform 6', destinationName: 'Brixton Underground Station', timeToStation: 40 },
    { lineId: 'central', platformName: 'Eastbound - Platform 1', destinationName: 'Epping', timeToStation: 10 },
  ], 'victoria');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].trains.map((t) => [t.destination, t.minutes]), [['Brixton', 1], ['Brixton', 4]]);
});

test('summarizeArrivals tidies rail destinations and puts unconfirmed platforms last', () => {
  const out = T.summarizeArrivals([
    { lineId: 'elizabeth', platformName: 'Platform Unknown', destinationName: 'Paddington Rail Station', timeToStation: 60 },
    { lineId: 'elizabeth', platformName: 'Platform 8', destinationName: 'Shenfield Rail Station', timeToStation: 300 },
  ], 'elizabeth');
  assert.deepEqual(out.map((p) => p.platform), ['Platform 8', 'Platform not yet confirmed']);
  assert.equal(out[1].trains[0].destination, 'Paddington');
});

test('summarizeTrainLoadings finds nested trainLoadings for the line', () => {
  // Shape as returned by /StopPoint/940GZZLUOXC/Crowding/victoria (lines[].crowding.trainLoadings).
  const raw = { naptanId: '940GZZLUOXC', lines: [{ id: 'victoria', crowding: { trainLoadings: [
    { line: 'Victoria', lineDirection: 'NB', platformDirection: 'NB', direction: 'Outbound', naptanTo: '940GZZLUWRR', timeSlice: '0800-0815', value: 4 },
    { line: 'Victoria', lineDirection: 'NB', platformDirection: 'NB', direction: 'Outbound', naptanTo: '940GZZLUWRR', timeSlice: '1400-1415', value: 2 },
    { line: 'Central', lineDirection: 'Eastbound', timeSlice: '1400-1415', value: 5 },
  ] } }] };
  const out = T.summarizeTrainLoadings(raw, { id: 'victoria', name: 'Victoria' }, 14 * 60 + 5);
  assert.deepEqual(out, [{ direction: 'Northbound', relative: 0.5 }]);
});

test('client builds URLs and appends app_key', async () => {
  const seen = [];
  const client = T.createClient({ appKey: 'k', fetch: async (url) => { seen.push(url); return { ok: true, json: async () => ({ dataAvailable: true, percentageOfBaseline: 0.2 }) }; } });
  await client.getLiveCrowding('940GZZLUKSX');
  assert.equal(seen[0], 'https://api.tfl.gov.uk/crowding/940GZZLUKSX/Live?app_key=k');
});

test('client surfaces rate limiting clearly', async () => {
  const client = T.createClient({ fetch: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(client.getArrivals('x'), /rate limit/);
});

test('summarizePassengerFlows sums the unlabelled flows per slice for the requested line', () => {
  // Shape as returned by /StopPoint/940GZZLUOXC/Crowding/central: only the requested line carries flows.
  const raw = { naptanId: '940GZZLUOXC', lines: [
    { id: 'bakerloo', name: 'Bakerloo', crowding: {} },
    { id: 'central', name: 'Central', crowding: { passengerFlows: [
      { timeSlice: '0800-0815', value: 100 }, { timeSlice: '0800-0815', value: 50 },
      { timeSlice: '1745-1800', value: 300 }, { timeSlice: '1745-1800', value: 20 },
      { timeSlice: '0000-0015', value: 5 },
    ] } },
  ] };
  const out = T.summarizePassengerFlows(raw, { id: 'central', name: 'Central' });
  assert.deepEqual(out.bands.map((b) => [b.start, b.value]), [[480, 150], [1065, 320], [0, 5]]);
  assert.deepEqual(out.peak, { start: 1065, value: 320 });
  assert.equal(T.summarizePassengerFlows(raw, { id: 'bakerloo', name: 'Bakerloo' }), null);
  assert.equal(T.summarizePassengerFlows(null, { id: 'central', name: 'Central' }), null);
});

function profile(pairs) {
  return T.normalizeDay({ timeBands: pairs.map(([t, v]) => ({ timeBand: t, percentageOfBaseLine: v })) }, 'MON').bands;
}

test('quieterTimeHint finds the first sustained drop in crowding band', () => {
  const bands = profile([
    ['17:30-17:45', 0.6], ['17:45-18:00', 0.65], ['18:00-18:15', 0.55], // Busy
    ['18:15-18:30', 0.45], ['18:30-18:45', 0.6], // brief dip to Moderately busy, not sustained
    ['18:45-19:00', 0.4], ['19:00-19:15', 0.35],
  ]);
  assert.deepEqual(T.quieterTimeHint(bands, 17 * 60 + 40, null), { kind: 'quieter', start: 18 * 60 + 45, value: 0.4 });
  // The live reading, when present, sets the starting level instead of the typical value.
  assert.deepEqual(T.quieterTimeHint(bands, 17 * 60 + 40, 0.1), { kind: 'busier', start: 17 * 60 + 45, value: 0.65 });
  assert.deepEqual(T.quieterTimeHint(bands, 17 * 60 + 40, 0.3), { kind: 'stays' });
});

test('quieterTimeHint reports busier periods ahead and steady states', () => {
  const bands = profile([['07:00-07:15', 0.1], ['07:15-07:30', 0.2], ['07:30-07:45', 0.55]]);
  assert.deepEqual(T.quieterTimeHint(bands, 7 * 60 + 5, null), { kind: 'busier', start: 7 * 60 + 30, value: 0.55 });
  const steady = profile([['08:00-08:15', 0.9], ['08:15-08:30', 0.9]]);
  assert.deepEqual(T.quieterTimeHint(steady, 8 * 60 + 1, null), { kind: 'stays' });
  assert.equal(T.quieterTimeHint([], 480, 0.5), null);
});

test('liftDisruptionsFor matches hub codes and station NaPTANs', () => {
  // Shape as returned by /Disruptions/Lifts/v2/
  const raw = [
    { stationUniqueId: 'HUBIMP', disruptedLiftUniqueIds: ['HUBIMP-Lift-2'], message: 'Imperial Wharf: No Step Free Access' },
    { stationUniqueId: '940GZZLUWYP', disruptedLiftUniqueIds: ['940GZZLUWYP-Lift-5', '940GZZLUWYP-Lift-6'], message: 'Wembley Park: no lift service' },
  ];
  assert.deepEqual(T.liftDisruptionsFor(raw, ['HUBWYP', '940GZZLUWYP']), [{ station: '940GZZLUWYP', lifts: 2, message: 'Wembley Park: no lift service' }]);
  assert.equal(T.liftDisruptionsFor(raw, ['HUBIMP']).length, 1);
  assert.deepEqual(T.liftDisruptionsFor(raw, ['940GZZLUOXC']), []);
  assert.deepEqual(T.liftDisruptionsFor({ message: 'error' }, ['HUBIMP']), []);
});

// ---------------------------------------------------------------------------
// Boarding estimate
// ---------------------------------------------------------------------------

// Shape of /Line/waterloo-city/Route/Sequence/all (trimmed): two stations, one route each way.
const WC_ROUTE = {
  orderedLineRoutes: [
    { name: 'Bank  &harr;  Waterloo ', naptanIds: ['940GZZLUBNK', '940GZZLUWLO'] },
    { name: 'Waterloo  &harr;  Bank ', naptanIds: ['940GZZLUWLO', '940GZZLUBNK'] },
  ],
  stopPointSequences: [{ stopPoint: [
    { id: '940GZZLUBNK', stationId: '940GZZLUBNK', name: 'Bank Underground Station' },
    { id: '940GZZLUWLO', stationId: '940GZZLUWLO', name: 'Waterloo Underground Station' },
  ] }],
  stations: [{ id: 'HUBBAN', name: 'Bank' }, { id: 'HUBWAT', name: 'Waterloo' }],
};

// Shape of /StopPoint/940GZZLUBNK/Crowding/waterloo-city (trimmed): Bank → Waterloo is full at 17:45.
const WC_BANK = { lines: [{ id: 'waterloo-city', name: 'Waterloo & City', crowding: { trainLoadings: [
  { line: 'Waterloo & City', lineDirection: 'WB', platformDirection: 'WB', direction: 'Inbound', naptanTo: '940GZZLUWLO', timeSlice: '0815-0830', value: 1 },
  { line: 'Waterloo & City', lineDirection: 'WB', platformDirection: 'WB', direction: 'Inbound', naptanTo: '940GZZLUWLO', timeSlice: '1745-1800', value: 6 },
] } }] };

test('previousStations: Waterloo & City starts at Waterloo eastbound, so trains arrive empty', () => {
  // Boarding at Waterloo towards Bank: nothing precedes Waterloo in that direction.
  assert.deepEqual(T.previousStations(WC_ROUTE, '940GZZLUWLO', '940GZZLUBNK'), { matched: true, origin: true, prev: [] });
  // Same at Bank towards Waterloo.
  assert.deepEqual(T.previousStations(WC_ROUTE, '940GZZLUBNK', '940GZZLUWLO'), { matched: true, origin: true, prev: [] });
  // The Bank → Waterloo row is full at 17:45, but it's the westbound train everyone leaves at Waterloo;
  // it must not count as the arriving load for eastbound boarders.
  const rows = T.loadingRows(WC_BANK, { id: 'waterloo-city', name: 'Waterloo & City' });
  assert.equal(T.loadingAt(rows.filter((r) => r.to === '940GZZLUWLO'), 17 * 60 + 50), 6);
});

test('previousStations finds the station before on a through route', () => {
  const route = { orderedLineRoutes: [
    { naptanIds: ['940GZZLUBXN', '940GZZLUGPK', '940GZZLUOXC', '940GZZLUWRR'] },
    { naptanIds: ['940GZZLUWRR', '940GZZLUOXC', '940GZZLUGPK', '940GZZLUBXN'] },
  ] };
  assert.deepEqual(T.previousStations(route, '940GZZLUOXC', '940GZZLUWRR'), { matched: true, origin: false, prev: ['940GZZLUGPK'] });
  assert.deepEqual(T.previousStations(route, '940GZZLUOXC', '940GZZLUGPK'), { matched: true, origin: false, prev: ['940GZZLUWRR'] });
  assert.equal(T.previousStations(route, '940GZZLUOXC', '940GZZLUXXX').matched, false);
});

test('routeStationNames reads NaPTAN names from stopPointSequences, not hub ids', () => {
  const names = T.routeStationNames(WC_ROUTE);
  assert.equal(names.get('940GZZLUWLO'), 'Waterloo');
  assert.equal(names.get('940GZZLUBNK'), 'Bank');
});

test('loadingRows and loadingAt pick the slice for a direction', () => {
  const rows = T.loadingRows(WC_BANK, { id: 'waterloo-city', name: 'Waterloo & City' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { dir: 'WB', to: '940GZZLUWLO', start: 8 * 60 + 15, value: 1 });
  assert.equal(T.loadingAt(rows, 8 * 60 + 20), 1);
  assert.equal(T.loadingAt(rows, 12 * 60), null);
});

test('boardingEstimate: empty arriving train at Waterloo boards first time at a normal 08:15', () => {
  // Real W&C Waterloo eastbound at 08:15: leaves 4/6 full, starts at Waterloo.
  const e = T.boardingEstimate({ depart: 4, arrive: null, origin: true, liveFactor: 1, serviceFactor: 1 });
  assert.equal(e.band.key, 'board');
  assert.equal(e.roomPct, 100);
  assert.equal(e.arrivePct, 0);
  assert.equal(e.trainsToLetGo, 0);
  // 50% busier than usual: now tight.
  assert.equal(T.boardingEstimate({ depart: 4, origin: true, liveFactor: 1.5 }).band.key, 'tight');
});

test('boardingEstimate: full departures plus a busier station means letting trains go', () => {
  // Real W&C Bank westbound at 17:45 leaves 6/6 (full).
  const normal = T.boardingEstimate({ depart: 6, origin: true, liveFactor: 1, serviceFactor: 1 });
  assert.equal(normal.saturated, true);
  assert.equal(normal.band.key, 'tight');
  const busy = T.boardingEstimate({ depart: 6, origin: true, liveFactor: 1.3, serviceFactor: 1 });
  assert.equal(busy.band.key, 'wait1');
  assert.equal(busy.trainsToLetGo, 1);
  const disrupted = T.boardingEstimate({ depart: 6, origin: true, liveFactor: 1.4, serviceFactor: 1.5 });
  assert.equal(disrupted.band.key, 'wait2');
  assert.equal(disrupted.trainsToLetGo, 2);
});

test('boardingEstimate: trains arriving full leave little room at a through station', () => {
  // Real Central westbound at Liverpool Street 08:15: arrives 6/6 from Bethnal Green, leaves 6/6.
  const e = T.boardingEstimate({ depart: 6, arrive: 6, origin: false, liveFactor: 1, serviceFactor: 1 });
  assert.equal(e.roomPct, 30);
  assert.equal(e.band.key, 'tight');
  // Real Victoria northbound at Oxford Circus 08:15: arrives 4, leaves 2 — still some boarders.
  const v = T.boardingEstimate({ depart: 2, arrive: 4, origin: false, liveFactor: 1, serviceFactor: 1 });
  assert.equal(v.band.key, 'board');
  assert.ok(v.ratio > 0);
  // No typical data for this slice: no estimate.
  assert.equal(T.boardingEstimate({ depart: null, origin: true }), null);
});
