const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/swr-calling-points.js');

// ---------- Fixtures (real responses from 27/09/2026, trimmed) ----------

const cp = (name, crs, st, et, at, visited) => ({
  Station: { Name: name, CrsCode: crs }, ScheduledTime: st, EstimatedTime: et, ActualTime: at, IsVisited: visited,
});

// POST https://railinfo.southwesternrailway.com/journey/services {"ServiceId":"9138693WATRLMN_"}
// (19:21 Waterloo -> Reading, fetched at 19:23 after it left; trimmed to 5 of 20 stops).
// The origin row has ScheduledTime null; its times are in the top-level *Departure fields.
const RAILINFO_WAT_ORIGIN = {
  Id: null, Destination: { Name: 'London Waterloo', CrsCode: 'WAT' }, LastLocation: null,
  Operator: 'South Western Railway', Platform: '15',
  ScheduledArrival: null, EstimatedArrival: null, ActualArrival: null,
  ScheduledDeparture: '19:21', EstimatedDeparture: null, ActualDeparture: 'On time',
  GeneratedAt: '2026-09-27T18:23:26.7259956+00:00',
  CallingPoints: [
    cp('London Waterloo', 'WAT', null, null, null, false),
    cp('Vauxhall', 'VXH', '19:25', 'On time', null, false),
    cp('Clapham Junction', 'CLJ', '19:30', 'On time', null, false),
    cp('Surbiton', 'SUR', '19:44', 'On time', null, false),
    cp('Reading', 'RDG', '21:12', 'On time', null, false),
  ],
};

// POST https://railinfo.southwesternrailway.com/journey/services {"ServiceId":"9138692SURBITN_"}
// (Reading -> Waterloo seen from Surbiton, mid-journey; trimmed). Passed stops have ActualTime
// "On time" and IsVisited; Virginia Water is called at twice; LastLocation is Weybridge.
const RAILINFO_SUR_MID = {
  Id: null, Destination: { Name: 'Surbiton', CrsCode: 'SUR' }, LastLocation: { Name: 'Weybridge', CrsCode: 'WYB' },
  Operator: 'South Western Railway', Platform: '1',
  ScheduledArrival: '20:05', EstimatedArrival: 'On time', ActualArrival: null,
  ScheduledDeparture: '20:09', EstimatedDeparture: 'On time', ActualDeparture: null,
  GeneratedAt: '2026-09-27T18:58:53.6753036+00:00',
  CallingPoints: [
    cp('Reading', 'RDG', '18:54', null, 'On time', true),
    cp('Virginia Water', 'VIR', '19:31', null, 'On time', true),
    cp('Virginia Water', 'VIR', '19:44', null, 'On time', true),
    cp('Weybridge', 'WYB', '19:57', null, 'On time', true),
    cp('Surbiton', 'SUR', '20:05', 'On time', null, false),
    cp('Wimbledon', 'WIM', '20:16', 'On time', null, false),
    cp('London Waterloo', 'WAT', '20:32', 'On time', null, false),
  ],
};

const hp = (locationName, crs, st, et, at, extra) => ({
  locationName, crs, st, et, at, isCancelled: false, length: 10, detachFront: false, formation: null, adhocAlerts: null, ...extra,
});

// GET https://huxley2.azurewebsites.net/service/9138692SURBITN_ (same train, same moment; trimmed).
// The board's own stop (Surbiton) is only in the top-level sta/std/etd fields.
const HUXLEY_SUR_MID = {
  generatedAt: '2026-09-27T18:58:54.5325277+00:00', serviceType: 0, locationName: 'Surbiton', crs: 'SUR',
  operator: 'South Western Railway', operatorCode: 'SW', isCancelled: false, cancelReason: null, delayReason: null,
  length: 10, platform: '1', sta: '20:05', eta: 'On time', ata: null, std: '20:09', etd: 'On time', atd: null,
  previousCallingPoints: [{ callingPoint: [
    hp('Reading', 'RDG', '18:54', null, 'On time'),
    hp('Virginia Water', 'VIR', '19:31', null, 'On time'),
    hp('Virginia Water', 'VIR', '19:44', null, 'On time'),
    hp('Weybridge', 'WYB', '19:57', null, 'On time'),
  ], serviceType: 0, serviceChangeRequired: false, assocIsCancelled: false }],
  subsequentCallingPoints: [{ callingPoint: [
    hp('Wimbledon', 'WIM', '20:16', 'On time', null),
    hp('London Waterloo', 'WAT', '20:32', 'On time', null),
  ], serviceType: 0, serviceChangeRequired: false, assocIsCancelled: false }],
};

// POST https://railinfo.southwesternrailway.com/journey/services {"ServiceId":"9138518WATRLMN_"}
// (20:30 Waterloo -> Portsmouth Harbour running 18 minutes late; trimmed).
const RAILINFO_WAT_LATE = {
  Id: null, Destination: { Name: 'London Waterloo', CrsCode: 'WAT' }, LastLocation: null,
  Operator: 'South Western Railway', Platform: null,
  ScheduledArrival: null, EstimatedArrival: null, ActualArrival: null,
  ScheduledDeparture: '20:30', EstimatedDeparture: '20:48', ActualDeparture: null,
  GeneratedAt: '2026-09-27T18:59:33.8681869+00:00',
  CallingPoints: [
    cp('London Waterloo', 'WAT', null, null, null, false),
    cp('Woking', 'WOK', '20:56', '21:13', null, false),
    cp('Guildford', 'GLD', '21:04', '21:21', null, false),
    cp('Portsmouth Harbour', 'PMH', '22:04', '22:18', null, false),
  ],
};

// GET https://huxley2.azurewebsites.net/service/9138518WATRLMN_ (same train; trimmed).
const HUXLEY_WAT_LATE = {
  generatedAt: '2026-09-27T18:59:34.3896667+00:00', locationName: 'London Waterloo', crs: 'WAT',
  operator: 'South Western Railway', operatorCode: 'SW', isCancelled: false, cancelReason: null,
  delayReason: 'This service has been delayed by a passenger being taken ill on a train earlier today',
  length: 10, platform: null, sta: null, eta: null, ata: null, std: '20:30', etd: '20:48', atd: null,
  previousCallingPoints: null,
  subsequentCallingPoints: [{ callingPoint: [
    hp('Woking', 'WOK', '20:56', '21:13', null),
    hp('Guildford', 'GLD', '21:04', '21:21', null),
    hp('Portsmouth Harbour', 'PMH', '22:04', '22:18', null),
  ] }],
};

const sameStops = (m) => m.stops.map((s) => ({
  name: s.name, crs: s.crs, scheduled: s.scheduled, expected: s.expected, actual: s.actual, passed: s.passed,
  lateMinutes: s.lateMinutes, cancelled: s.cancelled, status: s.status, isViewing: s.isViewing, isLastReported: s.isLastReported,
}));

// ---------- Normalisation ----------

test('railinfo: order, origin times from the top-level departure, departed origin is passed', () => {
  const m = C.normalizeCallingPoints(RAILINFO_WAT_ORIGIN, 'WAT');
  assert.equal(m.source, 'railinfo');
  assert.equal(m.generatedAt, '2026-09-27T18:23:26.7259956+00:00');
  assert.deepEqual(m.stops.map((s) => s.crs), ['WAT', 'VXH', 'CLJ', 'SUR', 'RDG']);
  const wat = m.stops[0];
  assert.equal(wat.scheduled, '19:21');
  assert.equal(wat.passed, true);
  assert.equal(wat.actual, '19:21');
  assert.equal(wat.lateMinutes, 0);
  assert.equal(wat.isViewing, true);
  // No LastLocation: the last passed stop is the last reported one.
  assert.equal(wat.isLastReported, true);
  assert.deepEqual(m.lastLocation, { name: 'London Waterloo', crs: 'WAT' });
  assert.equal(m.stops[1].passed, false);
  assert.equal(m.stops[1].expected, '19:25');
  assert.equal(m.stops[1].status, 'on-time');
});

test('railinfo: passed stops, LastLocation, viewed station and a repeated station', () => {
  const m = C.normalizeCallingPoints(RAILINFO_SUR_MID, 'sur');
  assert.deepEqual(m.stops.map((s) => s.passed), [true, true, true, true, false, false, false]);
  assert.deepEqual(m.stops.map((s) => s.isLastReported), [false, false, false, true, false, false, false]);
  assert.deepEqual(m.lastLocation, { name: 'Weybridge', crs: 'WYB' });
  const sur = m.stops[4];
  assert.equal(sur.isViewing, true);
  assert.equal(sur.scheduled, '20:09', 'the viewed stop uses the departure time shown on the board');
  assert.equal(m.stops.filter((s) => s.isViewing).length, 1);
  assert.equal(m.viewingCrs, 'SUR');
  assert.match(C.summaryText(m), /^Last reported at Weybridge \(on time\)\. Next: Surbiton, expected 20:09\.$/);
});

test('LastLocation at a station called twice picks the last copy passed', () => {
  const s = structuredClone(RAILINFO_SUR_MID);
  s.LastLocation = { Name: 'Virginia Water', CrsCode: 'VIR' };
  s.CallingPoints[3].IsVisited = false;
  s.CallingPoints[3].ActualTime = null;
  s.CallingPoints[3].EstimatedTime = 'On time';
  const m = C.normalizeCallingPoints(s, 'SUR');
  assert.deepEqual(m.stops.map((x) => x.isLastReported), [false, false, true, false, false, false, false]);
});

test('railinfo and Huxley give the same stops for the same train', () => {
  assert.deepEqual(sameStops(C.normalizeHuxleyCallingPoints(HUXLEY_SUR_MID, 'SUR')), sameStops(C.normalizeCallingPoints(RAILINFO_SUR_MID, 'SUR')));
  assert.deepEqual(sameStops(C.normalizeHuxleyCallingPoints(HUXLEY_WAT_LATE, 'WAT')), sameStops(C.normalizeCallingPoints(RAILINFO_WAT_LATE, 'WAT')));
});

test('late minutes from expected times, and a not-departed summary', () => {
  const m = C.normalizeCallingPoints(RAILINFO_WAT_LATE, 'WAT');
  assert.deepEqual(m.stops.map((s) => s.lateMinutes), [18, 17, 17, 14]);
  assert.deepEqual(m.stops.map((s) => s.status), ['late', 'late', 'late', 'late']);
  assert.equal(m.stops[0].expected, '20:48');
  assert.equal(m.lastLocation, null);
  assert.equal(C.summaryText(m), 'Not departed from London Waterloo yet: expected 20:48 (18 min late).');
  const h = C.normalizeHuxleyCallingPoints(HUXLEY_WAT_LATE, 'WAT');
  assert.equal(h.source, 'huxley');
  assert.equal(h.length, 10);
  assert.equal(h.stops[1].length, 10);
});

test('late minutes from actual times, across midnight, and early running', () => {
  const s = structuredClone(RAILINFO_SUR_MID);
  s.CallingPoints[3].ActualTime = '20:01';
  s.CallingPoints[5] = cp('Wimbledon', 'WIM', '23:58', '00:04', null, false);
  s.CallingPoints[6] = cp('London Waterloo', 'WAT', '00:20', '00:18', null, false);
  const m = C.normalizeCallingPoints(s, 'SUR');
  assert.equal(m.stops[3].actual, '20:01');
  assert.equal(m.stops[3].lateMinutes, 4);
  assert.equal(m.stops[5].lateMinutes, 6);
  assert.equal(m.stops[6].lateMinutes, -2);
  assert.equal(m.stops[6].status, 'early');
  assert.equal(C.summaryText(m), 'Last reported at Weybridge (4 min late). Next: Surbiton, expected 20:09.');
});

test('a cancelled stop, in both sources', () => {
  const r = structuredClone(RAILINFO_SUR_MID);
  r.CallingPoints[5].EstimatedTime = 'Cancelled';
  const h = structuredClone(HUXLEY_SUR_MID);
  h.subsequentCallingPoints[0].callingPoint[0].isCancelled = true;
  h.subsequentCallingPoints[0].callingPoint[0].et = 'Cancelled';
  for (const m of [C.normalizeCallingPoints(r, 'SUR'), C.normalizeHuxleyCallingPoints(h, 'SUR')]) {
    const wim = m.stops.find((s) => s.crs === 'WIM');
    assert.equal(wim.cancelled, true);
    assert.equal(wim.passed, false);
    assert.equal(wim.lateMinutes, null);
    assert.equal(wim.expected, null);
    assert.equal(wim.status, 'cancelled');
    assert.equal(m.stops.find((s) => s.crs === 'WAT').cancelled, false);
    assert.match(C.summaryText(m), /Won't call at Wimbledon\./);
    assert.deepEqual(C.stopStatus(wim), { cls: 'critical', icon: '✕', text: 'Cancelled' });
  }
});

test('cancelled from a stop onwards, and a fully cancelled train', () => {
  const r = structuredClone(RAILINFO_SUR_MID);
  r.CallingPoints[5].EstimatedTime = 'Cancelled';
  r.CallingPoints[6].EstimatedTime = 'Cancelled';
  assert.match(C.summaryText(C.normalizeCallingPoints(r, 'SUR')), /Cancelled from Wimbledon\.$/);
  const all = structuredClone(RAILINFO_WAT_LATE);
  all.EstimatedDeparture = 'Cancelled';
  all.CallingPoints.forEach((p) => { p.EstimatedTime = 'Cancelled'; });
  const m = C.normalizeCallingPoints(all, 'WAT');
  assert.equal(m.allCancelled, true);
  assert.equal(C.summaryText(m), 'This train is cancelled.');
});

test('missing times, "Delayed" and "No report" do not break anything', () => {
  const s = structuredClone(RAILINFO_WAT_ORIGIN);
  s.ScheduledDeparture = null;
  s.ActualDeparture = null;
  s.CallingPoints[1].EstimatedTime = 'Delayed';
  s.CallingPoints[2].ScheduledTime = null;
  s.CallingPoints[2].EstimatedTime = null;
  const m = C.normalizeCallingPoints(s, 'WAT');
  assert.equal(m.stops[0].scheduled, null);
  assert.equal(m.stops[0].passed, false);
  assert.equal(m.stops[0].lateMinutes, null);
  assert.equal(m.stops[0].status, 'unknown');
  assert.equal(m.stops[1].status, 'delayed');
  assert.equal(m.stops[1].expected, null);
  assert.equal(m.stops[1].lateMinutes, null);
  assert.equal(m.stops[2].scheduled, null);
  assert.equal(C.stopStatus(m.stops[1]).text, 'Delayed, no estimate yet');
  assert.equal(C.stopStatus(m.stops[2]).text, 'No estimate');

  const h = structuredClone(HUXLEY_SUR_MID);
  h.previousCallingPoints[0].callingPoint[1].at = 'No report';
  const hm = C.normalizeHuxleyCallingPoints(h, 'SUR');
  assert.equal(hm.stops[1].passed, true);
  assert.equal(hm.stops[1].status, 'no-report');

  for (const empty of [null, {}, { CallingPoints: [] }]) {
    const e = C.normalizeCallingPoints(empty, 'WAT');
    assert.deepEqual(e.stops, []);
    assert.equal(e.lastLocation, null);
    assert.equal(C.summaryText(e), 'No calling points reported for this train.');
  }
  assert.deepEqual(C.normalizeHuxleyCallingPoints({}, 'WAT').stops, []);
});

test('the viewed station is optional and matched case-insensitively', () => {
  assert.equal(C.normalizeCallingPoints(RAILINFO_SUR_MID, null).stops.some((s) => s.isViewing), false);
  assert.equal(C.normalizeCallingPoints(RAILINFO_SUR_MID, 'XXX').stops.some((s) => s.isViewing), false);
  assert.equal(C.normalizeHuxleyCallingPoints(HUXLEY_SUR_MID, 'wim').stops.findIndex((s) => s.isViewing), 5);
});

test('stopStatus always gives text alongside the colour class', () => {
  const m = C.normalizeCallingPoints(RAILINFO_WAT_LATE, 'WAT');
  assert.deepEqual(C.stopStatus(m.stops[1]), { cls: 'serious', icon: '!!', text: 'Expected 21:13, 17 min late' });
  const mid = C.normalizeCallingPoints(RAILINFO_SUR_MID, 'SUR');
  assert.deepEqual(C.stopStatus(mid.stops[0]), { cls: 'good', icon: '✓', text: 'Departed on time' });
  assert.deepEqual(C.stopStatus(mid.stops[4]), { cls: 'good', icon: '✓', text: 'On time' });
  const small = C.makeStop({ name: 'X', crs: 'X', scheduled: '10:00', estimated: '10:03' });
  assert.deepEqual(C.stopStatus(small), { cls: 'warning', icon: '!', text: 'Expected 10:03, 3 min late' });
});

// ---------- Rendering ----------

test('renderCallingPoints escapes API strings and labels stops for screen readers', () => {
  const s = structuredClone(RAILINFO_SUR_MID);
  s.CallingPoints[6].Station.Name = '<img src=x onerror=alert(1)>';
  const html = C.renderCallingPoints(C.normalizeCallingPoints(s, 'SUR'), { uid: 'swr-cp-t' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(html, /<ol class="swr-cp-list" id="swr-cp-t-list" aria-label="Calling points, 7 stops">/);
  assert.equal((html.match(/aria-current="location"/g) || []).length, 1);
  assert.match(html, /Your station/);
  assert.match(html, /Train last reported here/);
  assert.match(html, /<span class="visually-hidden">Scheduled <\/span>20:09/);
  assert.match(html, /Last updated 19:58:53 · from SWR live train info/);
  assert.match(html, /<summary>About this data<\/summary>/);
  assert.match(html, /Huxley2/);
});

test('earlier passed stops are folded behind a toggle, never the viewed or last reported stop', () => {
  const m = C.normalizeCallingPoints(RAILINFO_SUR_MID, 'SUR');
  assert.equal(C.foldIndex(m.stops), 2);
  const folded = C.renderCallingPoints(m, { uid: 'u' });
  assert.equal((folded.match(/<li [^>]*hidden/g) || []).length, 2);
  assert.match(folded, /aria-expanded="false" aria-controls="u-list">Show 2 earlier stops</);
  const open = C.renderCallingPoints(m, { uid: 'u', expanded: true });
  assert.equal((open.match(/<li [^>]*hidden/g) || []).length, 0);
  assert.match(open, /aria-expanded="true"[^>]*>Hide earlier stops</);
  // Nothing passed: nothing to fold.
  assert.doesNotMatch(C.renderCallingPoints(C.normalizeCallingPoints(RAILINFO_WAT_LATE, 'WAT')), /swr-cp-toggle/);
});

test('Huxley source is named in the footer with the train length', () => {
  const html = C.renderCallingPoints(C.normalizeHuxleyCallingPoints(HUXLEY_WAT_LATE, 'WAT'));
  assert.match(html, /10 coaches · Last updated 19:59:34 · from Huxley2 \(National Rail data, unofficial\)/);
});

// ---------- Fetching with fallback ----------

test('fetchService uses railinfo, then falls back to Huxley2', async () => {
  const ok = await C.fetchService({ service: async () => RAILINFO_SUR_MID, huxleyService: async () => { throw new Error('unused'); } }, 'id');
  assert.equal(ok.source, 'railinfo');

  const fb = await C.fetchService({ service: async () => { throw new Error('HTTP 500'); }, huxleyService: async () => HUXLEY_SUR_MID }, 'id');
  assert.equal(fb.source, 'huxley');

  const empty = await C.fetchService({ service: async () => ({ CallingPoints: [] }), huxleyService: async () => HUXLEY_SUR_MID }, 'id');
  assert.equal(empty.source, 'huxley');

  await assert.rejects(
    C.fetchService({ service: async () => { throw new Error('HTTP 500'); }, huxleyService: async () => { throw new Error('HTTP 503'); } }, 'id'),
    /HTTP 500; fallback: HTTP 503/
  );
});

// ---------- Demo fixtures ----------

test('demo route answers railinfo and Huxley service URLs only', () => {
  assert.equal(C.demoRoute('https://railinfo.southwesternrailway.com/journey/departures/WAT', {}), null);
  assert.equal(C.demoRoute('https://api.tfl.gov.uk/Line/south-western-railway/Status'), null);
  const r = C.demoRoute('https://railinfo.southwesternrailway.com/journey/services', { method: 'POST', body: JSON.stringify({ ServiceId: '9138693WATRLMN_' }) });
  assert.equal(r.CallingPoints.length, 19);
  assert.equal(r.CallingPoints[0].ScheduledTime, null);
  const h = C.demoRoute('https://huxley2.azurewebsites.net/service/9138693WATRLMN_');
  assert.equal(h.crs, 'WAT');
  assert.equal(h.subsequentCallingPoints[0].callingPoint.at(-1).crs, 'RDG');
});

test('demo services are consistent across both sources and vary by id', () => {
  const at = '2026-09-27T18:00:00Z';
  const statuses = new Set();
  for (let i = 0; i < 40; i++) {
    const id = `91386${String(i).padStart(2, '0')}WATRLMN_`;
    const r = C.normalizeCallingPoints(C.demoRailinfoService(id, 19 * 60, at), 'CLJ');
    const h = C.normalizeHuxleyCallingPoints(C.demoHuxleyService(id, 19 * 60, at), 'CLJ');
    assert.deepEqual(sameStops(h), sameStops(r), id);
    assert.equal(r.stops[0].crs, 'WAT');
    assert.equal(r.stops.at(-1).crs, 'RDG');
    assert.equal(r.stops.filter((s) => s.isViewing).length, 1);
    r.stops.forEach((s) => statuses.add(s.status));
    if (r.stops.some((s) => s.passed)) assert.ok(r.lastLocation);
  }
  for (const s of ['on-time', 'late', 'cancelled']) assert.ok(statuses.has(s), s);
});

test('demo trains follow the opened board row: its station, time, delay and destination', () => {
  const at = '2026-09-27T18:00:00Z';
  const now = 19 * 60;
  const both = (id, board) => [
    C.normalizeCallingPoints(C.demoRailinfoService(id, now, at, board), board.crs),
    C.normalizeHuxleyCallingPoints(C.demoHuxleyService(id, now, at, board), board.crs),
  ];
  // Down train from Waterloo, 12 minutes from now, 15 late: nothing passed yet.
  for (const m of both('A', { crs: 'WAT', name: 'London Waterloo', scheduled: '19:12', estimated: '19:27', destination: { Name: 'Portsmouth Harbour', CrsCode: 'PMH' } })) {
    assert.equal(m.stops[0].crs, 'WAT');
    assert.equal(m.stops[0].scheduled, '19:12');
    assert.equal(m.stops[0].lateMinutes, 15);
    assert.ok(m.stops[0].isViewing);
    assert.equal(m.stops.at(-1).name, 'Portsmouth Harbour');
    assert.equal(m.stops.some((s) => s.passed), false);
  }
  // Up train seen from Surbiton, due in 3 minutes: earlier stops passed, Surbiton still to come.
  const [r, h] = both('B', { crs: 'SUR', name: 'Surbiton', scheduled: '19:03', estimated: 'On time', destination: { Name: 'London Waterloo', CrsCode: 'WAT' } });
  assert.deepEqual(sameStops(h), sameStops(r));
  const sur = r.stops.findIndex((s) => s.isViewing);
  assert.equal(r.stops[sur].crs, 'SUR');
  assert.equal(r.stops[sur].scheduled, '19:03');
  assert.equal(r.stops[sur].passed, false);
  assert.ok(r.stops[sur - 1].passed && r.stops[sur - 1].isLastReported);
  assert.equal(r.stops.at(-1).crs, 'WAT');
  // Off-route station and a cancelled row.
  const [c] = both('C', { crs: 'WOK', name: 'Woking', scheduled: '19:20', estimated: 'Cancelled', destination: { Name: 'London Waterloo', CrsCode: 'WAT' } });
  assert.equal(c.stops[0].crs, 'WOK');
  assert.equal(c.allCancelled, true);
  // "Delayed" with no estimate.
  const [d] = both('D', { crs: 'CLJ', name: 'Clapham Junction', scheduled: '19:30', estimated: 'Delayed', destination: { Name: 'Guildford', CrsCode: 'GLD' } });
  assert.equal(d.stops.find((s) => s.isViewing).status, 'delayed');
  assert.equal(d.stops.at(-1).name, 'Guildford');
});

test('demoBoardFor finds the opened row through the other demo routes', () => {
  const board = { Station: { Name: 'Surbiton', CrsCode: 'SUR' }, Items: [
    { Id: 'X1', ScheduledTime: '19:03', EstimatedTime: 'On time', Destination: { Name: 'London Waterloo', CrsCode: 'WAT' } },
  ], BusItems: [] };
  const saved = globalThis.SwrApi;
  globalThis.SwrApi = { demoRoutes: [C.demoRoute, (url) => (/journey\/departures\/SUR$/.test(url) ? board : null)] };
  try {
    assert.equal(C.demoBoardFor('X1'), null, 'unknown until the row is opened');
    C.noteDemoView('X1', 'SUR');
    assert.deepEqual(C.demoBoardFor('X1'), { crs: 'SUR', name: 'Surbiton', scheduled: '19:03', estimated: 'On time', destination: { Name: 'London Waterloo', CrsCode: 'WAT' }, bus: false });
    const body = C.demoRoute('https://railinfo.southwesternrailway.com/journey/services', { method: 'POST', body: '{"ServiceId":"X1"}' });
    assert.equal(body.Destination.CrsCode, 'SUR');
    assert.equal(body.ScheduledDeparture, '19:03');
  } finally {
    globalThis.SwrApi = saved;
  }
});
