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
