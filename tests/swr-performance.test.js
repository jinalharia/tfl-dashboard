const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/swr-performance.js');

// ---------------------------------------------------------------------------
// Fixtures: real responses, plan texts trimmed where noted.
// ---------------------------------------------------------------------------

const PLANS = {
  Next3MonthPlan: 'Preparation & delivery for Autumn 2026 season and Winter planning - responsible for delivery: Mark Goodall',
  NextYearPlan: 'Increase usage of bodyworn cameras to deter antisocial behaviour - responsible for delivery: Stuart Meek',
  LongTermPlan: 'Proactive maintenance to reduce coupling equipment and door faults - responsible for delivery: Stuart Meek',
};
const TARGET_ROW = { Id: 194, StationName: 'Wessex route target', CRSCode: '', TOC: '', Punctal: '86.12', Cancelled: '3.68' };

// GET https://www.southwesternrailway.com/api/stationperformance/Surbiton?skip=0&take=10 (2026-09-27, complete)
const SURBITON = {
  TotalResults: 2,
  Items: [
    { Id: 177, StationName: 'Surbiton', CRSCode: 'SUR', TOC: 'SWR', Punctal: '85.00', Cancelled: '3.90' },
    TARGET_ROW,
  ],
  Period: '4-Week Period from 26 July to 22 August',
  ...PLANS,
  WessexRouteData: '',
};

// GET https://www.southwesternrailway.com/api/stationperformance/London%20Waterloo?skip=0&take=10 (2026-09-28, plans as above)
const WATERLOO = {
  TotalResults: 2,
  Items: [{ Id: 117, StationName: 'London Waterloo', CRSCode: 'WAT', TOC: 'SWR', Punctal: '82.60', Cancelled: '2.40' }, TARGET_ROW],
  Period: '4-Week Period from 26 July to 22 August',
  ...PLANS,
  WessexRouteData: '',
};

// GET https://www.southwesternrailway.com/api/stationperformance/Clapham%20Junction?skip=0&take=10 (2026-09-28): one row per operator
const CLAPHAM = {
  TotalResults: 4,
  Items: [
    { Id: 47, StationName: 'Clapham Junction', CRSCode: 'CLJ', TOC: 'Arriva London', Punctal: '90.40', Cancelled: '16.20' },
    { Id: 48, StationName: 'Clapham Junction', CRSCode: 'CLJ', TOC: 'GTR', Punctal: '79.80', Cancelled: '4.30' },
    { Id: 49, StationName: 'Clapham Junction', CRSCode: 'CLJ', TOC: 'SWR', Punctal: '84.60', Cancelled: '4.10' },
    TARGET_ROW,
  ],
  Period: '4-Week Period from 26 July to 22 August',
  ...PLANS,
  WessexRouteData: '',
};

// GET https://www.southwesternrailway.com/api/stationperformance/Berrylands?skip=0&take=10 (2026-09-28): a blank, all-zero row
const BERRYLANDS = {
  TotalResults: 2,
  Items: [{ Id: 21, StationName: 'Berrylands', CRSCode: 'BRS', TOC: 'SWR', Punctal: '0.00', Cancelled: '0.00' }, TARGET_ROW],
  Period: '4-Week Period from 26 July to 22 August',
  ...PLANS,
  WessexRouteData: '',
};

// data/swr/performance.json as package S7 writes it (plan.md "Snapshot file formats")
const SNAPSHOT = {
  fetchedAt: '2026-09-28T05:17:42.000Z',
  period: '4-Week Period from 26 July to 22 August',
  target: { punctual: '86.12', cancelled: '3.68' },
  stations: { SUR: SURBITON, WAT: WATERLOO, CLJ: CLAPHAM, BRS: BERRYLANDS },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const NOW = new Date('2026-09-28T09:00:00Z');

// ---------------------------------------------------------------------------
// parsePercent
// ---------------------------------------------------------------------------

test('parsePercent reads the API strings and rejects odd values', () => {
  assert.equal(P.parsePercent('85.00'), 85);
  assert.equal(P.parsePercent('3.90'), 3.9);
  assert.equal(P.parsePercent(' 86.12 % '), 86.12);
  assert.equal(P.parsePercent(82.6), 82.6);
  assert.equal(P.parsePercent('0.00'), 0);
  assert.equal(P.parsePercent('100'), 100);
  for (const bad of [null, undefined, '', '  ', 'n/a', 'NaN', '85,00', '1e2', '101', '-1', true, {}, []]) {
    assert.equal(P.parsePercent(bad), null, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------
// Rows and target
// ---------------------------------------------------------------------------

test('isTargetRow picks out the "Wessex route target" row', () => {
  assert.equal(P.isTargetRow(TARGET_ROW), true);
  assert.equal(P.isTargetRow(SURBITON.Items[0]), false);
  assert.equal(P.isTargetRow({ StationName: 'Target', CRSCode: '' }), true);
  assert.equal(P.isTargetRow(null), false);
});

test('pickStationRows prefers the SWR row and lists other operators', () => {
  const { row, others } = P.pickStationRows(CLAPHAM.Items, 'clj');
  assert.equal(row.TOC, 'SWR');
  assert.deepEqual(others.map((o) => o.TOC), ['Arriva London', 'GTR']);
  assert.equal(P.pickStationRows(SURBITON.Items, 'WAT').row, null, 'a row for another station is not used');
  assert.equal(P.pickStationRows([TARGET_ROW], 'SUR').row, null);
  assert.equal(P.pickStationRows(undefined, 'SUR').row, null);
  // Without a CRS, the first non-target row.
  assert.equal(P.pickStationRows(SURBITON.Items).row.CRSCode, 'SUR');
});

test('periodText tidies SWR\'s period', () => {
  assert.equal(P.periodText('4-Week Period from 26 July to 22 August'), '4-week period from 26 July to 22 August');
  assert.equal(P.periodText('  4 Week  Period from 23 August to 19 September '), '4-week period from 23 August to 19 September');
  assert.equal(P.periodText(''), null);
  assert.equal(P.periodText(null), null);
});

// ---------------------------------------------------------------------------
// performanceSummary
// ---------------------------------------------------------------------------

test('performanceSummary: Surbiton, worse than target on both', () => {
  const s = P.performanceSummary(SURBITON, SNAPSHOT.target, 'SUR');
  assert.equal(s.hasData, true);
  assert.equal(s.reason, null);
  assert.deepEqual(s.station, { name: 'Surbiton', crs: 'SUR', toc: 'SWR' });
  assert.deepEqual(s.punctual, { value: 85, target: 86.12, diff: -1.1, verdict: 'worse', cls: 'warning' });
  // Cancellations: 3.90 against 3.68 is more cancelled, so worse.
  assert.deepEqual(s.cancelled, { value: 3.9, target: 3.68, diff: 0.2, verdict: 'worse', cls: 'warning' });
  assert.equal(s.targetSource, 'snapshot');
  assert.equal(s.period, '4-week period from 26 July to 22 August');
  assert.deepEqual(s.plans.map((p) => p.label), ['Next 3 months', 'Next year', 'Long term']);
  assert.match(s.plans[0].text, /^Preparation & delivery/);
  assert.deepEqual(s.others, []);
});

test('performanceSummary: Waterloo, fewer cancellations than target is better', () => {
  const s = P.performanceSummary(WATERLOO, SNAPSHOT.target, 'WAT');
  assert.equal(s.punctual.verdict, 'worse');
  assert.equal(s.punctual.diff, -3.5);
  assert.equal(s.cancelled.verdict, 'better');
  assert.equal(s.cancelled.diff, -1.3);
  assert.equal(s.cancelled.cls, 'good');
});

test('performanceSummary: better on time, and level with target', () => {
  const raw = clone(SURBITON);
  raw.Items[0].Punctal = '90.00';
  raw.Items[0].Cancelled = '3.70'; // 3.70 − 3.68 rounds to 0.0 points
  const s = P.performanceSummary(raw, SNAPSHOT.target, 'SUR');
  assert.equal(s.punctual.verdict, 'better');
  assert.equal(s.punctual.diff, 3.9);
  assert.equal(s.cancelled.verdict, 'level');
  assert.ok(Object.is(s.cancelled.diff, 0), 'no negative zero');
});

test('performanceSummary: without a snapshot target, uses the route target row', () => {
  for (const target of [undefined, null, {}, { punctual: '', cancelled: null }]) {
    const s = P.performanceSummary(SURBITON, target, 'SUR');
    assert.equal(s.targetSource, 'row');
    assert.equal(s.punctual.target, 86.12);
    assert.equal(s.cancelled.target, 3.68);
  }
  // Field by field: a snapshot punctual target with the row's cancelled target.
  const s = P.performanceSummary(SURBITON, { punctual: 85 }, 'SUR');
  assert.equal(s.targetSource, 'snapshot');
  assert.equal(s.punctual.verdict, 'level');
  assert.equal(s.cancelled.target, 3.68);
});

test('performanceSummary: no target anywhere gives no verdict', () => {
  const raw = clone(SURBITON);
  raw.Items = raw.Items.filter((i) => !P.isTargetRow(i));
  const s = P.performanceSummary(raw, null, 'SUR');
  assert.equal(s.hasData, true);
  assert.equal(s.targetSource, null);
  assert.equal(s.punctual.verdict, null);
  assert.equal(s.punctual.diff, null);
  assert.equal(s.punctual.value, 85);
});

test('performanceSummary: Clapham Junction uses the SWR row and lists the others', () => {
  const s = P.performanceSummary(CLAPHAM, SNAPSHOT.target, 'CLJ');
  assert.equal(s.station.toc, 'SWR');
  assert.equal(s.punctual.value, 84.6);
  assert.equal(s.cancelled.value, 4.1);
  assert.deepEqual(s.others, [
    { toc: 'Arriva London', punctual: 90.4, cancelled: 16.2 },
    { toc: 'GTR', punctual: 79.8, cancelled: 4.3 },
  ]);
});

test('performanceSummary: missing and odd values', () => {
  const raw = clone(SURBITON);
  raw.Items[0].Punctal = 'n/a';
  let s = P.performanceSummary(raw, SNAPSHOT.target, 'SUR');
  assert.equal(s.hasData, true, 'one usable figure is enough');
  assert.equal(s.punctual.value, null);
  assert.equal(s.punctual.verdict, null);
  assert.equal(s.cancelled.value, 3.9);

  raw.Items[0].Cancelled = '';
  s = P.performanceSummary(raw, SNAPSHOT.target, 'SUR');
  assert.equal(s.hasData, false);
  assert.equal(s.reason, 'no-figures');

  delete raw.Period;
  delete raw.NextYearPlan;
  raw.LongTermPlan = '   ';
  s = P.performanceSummary(raw, SNAPSHOT.target, 'SUR');
  assert.equal(s.period, null);
  assert.deepEqual(s.plans.map((p) => p.label), ['Next 3 months']);
});

test('performanceSummary: Berrylands\' all-zero row counts as no data', () => {
  const s = P.performanceSummary(BERRYLANDS, SNAPSHOT.target, 'BRS');
  assert.equal(s.hasData, false);
  assert.equal(s.reason, 'no-figures');
  assert.equal(s.station.name, 'Berrylands');
  // A real 0% cancelled with a real on-time figure is data.
  const raw = clone(BERRYLANDS);
  raw.Items[0].Punctal = '97.10';
  assert.equal(P.performanceSummary(raw, SNAPSHOT.target, 'BRS').hasData, true);
});

test('performanceSummary: a station with no row, and unusable responses', () => {
  const raw = clone(SURBITON);
  raw.Items = [TARGET_ROW];
  raw.TotalResults = 1;
  const s = P.performanceSummary(raw, SNAPSHOT.target, 'SUR');
  assert.equal(s.hasData, false);
  assert.equal(s.reason, 'no-row');
  assert.equal(s.station, null);
  assert.equal(P.performanceSummary(SURBITON, SNAPSHOT.target, 'WAT').reason, 'no-row');
  for (const bad of [null, undefined, 'oops', 42]) assert.equal(P.performanceSummary(bad, SNAPSHOT.target, 'SUR').reason, 'no-response');
  assert.equal(P.performanceSummary({ Items: 'x' }, null, 'SUR').reason, 'no-row');
});

test('stationEntry and summaryFromSnapshot read S7\'s file', () => {
  assert.equal(P.stationEntry(SNAPSHOT, 'sur'), SURBITON);
  assert.equal(P.stationEntry({ stations: { wat: WATERLOO } }, 'WAT'), WATERLOO);
  assert.equal(P.stationEntry(SNAPSHOT, 'GLD'), null);
  assert.equal(P.stationEntry(null, 'SUR'), null);
  assert.equal(P.stationEntry({ stations: null }, 'SUR'), null);

  const raw = clone(SURBITON);
  delete raw.Period;
  const s = P.summaryFromSnapshot({ ...SNAPSHOT, stations: { SUR: raw } }, 'SUR');
  assert.equal(s.period, '4-week period from 26 July to 22 August', 'falls back to the file\'s period');
  assert.equal(P.summaryFromSnapshot(SNAPSHOT, 'GLD').reason, 'no-response');
});

test('verdictWords says better or worse in words, lower is better for cancellations', () => {
  const s = P.performanceSummary(SURBITON, SNAPSHOT.target, 'SUR');
  assert.deepEqual(P.verdictWords(s.punctual, false), { label: 'Worse than target', sentence: '1.1 percentage points below the route target of 86.1%.' });
  assert.deepEqual(P.verdictWords(s.cancelled, true), { label: 'Worse than target', sentence: '0.2 percentage points above the route target of 3.7%. Lower is better.' });
  const w = P.performanceSummary(WATERLOO, SNAPSHOT.target, 'WAT');
  assert.equal(P.verdictWords(w.cancelled, true).label, 'Better than target');
  assert.equal(P.verdictWords(P.compareToTarget(87.12, 86.12, false), false).sentence, '1.0 percentage point above the route target of 86.1%.');
  assert.equal(P.verdictWords(P.compareToTarget(86.12, 86.12, false), false).label, 'On target');
  assert.equal(P.verdictWords(P.compareToTarget(null, 86.12, false), false).sentence, 'No figure for this period.');
  assert.equal(P.verdictWords(P.compareToTarget(85, null, false), false).label, null);
});

test('snapshotAge flags a weekly snapshot that has stopped updating', () => {
  assert.deepEqual(P.snapshotAge('2026-09-28T05:17:42.000Z', NOW), { date: new Date('2026-09-28T05:17:42.000Z'), days: 0, stale: false });
  assert.equal(P.snapshotAge('2026-09-14T05:17:00Z', NOW).stale, false);
  assert.equal(P.snapshotAge('2026-09-01T05:17:00Z', NOW).stale, true);
  assert.equal(P.snapshotAge(undefined, NOW).stale, true);
  assert.equal(P.snapshotAge('not a date', NOW).date, null);
});

// ---------------------------------------------------------------------------
// renderPerformance
// ---------------------------------------------------------------------------

const SUR_STATION = { crs: 'SUR', name: 'Surbiton' };

test('renderPerformance: tiles, period, as-of, plans and about', () => {
  const { hidden, html } = P.renderPerformance({ station: SUR_STATION, snapshot: SNAPSHOT, loaded: true }, NOW);
  assert.equal(hidden, false);
  assert.match(html, /Station performance/);
  assert.match(html, /Past period, not live/);
  assert.match(html, /4-week period from 26 July to 22 August/);
  assert.match(html, /as of Mon 28 Sept?/);
  assert.match(html, /<h3>On time<\/h3><\/header><div class="tile-value swr-pf-value">85\.0%<\/div>/);
  assert.match(html, /<h3>Cancelled<\/h3><\/header><div class="tile-value swr-pf-value">3\.9%<\/div>/);
  assert.equal((html.match(/Worse than target/g) || []).length, 2);
  assert.match(html, /<details class="swr-pf-plans" data-key="plans">/);
  assert.doesNotMatch(html, /<details class="swr-pf-plans"[^>]* open/, 'plans start collapsed');
  assert.match(html, /Preparation &amp; delivery/, 'plan text is escaped');
  assert.match(html, /within 3 minutes of the scheduled time/);
  assert.doesNotMatch(html, /May be out of date/);
});

test('renderPerformance: hidden until loaded, and for a station with no data', () => {
  assert.equal(P.renderPerformance({ station: SUR_STATION, snapshot: null, loaded: false }, NOW).hidden, true);
  assert.equal(P.renderPerformance({ station: null, snapshot: SNAPSHOT, loaded: true }, NOW).hidden, true);
  assert.equal(P.renderPerformance({ station: { crs: 'GLD', name: 'Guildford' }, snapshot: SNAPSHOT, loaded: true }, NOW).hidden, true);
  assert.equal(P.renderPerformance({ station: { crs: 'BRS', name: 'Berrylands' }, snapshot: SNAPSHOT, loaded: true }, NOW).hidden, true);
});

test('renderPerformance: no snapshot shows "not available here"', () => {
  const { hidden, html } = P.renderPerformance({ station: SUR_STATION, snapshot: null, loaded: true }, NOW);
  assert.equal(hidden, false);
  assert.match(html, /aren't available here/);
  assert.doesNotMatch(html, /swr-pf-tile/);
});

test('renderPerformance: other operators and a stale snapshot', () => {
  const snap = { ...SNAPSHOT, fetchedAt: '2026-08-31T05:17:00Z' };
  const { html } = P.renderPerformance({ station: { crs: 'CLJ', name: 'Clapham Junction' }, snapshot: snap, loaded: true }, NOW);
  assert.match(html, /84\.6%/);
  assert.match(html, /These figures are for SWR trains\. SWR also lists other operators here: Arriva London 90\.4% on time, 16\.2% cancelled; GTR 79\.8% on time, 4\.3% cancelled\./);
  assert.match(html, /May be out of date/);
  assert.match(html, /28 days old/);
});

test('renderPerformance escapes every API string', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const raw = clone(CLAPHAM);
  raw.Items[0].TOC = evil;
  raw.Period = evil;
  raw.Next3MonthPlan = evil;
  const snap = { ...SNAPSHOT, stations: { CLJ: raw } };
  const { html } = P.renderPerformance({ station: { crs: 'CLJ', name: 'Clapham Junction' }, snapshot: snap, loaded: true }, NOW);
  assert.doesNotMatch(html, /<img/);
  assert.equal((html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 3);
});

// ---------------------------------------------------------------------------
// Demo fixture
// ---------------------------------------------------------------------------

test('demo route answers data/swr/performance.json in the S7 format', () => {
  assert.equal(P.demoRoute('https://api.tfl.gov.uk/Line/x/Status'), null);
  assert.equal(P.demoRoute('data/swr/status.json'), null);
  const snap = P.demoRoute('data/swr/performance.json');
  assert.ok(snap);
  assert.deepEqual(Object.keys(snap), ['fetchedAt', 'period', 'target', 'stations']);
  for (const crs of ['WAT', 'CLJ', 'SUR', 'WOK', 'GLD', 'WIM', 'RMD', 'VXH']) {
    const s = P.summaryFromSnapshot(snap, crs);
    assert.equal(s.hasData, true, crs);
    assert.equal(s.targetSource, 'snapshot');
    assert.equal(s.plans.length, 3);
  }
  assert.equal(P.summaryFromSnapshot(snap, 'BRS').reason, 'no-figures');
  assert.deepEqual(Object.keys(snap.stations.SUR), Object.keys(SURBITON), 'same keys as the real response');
  assert.equal(snap.stations.CLJ.TotalResults, 4);

  // Fetched "last Monday at 05:17 UTC", never in the future.
  const monday = P.demoPerformanceSnapshot(new Date('2026-09-28T04:00:00Z'));
  assert.equal(monday.fetchedAt, '2026-09-21T05:17:00.000Z');
  assert.equal(P.demoPerformanceSnapshot(NOW).fetchedAt, '2026-09-28T05:17:00.000Z');
  assert.equal(P.demoPerformanceSnapshot(new Date('2026-10-01T12:00:00Z')).fetchedAt, '2026-09-28T05:17:00.000Z');
});
