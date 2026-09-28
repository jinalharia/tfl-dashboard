const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/swr-seats.js');

// GET https://www.southwesternrailway.com/api/seatavailability/Woking/London%20Waterloo?skip=0&take=100
// (2026-09-27; 13 of the 43 Items, in SWR's order, which is by departure). JourneyDuration is SWR's own
// value: a clock time that doesn't match Departure/Arrival.
const WOKING = [
  { Id: 17, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '06:28', Arrival: '07:04', JourneyDuration: '12:34:00 AM', Via: '-', NumberOfCarriages: 8, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 223, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '06:32', Arrival: '07:24', JourneyDuration: '12:52:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' },
  { Id: 165, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '06:47', Arrival: '07:21', JourneyDuration: '12:32:00 AM', Via: '-', NumberOfCarriages: 5, Monday: 'Green', Tuesday: 'Amber', Wednesday: 'Amber', Thursday: 'Amber', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 517, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '07:27', Arrival: '07:53', JourneyDuration: '12:24:00 AM', Via: '-', NumberOfCarriages: 12, Monday: 'Red', Tuesday: 'Red', Wednesday: 'Red', Thursday: 'Red', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 812, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '07:51', Arrival: '08:19', JourneyDuration: '12:25:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'VeryRed', Wednesday: 'VeryRed', Thursday: 'VeryRed', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 902, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:01', Arrival: '08:27', JourneyDuration: '12:23:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'VeryRed', Wednesday: 'VeryRed', Thursday: 'VeryRed', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1172, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:02', Arrival: '08:47', JourneyDuration: '12:42:00 AM', Via: '-', NumberOfCarriages: 12, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1098, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:14', Arrival: '08:41', JourneyDuration: '12:24:00 AM', Via: '-', NumberOfCarriages: 12, Monday: 'Green', Tuesday: 'Red', Wednesday: 'Red', Thursday: 'Red', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1225, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:25', Arrival: '08:51', JourneyDuration: '12:24:00 AM', Via: '-', NumberOfCarriages: 12, Monday: 'Green', Tuesday: 'Amber', Wednesday: 'Amber', Thursday: 'Amber', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1273, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:28', Arrival: '08:54', JourneyDuration: '12:23:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Red', Tuesday: 'VeryRed', Wednesday: 'VeryRed', Thursday: 'VeryRed', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1322, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:34', Arrival: '09:01', JourneyDuration: '12:24:00 AM', Via: '-', NumberOfCarriages: 12, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1487, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '08:49', Arrival: '09:16', JourneyDuration: '12:26:00 AM', Via: '-', NumberOfCarriages: 5, Monday: 'Amber', Tuesday: 'Amber', Wednesday: 'Amber', Thursday: 'Amber', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
  { Id: 1911, StationFrom: 'Woking', StationTo: 'London Waterloo', Departure: '09:02', Arrival: '09:54', JourneyDuration: '12:50:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' },
];

// GET https://www.southwesternrailway.com/api/seatavailability/Surbiton/London%20Waterloo?skip=0&take=10
// (2026-09-27; page 1 of 26, 4 of its 10 Items)
const SURBITON = {
  TotalResults: 26,
  Items: [
    { Id: 2, StationFrom: 'Surbiton', StationTo: 'London Waterloo', Departure: '06:31', Arrival: '07:03', JourneyDuration: '12:30:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Green', Tuesday: 'Green', Wednesday: 'Green', Thursday: 'Green', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' },
    { Id: 277, StationFrom: 'Surbiton', StationTo: 'London Waterloo', Departure: '07:07', Arrival: '07:28', JourneyDuration: '12:19:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Amber', Tuesday: 'Amber', Wednesday: 'Amber', Thursday: 'Amber', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' },
    { Id: 439, StationFrom: 'Surbiton', StationTo: 'London Waterloo', Departure: '07:27', Arrival: '07:45', JourneyDuration: '12:16:00 AM', Via: '-', NumberOfCarriages: 8, Monday: 'Amber', Tuesday: 'Red', Wednesday: 'Red', Thursday: 'Red', Friday: 'Green', Mon_TrainName: '', Tue_TrainName: '', Wed_TrainName: '', Thu_TrainName: '', Fri_TrainName: '' },
    { Id: 710, StationFrom: 'Surbiton', StationTo: 'London Waterloo', Departure: '07:41', Arrival: '08:10', JourneyDuration: '12:27:00 AM', Via: '-', NumberOfCarriages: 10, Monday: 'Red', Tuesday: 'Red', Wednesday: 'Red', Thursday: 'Red', Friday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio', Wed_TrainName: 'Arterio', Thu_TrainName: 'Arterio', Fri_TrainName: 'Arterio' },
  ],
};

// data/swr/seats/WOK.json as package S7 writes it (plan.md, "Snapshot file formats").
const WOK_FILE = { fetchedAt: '2026-09-21T05:19:42.000Z', crs: 'WOK', from: 'Woking', to: 'London Waterloo', items: WOKING };

const at = (iso) => new Date(iso);
const MONDAY = at('2026-09-28T07:00:00Z'); // 08:00 BST
const WEDNESDAY = at('2026-09-30T07:00:00Z');
const SATURDAY = at('2026-10-03T10:00:00Z');
const SUNDAY_NIGHT_UTC = at('2026-10-04T23:30:00Z'); // 00:30 BST on Monday 5 October
const deps = (rows) => rows.map((r) => r.departure);

test('normalizeLevel maps SWR colours to its own wording, including VeryRed and blanks', () => {
  assert.equal(S.normalizeLevel('Green').label, 'Seats available');
  assert.equal(S.normalizeLevel('Amber').label, 'Some seats available');
  assert.equal(S.normalizeLevel('Red').label, 'Standing room only');
  assert.equal(S.normalizeLevel('VeryRed').label, 'Full to capacity');
  assert.equal(S.normalizeLevel('very red').key, 'veryred');
  assert.equal(S.normalizeLevel(' green ').key, 'green');
  assert.equal(S.normalizeLevel('').key, 'none');
  assert.equal(S.normalizeLevel(null).label, 'No service');
  const odd = S.normalizeLevel('Purple');
  assert.equal(odd.key, 'unknown');
  assert.equal(odd.label, 'Purple');
  assert.equal(odd.pips, 0);
  assert.deepEqual([1, 2, 3, 4], ['green', 'amber', 'red', 'veryred'].map((k) => S.LEVELS[k].pips));
});

test('resolveDay: today in London, named days, and Monday at weekends', () => {
  assert.deepEqual(S.resolveDay(null, MONDAY), { day: 'Monday', index: 0, short: 'Mon', today: true, weekend: false });
  assert.equal(S.resolveDay(undefined, WEDNESDAY).day, 'Wednesday');
  assert.equal(S.resolveDay('thu', WEDNESDAY).day, 'Thursday');
  assert.equal(S.resolveDay('Thursday', WEDNESDAY).today, false);
  assert.equal(S.resolveDay(4, WEDNESDAY).day, 'Friday');
  assert.equal(S.resolveDay('nonsense', WEDNESDAY).day, 'Wednesday');
  const sat = S.resolveDay(null, SATURDAY);
  assert.equal(sat.day, 'Monday');
  assert.equal(sat.weekend, true);
  assert.equal(sat.today, false);
  assert.equal(S.resolveDay('Sunday', WEDNESDAY).day, 'Monday');
  // 23:30 UTC on Sunday is already Monday in London (BST).
  assert.deepEqual(S.resolveDay(null, SUNDAY_NIGHT_UTC), { day: 'Monday', index: 0, short: 'Mon', today: true, weekend: false });
});

test('seatSummary sorts by departure and picks the day column', () => {
  const shuffled = [WOKING[7], WOKING[0], WOKING[12], WOKING[3], WOKING[5], WOKING[4]];
  const tue = S.seatSummary(shuffled, 'Tuesday', MONDAY);
  assert.deepEqual(deps(tue.rows), ['06:28', '07:27', '07:51', '08:01', '08:14', '09:02']);
  assert.deepEqual(tue.rows.map((r) => r.level.key), ['green', 'red', 'veryred', 'veryred', 'red', 'green']);
  assert.deepEqual(tue.counts, { green: 2, amber: 0, red: 2, veryred: 2, none: 0, unknown: 0 });
  assert.equal(tue.day, 'Tuesday');
  assert.equal(tue.today, false);
  assert.equal(tue.firstDeparture, '06:28');
  assert.equal(tue.lastArrival, '09:54');
  // Every row still carries all five days.
  assert.deepEqual(tue.rows[2].levels.map((l) => l.key), ['green', 'veryred', 'veryred', 'veryred', 'green']);

  const fri = S.seatSummary(WOKING, 'Friday', MONDAY);
  assert.equal(fri.counts.green, WOKING.length);
});

test('seatSummary falls back to Monday at weekends and accepts a whole file or API response', () => {
  const sat = S.seatSummary(WOK_FILE, null, SATURDAY);
  assert.equal(sat.day, 'Monday');
  assert.equal(sat.weekend, true);
  assert.equal(sat.total, WOKING.length);
  assert.equal(sat.rows.find((r) => r.departure === '08:28').level.key, 'red'); // Monday's value
  const sur = S.seatSummary(SURBITON, 'Monday', MONDAY);
  assert.deepEqual(deps(sur.rows), ['06:31', '07:07', '07:27', '07:41']);
  assert.equal(S.seatSummary(null, 'Monday', MONDAY).total, 0);
  assert.equal(S.seatSummary({ nothing: true }, 'Monday', MONDAY).total, 0);
});

test('rows: journey time from Departure/Arrival (JourneyDuration is junk), carriages, train type, via', () => {
  const rows = S.seatSummary(WOKING, 'Monday', MONDAY).rows;
  const first = rows[0];
  assert.equal(first.durationMins, 36); // 06:28 → 07:04, although JourneyDuration says "12:34:00 AM"
  assert.equal(first.carriages, 8);
  assert.equal(first.via, null); // "-"
  assert.deepEqual(first.trainTypes, []);
  assert.deepEqual(rows[1].trainTypes, [{ name: 'Arterio', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], allDays: true }]);
  assert.equal(rows[1].durationMins, 52);
  assert.equal(rows[0].id, '17');
});

test('odd values: bad times, carriages, part-week train names, a via, null entries', () => {
  const items = [
    null,
    'not an item',
    { Id: 1, Departure: '7:05', Arrival: '07:30:00', NumberOfCarriages: '8', Via: 'Kingston', Monday: 'Green', Mon_TrainName: 'Arterio', Tue_TrainName: 'Arterio' },
    { Id: 2, Departure: '', Arrival: '08:00', NumberOfCarriages: 0, Monday: 'Amber' },
    { Id: 3, Departure: '23:50', Arrival: '00:10', NumberOfCarriages: null, Monday: 'Red' },
    { Id: 4, Departure: '25:00', Arrival: 'soon', NumberOfCarriages: 4.5, Monday: 'Green' },
  ];
  const sum = S.seatSummary(items, 'Monday', MONDAY);
  assert.equal(sum.total, 4);
  const [a, b, c, d] = sum.rows;
  assert.deepEqual([a.departure, a.arrival, a.durationMins, a.carriages, a.via], ['07:05', '07:30', 25, 8, 'Kingston']);
  assert.deepEqual(a.trainTypes, [{ name: 'Arterio', days: ['Mon', 'Tue'], allDays: false }]);
  assert.deepEqual(a.levels.slice(1).map((l) => l.key), ['none', 'none', 'none', 'none']); // missing days: no service
  assert.equal(b.departure, '23:50');
  assert.equal(b.durationMins, 20); // across midnight
  assert.equal(b.carriages, null);
  // Rows without a departure time go last.
  assert.equal(c.departure, null);
  assert.equal(c.carriages, null);
  assert.equal(d.departure, null);
  assert.equal(d.durationMins, null);
  assert.equal(d.carriages, null);
  assert.equal(S.durationMinutes('08:00', '08:00'), null);
});

test('quieterTrains: Green first, then Amber, nearest to the arrival time', () => {
  const mon = S.seatSummary(WOKING, 'Monday', MONDAY);
  const q = S.quieterTrains(mon, '09:00');
  assert.equal(q.target, '09:00');
  assert.equal(q.from, '08:00');
  assert.equal(q.after, false);
  // 08:28 (arr 08:54) is Red on Mondays; 08:34 arrives after 09:00.
  assert.deepEqual(deps(q.picks), ['08:25', '08:02', '08:14']);
  assert.equal(q.latest.departure, '08:28');
  assert.equal(q.latest.level.key, 'red');

  // Tuesday: the Green 08:02 beats the nearer Amber 08:25.
  const tue = S.seatSummary(WOKING, 'Tuesday', MONDAY);
  const qt = S.quieterTrains(tue, '09:00');
  assert.deepEqual(deps(qt.picks), ['08:02', '08:25']);
  assert.deepEqual(qt.picks.map((r) => r.level.key), ['green', 'amber']);
  assert.equal(qt.latest.level.key, 'veryred');

  // Arriving by 08:10 on Tuesday: 07:10–08:10 has 06:32 Green (arr 07:24) and 06:47 Amber (arr 07:21);
  // 07:27 (arr 07:53) is Red. A 90-minute window also reaches 06:28 (arr 07:04).
  assert.deepEqual(deps(S.quieterTrains(tue, '08:10').picks), ['06:32', '06:47']);
  assert.deepEqual(deps(S.quieterTrains(tue, '08:10', { windowMins: 90 }).picks), ['06:32', '06:28', '06:47']);

  assert.equal(S.quieterTrains(mon, '09:00', { limit: 1 }).picks.length, 1);
  assert.equal(S.quieterTrains(mon, 'bad').target, '09:00'); // falls back to the default
});

test('quieterTrains looks after the time when nothing quieter arrives before it', () => {
  const tue = S.seatSummary(WOKING, 'Tuesday', MONDAY);
  // 07:30–08:30 on Tuesday: 07:27 Red, 07:51 and 08:01 VeryRed. So look 08:30–09:30 instead:
  // Green 08:02 (arr 08:47) and 08:34 (arr 09:01), then Amber 08:25 (arr 08:51).
  const q = S.quieterTrains(tue, '08:30');
  assert.equal(q.after, true);
  assert.deepEqual(deps(q.picks), ['08:02', '08:34', '08:25']);
  assert.equal(q.latest.departure, '08:01');
  assert.match(S.renderBody({ summary: tue, arriveBy: '08:30' }), /No train that usually has seats arrives between 07:30 and 08:30 on Tuesday\. The nearest after that:/);
  const early = S.quieterTrains(tue, '06:00');
  assert.deepEqual(early.picks, []);
  assert.equal(early.latest, null);
});

test('visibleRows keeps the table near the chosen time, or shows everything', () => {
  const mon = S.seatSummary(WOKING, 'Monday', MONDAY);
  const near = S.visibleRows(mon, '09:00', false);
  assert.equal(near.all, false);
  assert.equal(near.from, '08:00');
  assert.equal(near.to, '09:15');
  assert.deepEqual(deps(near.rows), ['07:51', '08:01', '08:02', '08:14', '08:25', '08:28', '08:34']);
  assert.equal(S.visibleRows(mon, '09:00', true).rows.length, WOKING.length);
  assert.equal(S.visibleRows(mon, '05:00', false).all, true); // nothing near: show all
});

test('parseArriveBy, normalizeSeatFile, indexHasStation and seatsAge', () => {
  assert.equal(S.parseArriveBy('9:05'), '09:05');
  assert.equal(S.parseArriveBy('08:30:00'), '08:30');
  assert.equal(S.parseArriveBy('24:00'), null);
  assert.equal(S.parseArriveBy(''), null);

  const f = S.normalizeSeatFile(WOK_FILE);
  assert.equal(f.crs, 'WOK');
  assert.equal(f.items.length, WOKING.length);
  assert.equal(S.normalizeSeatFile(SURBITON).items.length, 4); // a raw API response works too
  assert.equal(S.normalizeSeatFile(null), null);
  assert.equal(S.normalizeSeatFile([]), null);
  assert.equal(S.normalizeSeatFile({ fetchedAt: 'x' }), null);

  // data/swr/seats/index.json as S7 writes it.
  const index = { fetchedAt: '2026-09-21T05:19:42.000Z', stations: [{ crs: 'WOK', seatName: 'Woking' }, { crs: 'SUR', seatName: 'Surbiton' }] };
  assert.equal(S.indexHasStation(index, 'wok'), true);
  assert.equal(S.indexHasStation(index, 'GLD'), false);
  assert.equal(S.indexHasStation(null, 'WOK'), null);

  const age = S.seatsAge(WOK_FILE.fetchedAt, MONDAY);
  assert.equal(age.days, 7);
  assert.equal(age.stale, false);
  assert.equal(S.seatsAge(WOK_FILE.fetchedAt, at('2026-10-10T07:00:00Z')).stale, true);
  assert.equal(S.seatsAge(null, MONDAY).stale, true);
});

test('renderSeats: day chips with text, today highlighted, SWR wording in the key and escaped strings', () => {
  const evil = [{ ...WOKING[0], Via: '<img src=x onerror=alert(1)>', Mon_TrainName: '<b>x</b>', Tuesday: '<script>' }];
  const file = S.normalizeSeatFile({ ...WOK_FILE, items: evil.concat(WOKING.slice(1)) });
  const summary = S.seatSummary(file.items, null, MONDAY);
  const html = S.renderSeats({ station: { crs: 'WOK', name: 'Woking' }, file, summary, arriveBy: '09:00', showAll: true }, MONDAY);
  assert.ok(!/<img|<script|<b>/.test(html), 'API strings are escaped');
  assert.match(html, /via &lt;img src=x/);
  assert.match(html, /as of Mon,? 21 Sept? \(7 days ago\)/);
  for (const label of ['Seats available', 'Some seats available', 'Standing room only', 'Full to capacity', 'No service']) assert.ok(html.includes(label), label);
  assert.match(html, /<th scope="col" class="swr-seat-dayh is-day"><abbr title="Monday">Mon<\/abbr><span class="swr-seat-today">today<\/span>/);
  assert.match(html, /<span class="visually-hidden">Tuesday: Full to capacity<\/span>/);
  assert.match(html, /Quieter trains arriving by 09:00 on Monday/);
  assert.match(html, /class="swr-seat-arrive" value="09:00"/);
  assert.match(html, /<option value="Monday" selected>Monday \(today\)<\/option>/);
  assert.match(html, /How busy is my train\?/);
  assert.ok(!/May be out of date/.test(html));

  const old = S.renderSeats({ station: { crs: 'WOK', name: 'Woking' }, file: { ...file, fetchedAt: '2026-08-01T05:00:00Z' }, summary, arriveBy: '09:00' }, MONDAY);
  assert.match(old, /May be out of date/);

  const weekend = S.renderBody({ summary: S.seatSummary(file.items, null, SATURDAY), arriveBy: '09:00' });
  assert.match(weekend, /It's the weekend, so Monday is highlighted/);
  assert.match(S.renderBody({ summary: S.seatSummary([], null, MONDAY), arriveBy: '09:00' }), /lists no morning trains/);
});

test('Waterloo and unavailable notes', () => {
  assert.match(S.renderWaterloo(), /<em>into<\/em> London Waterloo/);
  assert.match(S.renderUnavailable({ name: 'A & B' }), /from A &amp; B to London Waterloo isn't available here/);
});

test('demo route: S7-shaped files for the demo stations, the index, and nothing elsewhere', () => {
  for (const crs of ['SUR', 'WOK', 'GLD', 'WIM']) {
    const body = S.demoRoute(`data/swr/seats/${crs}.json`);
    assert.equal(body.crs, crs);
    assert.equal(body.to, 'London Waterloo');
    assert.ok(body.items.length >= 20, crs);
    const it = body.items[0];
    for (const k of ['Id', 'StationFrom', 'StationTo', 'Departure', 'Arrival', 'JourneyDuration', 'Via', 'NumberOfCarriages', ...S.DAYS, 'Mon_TrainName', 'Fri_TrainName']) assert.ok(k in it, `${crs} ${k}`);
    const sum = S.seatSummary(body.items, 'Tuesday', MONDAY);
    assert.ok(sum.counts.green > 0 && sum.counts.red + sum.counts.veryred > 0, `${crs} has a mix of levels`);
    assert.ok(S.toMinutes(sum.lastArrival) < 600, `${crs} arrivals before 10:00`);
    assert.deepEqual(S.demoRoute(`data/swr/seats/${crs}.json`).items, body.items); // deterministic
  }
  assert.equal(S.demoRoute('data/swr/seats/WAT.json'), null);
  assert.equal(S.demoRoute('data/swr/seats/BRS.json'), null);
  assert.equal(S.demoRoute('data/swr/status.json'), null);
  const index = S.demoRoute('data/swr/seats/index.json');
  assert.ok(S.indexHasStation(index, 'WOK'));
  assert.equal(S.indexHasStation(index, 'BRS'), false);
  assert.equal(S.demoFetchedAt(at('2026-09-28T04:00:00Z')), '2026-09-21T05:17:00.000Z');
  assert.equal(S.demoFetchedAt(at('2026-09-30T12:00:00Z')), '2026-09-28T05:17:00.000Z');
});
