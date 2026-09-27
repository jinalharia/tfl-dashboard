const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/swr-departures.js');

// ---------------------------------------------------------------------------
// Fixtures: real responses captured on 2026-09-27, trimmed to a few rows.
// ---------------------------------------------------------------------------

const place = (name, crs) => ({ Name: name, CrsCode: crs });
const hxPlace = (name, crs, via = null) => [{ locationName: name, crs, via, futureChangeTo: null, assocIsCancelled: false }];

// GET https://railinfo.southwesternrailway.com/journey/departures/WAT (18:22 UTC)
const RAIL_WAT = {
  Station: place('London Waterloo', 'WAT'),
  GeneratedAt: '2026-09-27T18:22:21.2509989+00:00',
  Items: [
    { Id: '9138605WATRLMN_', Operator: 'South Western Railway', Platform: '23', ScheduledTime: '19:25', EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Hounslow', 'HOU') },
    { Id: '9138966WATRLMN_', Operator: 'South Western Railway', Platform: '4', ScheduledTime: '19:27', EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Hampton Court', 'HMC') },
    { Id: '9143425WATRLMN_', Operator: 'South Western Railway', Platform: null, ScheduledTime: '19:27', EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Hampton Court', 'HMC') },
    { Id: '9138516WATRLMN_', Operator: 'South Western Railway', Platform: '8', ScheduledTime: '19:30', EstimatedTime: '19:45', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Portsmouth Harbour', 'PMH') },
    { Id: '9138478WATRLMN_', Operator: 'South Western Railway', Platform: '6', ScheduledTime: '19:45', EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Salisbury', 'SAL') },
    { Id: '9139035WATRLMN_', Operator: 'South Western Railway', Platform: '9', ScheduledTime: '20:07', EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Basingstoke', 'BSK') },
  ],
  BusItems: [],
};

// GET https://huxley2.azurewebsites.net/departures/WAT/20?expand=true (18:25 UTC; calling points removed)
const HUX_WAT = {
  trainServices: [
    { serviceID: '9138605WATRLMN_', std: '19:25', etd: 'On time', platform: '23', operator: 'South Western Railway', operatorCode: 'SW', length: 10, isCancelled: false, cancelReason: null, delayReason: null, origin: hxPlace('London Waterloo', 'WAT'), destination: hxPlace('Hounslow', 'HOU') },
    { serviceID: '9138966WATRLMN_', std: '19:27', etd: 'On time', platform: '4', operator: 'South Western Railway', operatorCode: 'SW', length: 0, isCancelled: false, cancelReason: null, delayReason: null, origin: hxPlace('London Waterloo', 'WAT'), destination: hxPlace('Hampton Court', 'HMC') },
    // Real Huxley platform was null too; set to "3" here to test filling railinfo's null platform.
    { serviceID: '9143425WATRLMN_', std: '19:27', etd: 'On time', platform: '3', operator: 'South Western Railway', operatorCode: 'SW', length: 10, isCancelled: false, cancelReason: null, delayReason: null, origin: hxPlace('London Waterloo', 'WAT'), destination: hxPlace('Hampton Court', 'HMC') },
    { serviceID: '9138516WATRLMN_', std: '19:30', etd: '19:45', platform: null, operator: 'South Western Railway', operatorCode: 'SW', length: 12, isCancelled: false, cancelReason: null, delayReason: 'This service has been delayed by a passenger being taken ill on a train', origin: hxPlace('London Waterloo', 'WAT'), destination: hxPlace('Portsmouth Harbour', 'PMH') },
    { serviceID: '9138478WATRLMN_', std: '19:45', etd: 'On time', platform: '6', operator: 'South Western Railway', operatorCode: 'SW', length: 3, isCancelled: false, cancelReason: null, delayReason: null, origin: hxPlace('London Waterloo', 'WAT'), destination: hxPlace('Salisbury', 'SAL') },
    // 9139035WATRLMN_ (20:07) is beyond Huxley's 20 rows: no match.
  ],
  busServices: null,
  generatedAt: '2026-09-27T18:25:44.8506991+00:00',
  locationName: 'London Waterloo',
  crs: 'WAT',
  nrccMessages: [{ value: 'Trains running between Havant and Guildford may be cancelled, delayed by up to 50 minutes or revised.' }],
};

// GET https://railinfo.southwesternrailway.com/journey/departures/CLJ (18:42 UTC; 100 items from 3 operators, trimmed)
const RAIL_CLJ = {
  Station: place('Clapham Junction', 'CLJ'),
  GeneratedAt: '2026-09-27T18:42:45.2164855+00:00',
  Items: [
    { Id: '9134446CLPHMJC_', Operator: 'Southern', Platform: '13', ScheduledTime: '18:53', EstimatedTime: '19:45', RouteDirection: 'Departure', Origin: place('London Victoria', 'VIC'), Destination: place('Ore', 'ORE') },
    { Id: '9139151CLPHMJM_', Operator: 'South Western Railway', Platform: '7', ScheduledTime: '19:35', EstimatedTime: '19:50', RouteDirection: 'Departure', Origin: place('Portsmouth Harbour', 'PMH'), Destination: place('London Waterloo', 'WAT') },
    { Id: '9138516CLPHMJM_', Operator: 'South Western Railway', Platform: '9', ScheduledTime: '19:37', EstimatedTime: 'Delayed', RouteDirection: 'Departure', Origin: place('London Waterloo', 'WAT'), Destination: place('Portsmouth Harbour', 'PMH') },
    { Id: '9132291CLPHMJC_', Operator: 'Southern', Platform: '12', ScheduledTime: '19:39', EstimatedTime: 'Cancelled', RouteDirection: 'Departure', Origin: place('Brighton', 'BTN'), Destination: place('London Victoria', 'VIC') },
    { Id: '9143043CLPHMJM_', Operator: 'South Western Railway', Platform: '7', ScheduledTime: '19:40', EstimatedTime: '19:43', RouteDirection: 'Departure', Origin: place('Woking', 'WOK'), Destination: place('London Waterloo', 'WAT') },
    { Id: '9144330CLPHMJ1_', Operator: 'London Overground', Platform: '2', ScheduledTime: '19:44', EstimatedTime: 'Cancelled', RouteDirection: 'Departure', Origin: place('Clapham Junction', 'CLJ'), Destination: place('Dalston Junction', 'DLJ') },
    { Id: '9138479CLPHMJM_', Operator: 'South Western Railway', Platform: '7', ScheduledTime: '19:44', EstimatedTime: '19:52', RouteDirection: 'Departure', Origin: place('Weymouth', 'WEY'), Destination: place('London Waterloo', 'WAT') },
  ],
  BusItems: [],
};

// GET https://huxley2.azurewebsites.net/departures/CLJ/20 (18:42 UTC; mixed SW/SN/LO, trimmed)
const HUX_CLJ = {
  trainServices: [
    { serviceID: '9134446CLPHMJC_', std: '18:53', etd: '19:45', platform: '13', operator: 'Southern', operatorCode: 'SN', length: 8, isCancelled: false, cancelReason: null, delayReason: 'This service has been delayed by a fire next to the track', origin: hxPlace('London Victoria', 'VIC'), destination: hxPlace('Ore', 'ORE') },
    { serviceID: '9139151CLPHMJM_', std: '19:35', etd: '19:50', platform: '7', operator: 'South Western Railway', operatorCode: 'SW', length: 8, isCancelled: false, cancelReason: null, delayReason: 'This service has been delayed by a passenger being taken ill on a train', origin: hxPlace('Portsmouth Harbour', 'PMH'), destination: hxPlace('London Waterloo', 'WAT') },
    { serviceID: '9138516CLPHMJM_', std: '19:37', etd: 'Delayed', platform: '9', operator: 'South Western Railway', operatorCode: 'SW', length: 12, isCancelled: false, cancelReason: null, delayReason: 'This service has been delayed by a passenger being taken ill on a train', origin: hxPlace('London Waterloo', 'WAT'), destination: hxPlace('Portsmouth Harbour', 'PMH') },
    { serviceID: '9132291CLPHMJC_', std: '19:39', etd: 'Cancelled', platform: '12', operator: 'Southern', operatorCode: 'SN', length: 12, isCancelled: true, cancelReason: 'This service has been cancelled because of a fire next to the track', delayReason: null, origin: hxPlace('Brighton', 'BTN'), destination: hxPlace('London Victoria', 'VIC') },
    { serviceID: '9143043CLPHMJM_', std: '19:40', etd: '19:43', platform: '7', operator: 'South Western Railway', operatorCode: 'SW', length: 10, isCancelled: false, cancelReason: null, delayReason: null, origin: hxPlace('Woking', 'WOK'), destination: hxPlace('London Waterloo', 'WAT') },
    { serviceID: '9144330CLPHMJ1_', std: '19:44', etd: 'Cancelled', platform: '2', operator: 'London Overground', operatorCode: 'LO', length: 0, isCancelled: true, cancelReason: 'This service has been cancelled because of a fire on property near the railway', delayReason: null, origin: hxPlace('Clapham Junction', 'CLJ'), destination: hxPlace('Dalston Junction', 'DLJ') },
    { serviceID: '9138479CLPHMJM_', std: '19:44', etd: '19:52', platform: '7', operator: 'South Western Railway', operatorCode: 'SW', length: 6, isCancelled: false, cancelReason: null, delayReason: null, origin: hxPlace('Weymouth', 'WEY'), destination: hxPlace('London Waterloo', 'WAT') },
  ],
  busServices: null,
  generatedAt: '2026-09-27T18:42:44.299812+00:00',
  locationName: 'Clapham Junction',
  crs: 'CLJ',
};

// GET https://railinfo.southwesternrailway.com/journey/departures/SUR (18:59 UTC; BusItems trimmed to one, one train)
const RAIL_SUR = {
  Station: place('Surbiton', 'SUR'),
  GeneratedAt: '2026-09-27T18:59:55.0607912+00:00',
  Items: [
    { Id: '9139040SURBITN_', Operator: 'South Western Railway', Platform: '2', ScheduledTime: '20:47', EstimatedTime: 'Cancelled', RouteDirection: 'Departure', Origin: place('Basingstoke', 'BSK'), Destination: place('London Waterloo', 'WAT') },
  ],
  BusItems: [
    { Id: '9143272SURBITN_', Operator: 'South Western Railway', Platform: 'BUS', ScheduledTime: '20:19', EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: place('Surbiton', 'SUR'), Destination: place('Berrylands', 'BRS') },
  ],
};

// GET https://huxley2.azurewebsites.net/departures/SUR/40 (18:59 UTC; trimmed)
const HUX_SUR = {
  trainServices: [
    { serviceID: '9139040SURBITN_', std: '20:47', etd: 'Cancelled', platform: '2', operator: 'South Western Railway', operatorCode: 'SW', length: 0, isCancelled: true, cancelReason: 'This service has been cancelled because of a passenger being taken ill on a train earlier today', delayReason: null, origin: hxPlace('Basingstoke', 'BSK'), destination: hxPlace('London Waterloo', 'WAT') },
  ],
  busServices: [
    { serviceID: '9143272SURBITN_', std: '20:19', etd: 'On time', platform: 'BUS', operator: 'South Western Railway', operatorCode: 'SW', length: 0, isCancelled: false, cancelReason: null, delayReason: null, serviceType: 1, origin: hxPlace('Surbiton', 'SUR'), destination: hxPlace('Berrylands', 'BRS') },
  ],
  generatedAt: '2026-09-27T18:59:55.6914303+00:00',
  locationName: 'Surbiton',
  crs: 'SUR',
};

const byId = (model, id) => model.rows.concat(model.buses).find((r) => r.serviceId === id);

// ---------------------------------------------------------------------------
// Time and status helpers
// ---------------------------------------------------------------------------

test('toMinutes, minutesBetween and formatMinutes handle midnight', () => {
  assert.equal(D.toMinutes('19:21'), 1161);
  assert.equal(D.toMinutes('On time'), null);
  assert.equal(D.toMinutes('25:00'), null);
  assert.equal(D.minutesBetween('19:30', '19:45'), 15);
  assert.equal(D.minutesBetween('23:55', '00:10'), 15);
  assert.equal(D.minutesBetween('00:05', '23:58'), -7);
  assert.equal(D.minutesBetween('x', '19:00'), null);
  assert.equal(D.formatMinutes(1161), '19:21');
  assert.equal(D.formatMinutes(1440 + 5), '00:05');
  assert.equal(D.formatMinutes(-10), '23:50');
});

test('formatClock shows London time for GeneratedAt', () => {
  assert.equal(D.formatClock('2026-09-27T18:22:21.2509989+00:00'), '19:22'); // BST
  assert.equal(D.formatClock('2026-12-01T18:22:00Z'), '18:22'); // GMT
  assert.equal(D.formatClock(null), null);
  assert.equal(D.formatClock('nonsense'), null);
});

test('classifyEstimate gives every status a text label', () => {
  assert.deepEqual(D.classifyEstimate('19:21', 'On time'), { status: 'on-time', cls: 'good', label: 'On time', expected: '19:21', lateMins: 0 });
  const late = D.classifyEstimate('19:30', '19:45');
  assert.equal(late.status, 'late');
  assert.equal(late.cls, 'serious');
  assert.equal(late.lateMins, 15);
  assert.equal(late.label, 'Exp 19:45, 15 min late');
  assert.equal(D.classifyEstimate('19:40', '19:43').cls, 'warning');
  assert.equal(D.classifyEstimate('23:58', '00:04').lateMins, 6);
  assert.equal(D.classifyEstimate('19:37', 'Delayed').label, 'Delayed');
  assert.equal(D.classifyEstimate('19:39', 'Cancelled').status, 'cancelled');
  assert.equal(D.classifyEstimate('19:39', 'On time', true).status, 'cancelled');
  assert.equal(D.classifyEstimate('19:39', '19:38').status, 'on-time');
  const odd = D.classifyEstimate('19:39', 'No report');
  assert.equal(odd.status, 'unknown');
  assert.equal(odd.label, 'No report');
});

test('coach counts and the short-train heuristic', () => {
  assert.equal(D.coachCount(10), 10);
  assert.equal(D.coachCount(0), null);
  assert.equal(D.coachCount(null), null);
  assert.equal(D.coachCount(undefined), null);
  assert.equal(D.isShortTrain(3), true);
  assert.equal(D.isShortTrain(5), true);
  assert.equal(D.isShortTrain(6), false);
  assert.equal(D.isShortTrain(null), false);
  assert.equal(D.shortTrainText(3), 'Short train (3 coaches), may be busier');
});

test('isSwrOperator by code or name', () => {
  assert.equal(D.isSwrOperator('South Western Railway', null), true);
  assert.equal(D.isSwrOperator('', 'SW'), true);
  assert.equal(D.isSwrOperator('Island Line', 'IL'), true);
  assert.equal(D.isSwrOperator('Southern', 'SN'), false);
  assert.equal(D.isSwrOperator('London Overground', null), false);
});

// ---------------------------------------------------------------------------
// normalizeDepartures
// ---------------------------------------------------------------------------

test('normalizeDepartures joins railinfo Id to Huxley serviceID (Waterloo)', () => {
  const m = D.normalizeDepartures(RAIL_WAT, HUX_WAT);
  assert.equal(m.source, 'railinfo');
  assert.equal(m.huxleyOk, true);
  assert.equal(m.station.crs, 'WAT');
  assert.equal(m.generatedAt, RAIL_WAT.GeneratedAt);
  assert.deepEqual(m.rows.map((r) => r.serviceId), RAIL_WAT.Items.map((i) => i.Id), 'keeps railinfo order');

  const hounslow = byId(m, '9138605WATRLMN_');
  assert.equal(hounslow.status, 'on-time');
  assert.equal(hounslow.coaches, 10);
  assert.equal(hounslow.lengthState, 'known');
  assert.equal(hounslow.short, false);
  assert.equal(hounslow.platform, '23');
  assert.equal(hounslow.platformSource, 'railinfo');
  assert.equal(hounslow.destination.name, 'Hounslow');
  assert.equal(hounslow.matched, true);
  assert.equal(hounslow.reason, null);
});

test('late train carries the expected time, minutes late and the delay reason', () => {
  const r = byId(D.normalizeDepartures(RAIL_WAT, HUX_WAT), '9138516WATRLMN_');
  assert.equal(r.status, 'late');
  assert.equal(r.expected, '19:45');
  assert.equal(r.lateMins, 15);
  assert.equal(r.statusCls, 'serious');
  assert.equal(r.platform, '8', "railinfo's platform wins over Huxley's null");
  assert.equal(r.reason, 'This service has been delayed by a passenger being taken ill on a train');
  assert.equal(r.reasonKind, 'delay');
});

test('short train (3 coaches) is flagged; unknown length (0) is not', () => {
  const m = D.normalizeDepartures(RAIL_WAT, HUX_WAT);
  const salisbury = byId(m, '9138478WATRLMN_');
  assert.equal(salisbury.coaches, 3);
  assert.equal(salisbury.short, true);
  const zero = byId(m, '9138966WATRLMN_');
  assert.equal(zero.coaches, null);
  assert.equal(zero.lengthState, 'unknown');
  assert.equal(zero.short, false);
  assert.equal(D.coachesText(zero), 'Length unknown');
  assert.equal(D.coachesText(salisbury), '3 coaches');
});

test('a null railinfo platform is filled from Huxley', () => {
  const r = byId(D.normalizeDepartures(RAIL_WAT, HUX_WAT), '9143425WATRLMN_');
  assert.equal(r.platform, '3');
  assert.equal(r.platformSource, 'huxley');
});

test('a row missing from Huxley keeps its railinfo data, length unknown', () => {
  const r = byId(D.normalizeDepartures(RAIL_WAT, HUX_WAT), '9139035WATRLMN_');
  assert.equal(r.matched, false);
  assert.equal(r.platform, '9');
  assert.equal(r.status, 'on-time');
  assert.equal(r.coaches, null);
  assert.equal(r.lengthState, 'unknown');
  assert.equal(r.reason, null);
});

test('Huxley failed (null): board still builds, lengths unavailable', () => {
  const m = D.normalizeDepartures(RAIL_WAT, null);
  assert.equal(m.source, 'railinfo');
  assert.equal(m.huxleyOk, false);
  assert.equal(m.rows.length, RAIL_WAT.Items.length);
  assert.ok(m.rows.every((r) => r.lengthState === 'unavailable' && r.coaches === null && !r.short));
  assert.equal(byId(m, '9143425WATRLMN_').platform, null);
  assert.equal(D.coachesText(m.rows[0]), '');
  assert.match(D.renderBoard(m), /Train length unavailable/);
});

test('railinfo failed: the board is built from Huxley alone', () => {
  for (const failed of [null, { Message: 'An error has occurred.' }]) {
    const m = D.normalizeDepartures(failed, HUX_CLJ);
    assert.equal(m.source, 'huxley');
    assert.equal(m.station.name, 'Clapham Junction');
    assert.equal(m.generatedAt, HUX_CLJ.generatedAt);
    const r = byId(m, '9139151CLPHMJM_');
    assert.equal(r.scheduled, '19:35');
    assert.equal(r.expected, '19:50');
    assert.equal(r.status, 'late');
    assert.equal(r.destination.name, 'London Waterloo');
    assert.equal(r.origin.name, 'Portsmouth Harbour');
    assert.equal(r.coaches, 8);
    assert.equal(r.platform, '7');
  }
  assert.match(D.renderBoard(D.normalizeDepartures(null, HUX_CLJ)), /comes from National Rail data via Huxley2/);
});

test('both sources failed', () => {
  const m = D.normalizeDepartures(null, null);
  assert.equal(m.source, 'none');
  assert.deepEqual(m.rows, []);
  assert.match(D.renderBoard(m, { stationName: 'Surbiton' }), /Couldn’t load departures/);
});

test('Clapham Junction: SWR only by default, all operators on request', () => {
  const swr = D.normalizeDepartures(RAIL_CLJ, HUX_CLJ);
  assert.ok(swr.rows.every((r) => r.isSwr));
  assert.deepEqual(swr.rows.map((r) => r.serviceId), ['9139151CLPHMJM_', '9138516CLPHMJM_', '9143043CLPHMJM_', '9138479CLPHMJM_']);
  assert.equal(swr.hiddenCount, 3);
  assert.deepEqual(swr.otherOperators, ['Southern', 'London Overground']);

  const all = D.normalizeDepartures(RAIL_CLJ, HUX_CLJ, { allOperators: true });
  assert.equal(all.rows.length, RAIL_CLJ.Items.length);
  assert.equal(all.hiddenCount, 0);
  assert.equal(all.allOperators, true);
});

test('cancelled and "Delayed" rows at Clapham Junction', () => {
  const m = D.normalizeDepartures(RAIL_CLJ, HUX_CLJ, { allOperators: true });
  const cancelled = byId(m, '9132291CLPHMJC_');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.statusLabel, 'Cancelled');
  assert.equal(cancelled.statusCls, 'critical');
  assert.equal(cancelled.reason, 'This service has been cancelled because of a fire next to the track');
  assert.equal(cancelled.reasonKind, 'cancel');
  assert.equal(cancelled.short, false);

  const delayed = byId(m, '9138516CLPHMJM_');
  assert.equal(delayed.status, 'delayed');
  assert.equal(delayed.expected, null);
  assert.equal(delayed.statusLabel, 'Delayed');
  assert.equal(delayed.reasonKind, 'delay');

  assert.equal(byId(m, '9138479CLPHMJM_').coaches, 6);
  assert.equal(byId(m, '9138479CLPHMJM_').short, false);
  assert.deepEqual(D.boardSummary(m.rows), { cancelled: 2, late: 5, short: 0 });
});

test('replacement buses (BusItems) come out as their own list', () => {
  const m = D.normalizeDepartures(RAIL_SUR, HUX_SUR);
  assert.equal(m.rows.length, 1);
  assert.equal(m.buses.length, 1);
  const bus = m.buses[0];
  assert.equal(bus.isBus, true);
  assert.equal(bus.platform, null, '"BUS" is not a platform');
  assert.equal(bus.lengthState, 'n/a');
  assert.equal(bus.destination.name, 'Berrylands');
  assert.equal(m.rows[0].reason, 'This service has been cancelled because of a passenger being taken ill on a train earlier today');
  assert.match(D.renderBoard(m), /Replacement buses/);

  const fromHuxley = D.normalizeDepartures(null, HUX_SUR);
  assert.equal(fromHuxley.buses.length, 1);
  assert.equal(fromHuxley.buses[0].isBus, true);
});

test('limit trims rows but total counts them all', () => {
  const m = D.normalizeDepartures(RAIL_WAT, HUX_WAT, { limit: 2 });
  assert.equal(m.rows.length, 2);
  assert.equal(m.total, 6);
});

test('tolerates junk inside the responses', () => {
  const m = D.normalizeDepartures({ Items: [null, { Id: 'x', ScheduledTime: '10:00', EstimatedTime: 'On time' }] }, { trainServices: null });
  assert.equal(m.rows.length, 0, 'no operator: not SWR');
  const all = D.normalizeDepartures({ Items: [null, { Id: 'x', ScheduledTime: '10:00', EstimatedTime: 'On time' }] }, { trainServices: null }, { allOperators: true });
  assert.equal(all.rows.length, 1);
  assert.equal(all.rows[0].destination.name, '');
  assert.equal(all.rows[0].lengthState, 'unknown');
});

// ---------------------------------------------------------------------------
// Rendering (strings only; no DOM needed)
// ---------------------------------------------------------------------------

test('renderBoard implements the S2 row contract', () => {
  const html = D.renderBoard(D.normalizeDepartures(RAIL_WAT, HUX_WAT), { stationName: 'London Waterloo', crs: 'WAT' });
  for (const i of RAIL_WAT.Items) {
    assert.ok(html.includes(`class="swr-dep-more link" data-service-id="${i.Id}"`), `button for ${i.Id}`);
    assert.match(html, new RegExp(`<div class="swr-dep-detail" id="[^"]+" data-service-id="${i.Id}" hidden></div>`));
  }
  assert.match(html, /Short train \(3 coaches\), may be busier/);
  assert.match(html, /dashboard heuristic/);
  assert.match(html, /About this data/);
  assert.match(html, /unofficial/);
  assert.match(html, /volunteer-run/);
  assert.match(html, /Exp 19:45, 15 min late/);
  assert.match(html, /status status-serious/);
  assert.match(html, /updated 19:22/);
});

test('renderBoard escapes API strings', () => {
  const evil = JSON.parse(JSON.stringify(RAIL_WAT));
  evil.Items[0].Destination.Name = '<img src=x onerror=alert(1)>';
  evil.Items[0].Id = '"><script>';
  evil.Items[1].Destination.Name = 'Ore & "Hastings" <3';
  const html = D.renderBoard(D.normalizeDepartures(evil, null));
  assert.ok(!html.includes('<img'), 'tags in a text field are dropped');
  assert.ok(!html.includes('"><script>'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(html.includes('Ore &amp; &quot;Hastings&quot; &lt;3'));
});

test('renderBoard shows the operator toggle and hidden count at shared stations', () => {
  const html = D.renderBoard(D.normalizeDepartures(RAIL_CLJ, HUX_CLJ));
  assert.match(html, /class="swr-dep-all"/);
  assert.match(html, /3 trains by Southern and London Overground hidden/);
  const waterloo = D.renderBoard(D.normalizeDepartures(RAIL_WAT, HUX_WAT));
  assert.ok(!waterloo.includes('swr-dep-all'), 'no toggle when every train is SWR');
});

// ---------------------------------------------------------------------------
// Demo fixtures
// ---------------------------------------------------------------------------

test('demoRoute answers railinfo and Huxley departures URLs with real shapes', () => {
  const rail = D.demoRoute('https://railinfo.southwesternrailway.com/journey/departures/WAT');
  const hux = D.demoRoute('https://huxley2.azurewebsites.net/departures/WAT/40');
  assert.equal(rail.Station.CrsCode, 'WAT');
  assert.ok(Array.isArray(rail.Items) && rail.Items.length >= 10);
  assert.ok(Array.isArray(rail.BusItems));
  assert.ok(Array.isArray(hux.trainServices));
  assert.ok(Array.isArray(hux.nrccMessages));
  const m = D.normalizeDepartures(rail, hux);
  assert.ok(m.rows.some((r) => r.short));
  assert.ok(m.rows.some((r) => r.status === 'late'));
  assert.ok(m.rows.some((r) => r.status === 'cancelled' && r.reason));
  assert.ok(m.rows.some((r) => r.platformSource === 'huxley'));
  assert.ok(m.rows.some((r) => !r.matched));

  const clj = D.normalizeDepartures(
    D.demoRoute('https://railinfo.southwesternrailway.com/journey/departures/CLJ'),
    D.demoRoute('https://huxley2.azurewebsites.net/departures/CLJ/40?expand=true'));
  assert.ok(clj.hiddenCount > 0);
  const sur = D.demoRoute('https://railinfo.southwesternrailway.com/journey/departures/SUR');
  assert.ok(sur.BusItems.length > 0);
  assert.ok(D.demoRoute('https://railinfo.southwesternrailway.com/journey/departures/WOK').Items.length > 0);
  assert.equal(D.demoRoute('https://railinfo.southwesternrailway.com/journey/services'), null);
  assert.equal(D.demoRoute('https://api.tfl.gov.uk/Line/Mode/tube/Status'), null);
  assert.equal(D.demoRoute('https://huxley2.azurewebsites.net/departures/WAT/3').trainServices.length, 3);
});
