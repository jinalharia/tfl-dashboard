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

// ---------------------------------------------------------------------------
// Station information (package A)
// ---------------------------------------------------------------------------

const fac = (key, value) => ({ category: 'Facility', key, sourceSystemKey: 'StaticObjects', value });
const np = (value) => ({ category: 'NearestPlaces', key: 'SourceSystemPlaceId', sourceSystemKey: 'StaticObjects', value });

// Trimmed from GET /StopPoint/HUBSRA (2026-09-27): the hub and its three station children list
// identical Facility values; each child lists its own NearestPlaces.
const STRATFORD_FACILITIES = [
  fac('Help Points', '0 on platforms, 0 in ticket halls, 0 elsewhere'), fac('Ticket Halls', '2'), fac('Payphones', '8'),
  fac('Cash Machines', '4'), fac('Lifts', '5'), fac('Toilets', 'yes'), fac('WiFi', 'yes'), fac('Escalators', '2'), fac('Photo Booths', '0'),
];
const STRATFORD_HUB = {
  naptanId: 'HUBSRA', commonName: 'Stratford', stopType: 'TransportInterchange',
  modes: ['bus', 'dlr', 'elizabeth-line', 'international-rail', 'national-rail', 'overground', 'tube'],
  additionalProperties: [...STRATFORD_FACILITIES, { category: 'Address', key: 'PhoneNo', value: '0845 330 9880' }, np('BikePoints_790'), np('TaxiRank_5944')],
  children: [
    { naptanId: '910GSTFD', commonName: 'Stratford (London) Rail Station', modes: ['elizabeth-line', 'national-rail', 'overground'],
      additionalProperties: [...STRATFORD_FACILITIES, { category: 'Address', key: 'PhoneNo', value: '0845 330 9880' }, np('BikePoints_785'), np('BikePoints_790'), np('TaxiRank_5944')], children: [] },
    { naptanId: '940GZZDLSTD', commonName: 'Stratford DLR Station', modes: ['dlr'],
      additionalProperties: [...STRATFORD_FACILITIES, { category: 'Address', key: 'PhoneNo', value: '0845 330 9880' }, np('BikePoints_785'), np('BikePoints_790')], children: [] },
    { naptanId: '940GZZLUSTD', commonName: 'Stratford Underground Station', modes: ['tube'],
      additionalProperties: [...STRATFORD_FACILITIES, { category: 'Address', key: 'PhoneNo', value: '0845 330 9880' }, np('BikePoints_785'), np('BikePoints_790')],
      children: [{ naptanId: '9400ZZLUSTD1', stopType: 'NaptanMetroPlatform', additionalProperties: [], children: [] }] },
  ],
};

// Trimmed from GET /StopPoint/940GZZLUKSX (2026-09-27), which returns the HUBKGX hub: the Underground
// station and two National Rail stations each have their own values ("Help points" in lower case there).
const KINGS_CROSS_HUB = {
  naptanId: 'HUBKGX', commonName: "King's Cross & St Pancras International", modes: ['bus', 'international-rail', 'national-rail', 'tube'],
  additionalProperties: [fac('Lifts', '10'), np('BikePoints_4'), np('BikePoints_14'), np('BikePoints_34')],
  children: [
    { naptanId: '910GKNGX', commonName: "London King's Cross Rail Station", modes: ['national-rail'],
      additionalProperties: [fac('Cash Machines', 'yes'), fac('Help points', 'yes'), fac('Ticket Halls', 'yes'), fac('Toilets', 'yes'), fac('WiFi', 'yes'), { category: 'Address', key: 'PhoneNo', value: '0330 024 0215' }], children: [] },
    { naptanId: '910GSTPX', commonName: 'London St Pancras International Rail Station', modes: ['national-rail'], additionalProperties: [{ category: 'Geo', key: 'Zone', value: '1' }], children: [] },
    { naptanId: '940GZZLUKSX', commonName: "King's Cross St. Pancras Underground Station", modes: ['tube'],
      additionalProperties: [
        fac('Toilets', 'no'), fac('Cash Machines', '9'), fac('Ticket Halls', '4'), fac('Lifts', '10'), fac('WiFi', 'yes'),
        fac('Help Points', '0 on platforms, 0 in ticket halls, 0 elsewhere'), fac('Escalators', '19'), fac('Payphones', '4'),
        { category: 'VisitorCentre', key: 'Location', value: 'Western Ticket Hall Underground Station' },
        { category: 'Address', key: 'PhoneNo', value: '0845 330 9880' },
        np('BikePoints_4'), np('BikePoints_14'), np('BikePoints_70'), np('TaxiRank_5237'),
      ], children: [] },
  ],
};

test('stationFacilities labels hub children by network and keeps the facilities we show', () => {
  const groups = T.stationFacilities(KINGS_CROSS_HUB);
  assert.equal(groups.length, 2);
  const [tube, rail] = groups;
  assert.equal(tube.label, 'Underground');
  assert.deepEqual(tube.ids, ['940GZZLUKSX']);
  assert.deepEqual(tube.items.map((i) => [i.label, i.value]), [
    ['Lifts', '10'], ['Escalators', '19'], ['Toilets', 'No'], ['Wi-Fi', 'Yes'], ['Cash machines', '9'], ['Ticket halls', '4'], ['Help points', 'None listed'],
  ]);
  assert.equal(tube.visitorCentre, 'Western Ticket Hall Underground Station');
  assert.equal(tube.phone, '0845 330 9880');
  // Payphones and photo booths are skipped.
  assert.ok(!tube.items.some((i) => /pay|photo/i.test(i.label)));
  assert.equal(rail.label, 'National Rail');
  assert.deepEqual(rail.names, ["London King's Cross Rail Station"]);
  // "Help points" (lower-case p) from the National Rail data is matched too.
  assert.equal(rail.items.find((i) => i.key === 'help points').value, 'Yes');
});

test('stationFacilities merges children with identical values (Stratford)', () => {
  const groups = T.stationFacilities(STRATFORD_HUB);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids, ['910GSTFD', '940GZZDLSTD', '940GZZLUSTD']);
  assert.equal(groups[0].label, 'Underground, Elizabeth line, DLR, Overground & National Rail');
  assert.equal(groups[0].items.find((i) => i.key === 'lifts').value, '5');
  assert.equal(groups[0].items.find((i) => i.key === 'toilets').kind, 'yes');
});

test('stationFacilities uses the stop itself when it is a single station, and copes with nothing', () => {
  // Trimmed from GET /StopPoint/940GZZLUOXC (2026-09-27).
  const oxc = { naptanId: '940GZZLUOXC', commonName: 'Oxford Circus Underground Station', modes: ['tube'],
    additionalProperties: [fac('Lifts', '0'), fac('Help Points', '18 on platforms, 0 in ticket halls, 18 elsewhere'), fac('Toilets', 'no')], children: [] };
  const [g] = T.stationFacilities(oxc);
  assert.equal(g.label, 'Underground');
  assert.deepEqual(g.items.map((i) => i.value), ['0', 'No', '18 on platforms, 0 in ticket halls, 18 elsewhere']);
  assert.deepEqual(T.stationFacilities({ naptanId: 'X', additionalProperties: [], children: [] }), []);
  assert.deepEqual(T.stationFacilities(null), []);
});

test('facilityValue', () => {
  assert.deepEqual(T.facilityValue('yes'), { value: 'Yes', kind: 'yes' });
  assert.deepEqual(T.facilityValue('NO'), { value: 'No', kind: 'no' });
  assert.deepEqual(T.facilityValue('07'), { value: '7', kind: 'count' });
  assert.equal(T.facilityValue('0 on platforms, 0 in ticket halls, 0 elsewhere').kind, 'none');
});

test('nearbyBikePointIds collects BikePoints from the stop and its children, without taxis or repeats', () => {
  assert.deepEqual(T.nearbyBikePointIds(KINGS_CROSS_HUB), ['BikePoints_4', 'BikePoints_14', 'BikePoints_34', 'BikePoints_70']);
  assert.deepEqual(T.nearbyBikePointIds(STRATFORD_HUB), ['BikePoints_790', 'BikePoints_785']);
  assert.deepEqual(T.nearbyBikePointIds({}), []);
});

test('nearestBikePoints ranks docks by distance and keeps bike and dock counts', () => {
  // GET /Occupancy/BikePoints/BikePoints_4,BikePoints_14,BikePoints_34,BikePoints_70 (2026-09-27)
  const occupancy = [
    { id: 'BikePoints_4', name: "St. Chad's Street, King's Cross", bikesCount: 12, emptyDocks: 8, totalDocks: 23, standardBikesCount: 11, eBikesCount: 1 },
    { id: 'BikePoints_14', name: 'Argyle Street, Kings Cross', bikesCount: 4, emptyDocks: 38, totalDocks: 45, standardBikesCount: 4, eBikesCount: 0 },
    { id: 'BikePoints_34', name: "Pancras Road, King's Cross", bikesCount: 7, emptyDocks: 4, totalDocks: 16, standardBikesCount: 7, eBikesCount: 0 },
    { id: 'BikePoints_70', name: "Calshot Street , King's Cross", bikesCount: 4, emptyDocks: 19, totalDocks: 24, standardBikesCount: 3, eBikesCount: 1 },
  ];
  // GET /Place?type=BikePoint&lat=51.531683&lon=-0.123538&radius=800 (2026-09-27), trimmed; BikePoints_34 left out.
  const places = { centrePoint: [51.531, -0.123], places: [
    { id: 'BikePoints_70', commonName: "Calshot Street , King's Cross", distance: 413.2, placeType: 'BikePoint', lat: 51.5, lon: -0.1 },
    { id: 'BikePoints_4', commonName: "St. Chad's Street, King's Cross", distance: 175.4, placeType: 'BikePoint', lat: 51.53, lon: -0.12 },
    { id: 'BikePoints_14', commonName: 'Argyle Street, Kings Cross', distance: 188.1, placeType: 'BikePoint', lat: 51.53, lon: -0.12 },
  ] };
  const docks = T.nearestBikePoints(occupancy, places, 3);
  assert.deepEqual(docks.map((d) => d.id), ['BikePoints_4', 'BikePoints_14', 'BikePoints_70']);
  assert.deepEqual(docks[0], { id: 'BikePoints_4', name: "St. Chad's Street, King's Cross", bikes: 12, standardBikes: 11, eBikes: 1, emptyDocks: 8, totalDocks: 23, distance: 175 });
  assert.equal(docks[2].name, "Calshot Street, King's Cross");
  // Without distances, the listed order is kept.
  assert.deepEqual(T.nearestBikePoints(occupancy, null, 5).map((d) => d.id), ['BikePoints_4', 'BikePoints_14', 'BikePoints_34', 'BikePoints_70']);
  assert.equal(T.nearestBikePoints(occupancy, null, 5)[0].distance, null);
  assert.deepEqual(T.nearestBikePoints(null, null), []);
});

test('normalizeStationDisruptions removes exact duplicates and ended notices', () => {
  const mildmay = 'MILDMAY LINE: Sunday 27 September, after 2215, no service between Camden Road and Stratford.';
  // GET /StopPoint/HUBSRA/Disruption?getFamily=true&flattenResponse=true (2026-09-27), descriptions shortened:
  // the Mildmay notice came back once per mode.
  const raw = ['elizabeth-line', 'national-rail', 'overground'].map((mode) => ({
    atcoCode: '910GSTFD', fromDate: '2026-09-27T21:15:00Z', toDate: '2026-09-28T00:29:00Z', description: mildmay,
    commonName: 'Stratford (London) Rail Station', type: 'Part Closure', mode, stationAtcoCode: '910GSTFD', appearance: 'PlannedWork',
  }));
  raw.push({
    atcoCode: '940GZZLUSTD', fromDate: '2026-09-26T03:32:00Z', toDate: '2026-09-28T00:29:00Z',
    description: 'CENTRAL LINE: Saturday 26 September & Sunday 27 September, no service between Liverpool Street and Woodford / Newbury Park.',
    commonName: 'Stratford Underground Station', type: 'Part Closure', mode: 'tube', stationAtcoCode: '940GZZLUSTD', appearance: 'PlannedWork',
    additionalInformation: 'Replacement bus services operate:Service CL4: Day Service Only',
  });
  raw.push({ atcoCode: '940GZZLUSTD', fromDate: '2026-09-01T00:00:00Z', toDate: '2026-09-02T00:00:00Z', description: 'Old notice', mode: 'tube' });

  const notices = T.normalizeStationDisruptions(raw, new Date('2026-09-27T10:00:00Z'));
  assert.equal(notices.length, 2);
  // Notices in force come first, then upcoming ones.
  const [central, mild] = notices;
  assert.equal(central.upcoming, false);
  assert.equal(central.additionalInformation, 'Replacement bus services operate:Service CL4: Day Service Only');
  assert.deepEqual(central.stations, [{ id: '940GZZLUSTD', name: 'Stratford Underground Station' }]);
  assert.equal(mild.upcoming, true);
  assert.equal(mild.type, 'Part Closure');
  assert.equal(mild.appearance, 'PlannedWork');
  assert.deepEqual(mild.modes, ['elizabeth-line', 'national-rail', 'overground']);
  assert.equal(mild.stations.length, 1);
  assert.deepEqual(T.normalizeStationDisruptions([], new Date()), []);
  assert.deepEqual(T.normalizeStationDisruptions(null), []);
});

test('getStation keeps the raw stop, and station disruptions ask for one id with getFamily', async () => {
  const seen = [];
  const client = T.createClient({ fetch: async (url) => {
    seen.push(url);
    if (url.includes('/Disruption')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ naptanId: '940GZZLUOXC', commonName: 'Oxford Circus', lines: [{ id: 'victoria', name: 'Victoria' }],
      lineGroup: [{ stationAtcoCode: '940GZZLUOXC', lineIdentifier: ['victoria'] }], lineModeGroups: [{ modeName: 'tube', lineIdentifier: ['victoria'] }], additionalProperties: [], children: [] }) };
  } });
  const station = await client.getStation('940GZZLUOXC');
  assert.equal(station.stop.naptanId, '940GZZLUOXC');
  assert.equal(station.lines[0].id, 'victoria');
  await client.getStationDisruptions('HUBSRA');
  assert.equal(seen[1], 'https://api.tfl.gov.uk/StopPoint/HUBSRA/Disruption?getFamily=true&flattenResponse=true');
  await client.getBikeOccupancy(['BikePoints_4', 'BikePoints_14']);
  assert.equal(seen[2], 'https://api.tfl.gov.uk/Occupancy/BikePoints/BikePoints_4,BikePoints_14');
});

// ---------------------------------------------------------------------------
// Network status (Package B)
// ---------------------------------------------------------------------------

// Trimmed from GET /Line/Mode/tube,elizabeth-line,dlr,overground,tram/Status on 2026-09-27 (20 lines returned).
const NETWORK_STATUS = [
  { id: 'bakerloo', name: 'Bakerloo', modeName: 'tube', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service', validityPeriods: [] }] },
  { id: 'central', name: 'Central', modeName: 'tube', lineStatuses: [{ statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'CENTRAL LINE: Saturday 26 September & Sunday 27 September, no service (including Saturday Night Tube) between Liverpool Street and Woodford / Newbury Park.', validityPeriods: [{ fromDate: '2026-09-26T03:32:00Z', toDate: '2026-09-28T00:29:00Z', isNow: false }] }] },
  { id: 'district', name: 'District', modeName: 'tube', lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays', reason: "District Line: Minor delays between Earl's Court and Wimbledon due to train cancellations.", validityPeriods: [{ fromDate: '2026-09-27T05:45:59Z', toDate: '2026-09-28T00:29:00Z', isNow: true }] }] },
  { id: 'dlr', name: 'DLR', modeName: 'dlr', lineStatuses: [{ statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'DOCKLANDS LIGHT RAILWAY: Sunday 27 September, no service between Shadwell and Tower Gateway.' }] },
  { id: 'elizabeth', name: 'Elizabeth line', modeName: 'elizabeth-line', lineStatuses: [{ statusSeverity: 5, statusSeverityDescription: 'Part Closure' }] },
  { id: 'liberty', name: 'Liberty', modeName: 'overground', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] },
  { id: 'tram', name: 'Tram', modeName: 'tram', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] },
  { id: 'waterloo-city', name: 'Waterloo & City', modeName: 'tube', lineStatuses: [{ statusSeverity: 4, statusSeverityDescription: 'Planned Closure', reason: 'Waterloo & City line: service operates 06:00 until 00:30, Monday to Friday only.' }] },
];

test('networkStatusList puts the worst status first, then by mode (Underground first) and name', () => {
  const list = T.networkStatusList(NETWORK_STATUS);
  assert.deepEqual(list.map((l) => l.id), ['waterloo-city', 'central', 'elizabeth', 'dlr', 'district', 'bakerloo', 'liberty', 'tram']);
  const wc = list[0];
  assert.equal(wc.cls, 'critical');
  assert.equal(wc.description, 'Planned Closure');
  assert.equal(wc.mode, 'tube');
  assert.equal(wc.colour, '#95CDBA');
  assert.equal(list.find((l) => l.id === 'district').cls, 'warning');
  assert.equal(list.find((l) => l.id === 'liberty').colour, '#5D6061');
  assert.deepEqual(list.find((l) => l.id === 'bakerloo').reasons, []);
});

test('networkStatusList tolerates junk and repeated lines', () => {
  assert.deepEqual(T.networkStatusList(null), []);
  assert.deepEqual(T.networkStatusList({ message: 'error' }), []);
  const list = T.networkStatusList([null, NETWORK_STATUS[0], NETWORK_STATUS[0], { id: 'x', lineStatuses: [] }]);
  assert.deepEqual(list.map((l) => [l.id, l.cls]), [['x', 'info'], ['bakerloo', 'good']]);
});

test('closureDateRange uses the London calendar date and spans 14 days by default', () => {
  // 23:30 UTC on 26 Sep is 00:30 BST on 27 Sep in London.
  assert.deepEqual(T.closureDateRange(new Date('2026-09-26T23:30:00Z')), { start: '2026-09-27', end: '2026-10-11' });
  assert.deepEqual(T.closureDateRange(new Date('2026-12-25T12:00:00Z'), 14), { start: '2026-12-25', end: '2027-01-08' });
  assert.deepEqual(T.closureDateRange(new Date('2026-10-20T12:00:00Z'), 3), { start: '2026-10-20', end: '2026-10-23' });
});

// Trimmed from GET /Line/central,jubilee,elizabeth,dlr,mildmay,victoria,bakerloo/Status/2026-09-27/to/2026-10-11 on 2026-09-27.
const planned = (description) => ({ category: 'PlannedWork', categoryDescription: 'PlannedWork', description });
const RANGE_STATUS = [
  { id: 'bakerloo', name: 'Bakerloo', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service', validityPeriods: [] }] },
  { id: 'central', name: 'Central', lineStatuses: [{ lineId: 'central', statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'CENTRAL LINE: Saturday 26 September & Sunday 27 September, no service between Liverpool Street and Woodford / Newbury Park.', validityPeriods: [{ fromDate: '2026-09-26T03:32:00Z', toDate: '2026-09-28T00:29:00Z', isNow: false }], disruption: planned('CENTRAL LINE: …') }] },
  { id: 'dlr', name: 'DLR', lineStatuses: [
    { lineId: 'dlr', statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'DOCKLANDS LIGHT RAILWAY: Saturday 10 and Sunday 11 October, no service between Stratford International and Woolwich Arsenal.', validityPeriods: [{ fromDate: '2026-10-10T03:30:00Z', toDate: '2026-10-12T00:29:00Z', isNow: false }], disruption: planned('') },
    { lineId: 'dlr', statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'DOCKLANDS LIGHT RAILWAY: Sunday 4 October, no service between Shadwell and Tower Gateway.', validityPeriods: [{ fromDate: '2026-10-04T03:30:00Z', toDate: '2026-10-05T00:29:00Z', isNow: false }], disruption: planned('') },
    { lineId: 'dlr', statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'DOCKLANDS LIGHT RAILWAY: Sunday 4 October, no service between Shadwell and Tower Gateway.', validityPeriods: [{ fromDate: '2026-10-04T03:30:00Z', toDate: '2026-10-05T00:29:00Z', isNow: false }], disruption: planned('') },
  ] },
  { id: 'elizabeth', name: 'Elizabeth line', lineStatuses: [
    { lineId: 'elizabeth', statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'ELIZABETH LINE: Sunday 27 September, between 0120 and 0800, no service between West Drayton and Maidenhead.', validityPeriods: [{ fromDate: '2026-09-27T00:20:00Z', toDate: '2026-09-27T07:00:00Z', isNow: false }], disruption: planned('') },
    { lineId: 'elizabeth', statusSeverity: 7, statusSeverityDescription: 'Reduced Service', reason: 'ELIZABETH LINE: Sunday 27 September, from 0800, a reduced service operates between Paddington and Heathrow Terminal 4 / 5.', validityPeriods: [{ fromDate: '2026-09-27T07:00:00Z', toDate: '2026-09-28T00:29:00Z', isNow: false }], disruption: planned('') },
  ] },
  { id: 'jubilee', name: 'Jubilee', lineStatuses: [{ lineId: 'jubilee', statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'JUBILEE LINE: Saturday 3 October, between 0130 and 0430, no service between Finchley Road and Stratford.', validityPeriods: [{ fromDate: '2026-10-03T00:30:00Z', toDate: '2026-10-03T03:30:00Z', isNow: false }], disruption: planned('') }] },
  { id: 'victoria', name: 'Victoria', lineStatuses: [{ lineId: 'victoria', statusSeverity: 9, statusSeverityDescription: 'Minor Delays', reason: 'Victoria Line: Minor delays due to train cancellations.', validityPeriods: [{ fromDate: '2026-09-27T01:23:19Z', toDate: '2026-09-28T00:29:00Z', isNow: true }], disruption: { category: 'RealTime', description: '' } }] },
];

test('upcomingClosures keeps upcoming and ongoing planned works, soonest first', () => {
  const now = new Date('2026-09-27T08:00:00Z');
  const list = T.upcomingClosures(RANGE_STATUS, now);
  assert.deepEqual(
    list.map((c) => [c.lineId, c.from.slice(0, 10), c.current]),
    [
      ['central', '2026-09-26', true], // ongoing planned work
      ['elizabeth', '2026-09-27', true], // reduced service from 08:00 BST, still planned
      ['jubilee', '2026-10-03', false],
      ['dlr', '2026-10-04', false], // TfL repeated this entry; merged
      ['dlr', '2026-10-10', false],
    ]
  );
  // Dropped: Good Service, the Elizabeth line closure that ended at 07:00Z, and the live Victoria delays.
  const jub = list.find((c) => c.lineId === 'jubilee');
  assert.equal(jub.description, 'Part Closure');
  assert.equal(jub.cls, 'serious');
  assert.equal(jub.planned, true);
  assert.equal(jub.colour, '#A0A5A9');
  assert.equal(jub.to, '2026-10-03T03:30:00.000Z');
  assert.match(jub.reason, /Finchley Road and Stratford/);
});

test('upcomingClosures keeps a future unplanned entry but not one already running', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  const list = T.upcomingClosures(RANGE_STATUS, now);
  // Before 01:23Z the Victoria delays hadn't started, so they count as upcoming.
  assert.ok(list.some((c) => c.lineId === 'victoria' && !c.planned && !c.current));
  assert.ok(list.some((c) => c.lineId === 'elizabeth' && c.description === 'Part Closure'));
  assert.deepEqual(T.upcomingClosures(null, now), []);
  assert.deepEqual(T.upcomingClosures([{ id: 'x', lineStatuses: [{ statusSeverity: 5, validityPeriods: [{ fromDate: 'nonsense' }] }] }], now), []);
});

test('upcomingClosures treats zone-less timestamps as UTC', () => {
  const raw = [{ id: 'jubilee', name: 'Jubilee', lineStatuses: [{ statusSeverity: 5, statusSeverityDescription: 'Part Closure', validityPeriods: [{ fromDate: '2026-10-03T00:30:00', toDate: '2026-10-03T03:30:00' }] }] }];
  assert.equal(T.upcomingClosures(raw, new Date('2026-09-27T08:00:00Z'))[0].from, '2026-10-03T00:30:00.000Z');
});

test('formatPeriod shows London time and collapses same-day periods', () => {
  assert.equal(T.formatPeriod('2026-10-03T00:30:00.000Z', '2026-10-03T03:30:00.000Z'), 'Sat 3 Oct 01:30–04:30');
  assert.equal(T.formatPeriod('2026-10-04T03:30:00.000Z', '2026-10-05T00:29:00.000Z'), 'Sun 4 Oct 04:30 – Mon 5 Oct 01:29');
  // After the clocks go back (25 Oct 2026), London is on GMT.
  assert.equal(T.formatPeriod('2026-11-01T09:00:00.000Z', null), 'From Sun 1 Nov 09:00');
});
