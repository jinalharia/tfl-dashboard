const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/swr-status.js');

// GET https://www.southwesternrailway.com/api/LiveInformationBoard (2026-09-27 ~19:20 BST, all 13 groups)
const LIVE_BOARD = [
  { RouteName: 'Kingston/Shepperton', StatusText: 'Good Service', StatusId: '0' },
  { RouteName: 'Chessington/Epsom', StatusText: 'Good Service', StatusId: '0' },
  { RouteName: 'Suburban Lines', StatusText: 'Major Disruption', StatusId: '2' },
  { RouteName: 'Surbiton/Cobham', StatusText: 'Good Service', StatusId: '0' },
  { RouteName: 'Hounslow Loop', StatusText: 'Special Timetable', StatusId: '4' },
  { RouteName: 'Reading/Windsor Lines', StatusText: 'Special Timetable', StatusId: '4' },
  { RouteName: 'South Western Mainline', StatusText: 'Special Timetable', StatusId: '4' },
  { RouteName: 'West of England', StatusText: 'Major Disruption', StatusId: '2' },
  { RouteName: 'Portsmouth Direct', StatusText: 'Major Disruption', StatusId: '2' },
  { RouteName: 'South Hampshire Locals', StatusText: 'Special Timetable', StatusId: '4' },
  { RouteName: 'Romsey/Salisbury', StatusText: 'Special Timetable', StatusId: '4' },
  { RouteName: 'Ascot/Guildford', StatusText: 'Planned Closure', StatusId: '3' },
  { RouteName: 'Island Line', StatusText: 'Good Service', StatusId: '0' },
];

// GET https://www.southwesternrailway.com/api/RainbowBoard (same evening; every Description from a fresh fetch)
const RAINBOW_DESCRIPTIONS = [
  'Waterloo to Alton', 'Alton to Waterloo', 'Winchester to Southampton Central/Bournemouth', 'Southampton Central/Bournemouth to Winchester',
  'Waterloo to Portsmouth via Guildford', 'Portsmouth to Waterloo via Guildford', 'Waterloo to Reading via Richmond', 'Reading to Waterloo via Richmond',
  'Waterloo to Dorking', 'Dorking to Waterloo', 'Waterloo to Guildford via Epsom', 'Guildford to Waterloo via Epsom',
  'Southampton Central to Portsmouth & Southsea', 'Portsmouth & Southsea to Southampton Central', 'Woking to Waterloo (Stopping)',
  'Waterloo to Guildford via Cobham', 'Guildford to Waterloo via Cobham', 'Waterloo to Shepperton', 'Shepperton to Waterloo',
  'Waterloo to Hampton Court', 'Hampton Court to Waterloo', 'Waterloo to London Waterloo via Kingston and Twickenham',
  'Waterloo to London Waterloo via Twickenham and Kingston', 'Waterloo to Salisbury/Yeovil/Exeter St Davids',
  'Salisbury/Yeovil/Exeter St Davids to Waterloo', 'Waterloo to Basingstoke (Stopping)', 'Basingstoke to Waterloo (Stopping)',
  'Waterloo to Chessington South', 'Chessington South to Waterloo', 'Waterloo to Weybridge via Staines', 'Weybridge to Waterloo via Staines',
  'Waterloo to Windsor & Eton Riverside', 'Windsor & Eton Riverside to Waterloo', 'Waterloo to London Waterloo via Richmond and Brentford',
  'Waterloo to London Waterloo via Brentford and Richmond', 'Waterloo to Weymouth', 'Weymouth to Waterloo',
  'Waterloo to Portsmouth Harbour via Basingstoke', 'Portsmouth Harbour to Waterloo via Basingstoke', 'Waterloo to Aldershot via Ascot',
  'Aldershot to Waterloo via Ascot', 'Ascot to Aldershot', 'Aldershot to Ascot', 'Guildford to Farnham', 'Farnham to Guildford',
  'Romsey Rounders', 'Lymington Branch', 'Lymington Branch', 'Island Line',
];

// GET https://www.southwesternrailway.com/api/RainbowBoard (trimmed to a few rows)
const RAINBOW = {
  LastUpdated: '2026-09-27T18:19:00+00:00',
  Lines: [
    { Description: 'Waterloo to Portsmouth via Guildford', Status: 'Good Service', Incidents: ' ' },
    { Description: 'Portsmouth to Waterloo via Guildford', Status: 'Minor Disruption', Incidents: 'Services may be disrupted due to a passenger being taken ill on a train between Godalming and Guildford.' },
    { Description: 'Woking to Waterloo (Stopping)', Status: 'Minor Disruption', Incidents: ' ' },
    { Description: 'Waterloo to Salisbury/Yeovil/Exeter St Davids', Status: 'Good Service', Incidents: 'Services may be disrupted due to a broken down train between Salisbury and Yeovil Junctio.' },
    { Description: 'Lymington Branch', Status: 'Good Service', Incidents: ' ' },
    { Description: 'Lymington Branch', Status: 'Good Service', Incidents: ' ' },
    { Description: 'Island Line', Status: 'Good Service', Incidents: ' ' },
  ],
};

// GET https://www.southwesternrailway.com/api/overallstatus (Details and FurtherInfo trimmed)
const OVERALL = {
  IsOverwriteFeedStatus: false,
  Status: 'MajorDisruption',
  Summary: 'Alterations to services at Yeovil Junction',
  LineUpdates: [
    {
      Summary: 'Cancellations to services at Godalming',
      Details: "Following a passenger being taken ill on a train earlier today at Godalming all lines have now reopened.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What's Going On:</strong></span><br />Train services running through this station are returning to normal.<br /><br />Long Distance &amp; Mainline Services",
      FurtherInfo: 'An update will follow within the next 2 hours.',
      MarketingInfo: '',
      OperatorCode: 'SW',
      UpdateType: 'line',
      UpdatedTime: '19:13:05 27/09/2026',
      IncidentId: '1297592328',
      Colour: 'Code Yellow',
    },
    {
      Summary: 'Alterations to services at Yeovil Junction',
      Details: "Following a broken down train earlier today at Yeovil Junction all lines have now reopened.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What's Going On:</strong></span><br />Train services running through this station may be delayed by up to 30 minutes or revised.",
      FurtherInfo: 'Have you been delayed? Please see https://www.southwesternrailway.com/contact-and-help/refunds-and-compensation for our compensation policy.',
      MarketingInfo: '',
      OperatorCode: 'SW',
      UpdateType: 'line',
      UpdatedTime: '19:18:22 27/09/2026',
      IncidentId: '1297592241',
      Colour: 'Code Red',
    },
  ],
};

// GET https://huxley2.azurewebsites.net/departures/WAT/20?expand=true → nrccMessages (trimmed to two)
const HUXLEY_WAT = {
  locationName: 'London Waterloo',
  crs: 'WAT',
  nrccMessages: [
    { value: 'Trains between Clapham Junction and London Victoria / Imperial Wharf / Denmark Hill may be cancelled, severely delayed by up to&nbsp;60 minutes, diverted&nbsp;or revised. More details can be found in the Disruptions area of the <a href="http://https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/">National Rail website.</a>' },
    { value: 'Trains running between Havant and Guildford may be cancelled, delayed by up to 50 minutes or revised. Latest information can be found in the <a href="https://www.nationalrail.co.uk/service-disruptions/godalming-20260927/">Disruptions area of the National Rail website.</a>' },
  ],
};

// GET https://api.tfl.gov.uk/Line/south-western-railway/Status (trimmed)
const TFL_SWR = [{
  id: 'south-western-railway',
  name: 'South Western Railway',
  modeName: 'national-rail',
  lineStatuses: [{
    statusSeverity: 0,
    statusSeverityDescription: 'Special Service',
    reason: 'https://www.nationalrail.co.uk/service-disruptions/overton-20260327/',
    disruption: { category: 'Information', description: 'https://www.nationalrail.co.uk/service-disruptions/overton-20260327/' },
  }],
}];

test('route status classes: known ids, then text for unknown ids', () => {
  assert.equal(S.routeStatusClass('0', 'Good Service'), 'good');
  assert.equal(S.routeStatusClass('1', 'Minor Disruption'), 'warning');
  assert.equal(S.routeStatusClass('2', 'Major Disruption'), 'critical');
  assert.equal(S.routeStatusClass('3', 'Planned Closure'), 'serious');
  assert.equal(S.routeStatusClass('4', 'Special Timetable'), 'info');
  assert.equal(S.routeStatusClass('7', 'Severe Delays'), 'critical');
  assert.equal(S.routeStatusClass('9', 'Minor Delays'), 'warning');
  assert.equal(S.routeStatusClass(null, 'Good Service'), 'good');
  assert.equal(S.routeStatusClass('99', 'Something new'), 'info');
  assert.equal(S.routeStatusClass('', ''), 'info');
});

test('every real RainbowBoard description has a route group, and the groups exist on the LiveInformationBoard', () => {
  const groupNames = new Set(LIVE_BOARD.map((g) => g.RouteName));
  const lines = RAINBOW_DESCRIPTIONS.map((d) => ({ Description: d, Status: 'Good Service', Incidents: ' ' }));
  const groups = S.normalizeRouteGroups(LIVE_BOARD, { Lines: lines });
  assert.equal(groups.length, 13);
  assert.ok(!groups.some((g) => g.other), 'nothing should land in Other routes');
  for (const name of Object.keys(S.ROUTE_GROUPS)) assert.ok(groupNames.has(name), name);
  // 49 rows, one exact duplicate ("Lymington Branch" twice) dropped.
  assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), 48);
  // Every group has at least one service.
  for (const g of groups) assert.ok(g.rows.length > 0, g.name);
});

test('normalizeRouteGroups: statuses, worst first, incidents and blanks', () => {
  const groups = S.normalizeRouteGroups(LIVE_BOARD, RAINBOW);
  assert.equal(groups.length, 13);
  // Worst first (critical), SWR's order within a class.
  assert.deepEqual(groups.slice(0, 3).map((g) => g.name), ['Suburban Lines', 'West of England', 'Portsmouth Direct']);
  assert.equal(groups[3].name, 'Ascot/Guildford');
  assert.equal(groups[3].cls, 'serious');
  assert.equal(groups.at(-1).name, 'Island Line');

  const pd = groups.find((g) => g.name === 'Portsmouth Direct');
  assert.equal(pd.statusText, 'Major Disruption');
  assert.equal(pd.statusId, 2);
  assert.equal(pd.rows.length, 2);
  assert.equal(pd.disrupted, 1);
  const up = pd.rows.find((r) => r.description === 'Portsmouth to Waterloo via Guildford');
  assert.equal(up.cls, 'warning');
  assert.match(up.incident, /passenger being taken ill/);
  // " " means no incident.
  assert.equal(pd.rows.find((r) => r.description === 'Waterloo to Portsmouth via Guildford').incident, '');

  // A Good Service row can still carry an incident.
  const woe = groups.find((g) => g.name === 'West of England');
  assert.equal(woe.rows[0].cls, 'good');
  assert.match(woe.rows[0].incident, /broken down train/);
  assert.equal(woe.disrupted, 0);

  assert.equal(groups.find((g) => g.name === 'South Hampshire Locals').rows.length, 1); // duplicate dropped
  assert.equal(groups.find((g) => g.name === 'Kingston/Shepperton').rows.length, 0);
});

test('normalizeRouteGroups: unmapped services go to "Other routes", last', () => {
  const groups = S.normalizeRouteGroups(LIVE_BOARD, {
    Lines: [
      { Description: 'Brockenhurst to Lymington Pier', Status: 'Major Disruption', Incidents: 'Replacement buses' },
      { Description: '  island   line ', Status: 'Good Service', Incidents: ' ' },
    ],
  });
  assert.equal(groups.length, 14);
  const other = groups.at(-1);
  assert.equal(other.name, S.OTHER_GROUP);
  assert.equal(other.other, true);
  assert.equal(other.cls, 'critical');
  assert.equal(other.statusText, 'Major Disruption');
  assert.equal(other.rows[0].incident, 'Replacement buses');
  assert.equal(groups.find((g) => g.name === 'Island Line').rows.length, 1); // matched despite spacing/case
});

test('normalizeRouteGroups copes with a missing board on either side', () => {
  assert.deepEqual(S.normalizeRouteGroups(null, null), []);
  const onlyBoard = S.normalizeRouteGroups(LIVE_BOARD, undefined);
  assert.equal(onlyBoard.length, 13);
  assert.ok(onlyBoard.every((g) => g.rows.length === 0));
  // No LiveInformationBoard: groups are built from the mapped rows, with their worst row's status.
  const onlyRows = S.normalizeRouteGroups(undefined, RAINBOW);
  const pd = onlyRows.find((g) => g.name === 'Portsmouth Direct');
  assert.equal(pd.cls, 'warning');
  assert.equal(pd.statusText, 'Minor Disruption');
  assert.equal(onlyRows[0].cls, 'warning');
  // A malformed StatusId is kept as null rather than NaN.
  assert.equal(S.normalizeRouteGroups([{ RouteName: 'X', StatusText: 'Minor Delays', StatusId: 'n/a' }], null)[0].statusId, null);
});

test('parseSwrDateTime reads SWR times as Europe/London', () => {
  assert.equal(S.parseSwrDateTime('19:18:22 27/09/2026').toISOString(), '2026-09-27T18:18:22.000Z'); // BST
  assert.equal(S.parseSwrDateTime('10:00:00 15/01/2026').toISOString(), '2026-01-15T10:00:00.000Z'); // GMT
  assert.equal(S.parseSwrDateTime('09:05 29/03/2026').toISOString(), '2026-03-29T08:05:00.000Z'); // after the clocks go forward
  assert.equal(S.parseSwrDateTime('2026-09-27T18:19:00+00:00').toISOString(), '2026-09-27T18:19:00.000Z');
  assert.equal(S.parseSwrDateTime('25:00:00 27/09/2026'), null);
  assert.equal(S.parseSwrDateTime(''), null);
  assert.equal(S.parseSwrDateTime('yesterday'), null);
});

test('normalizeIncidents maps Colour to severity and sorts most severe first', () => {
  const inc = S.normalizeIncidents(OVERALL);
  assert.equal(inc.status, 'MajorDisruption');
  assert.equal(inc.statusLabel, 'Major disruption');
  assert.equal(inc.cls, 'critical');
  assert.equal(inc.summary, 'Alterations to services at Yeovil Junction');
  assert.equal(inc.incidents.length, 2);
  const [red, yellow] = inc.incidents;
  assert.equal(red.id, '1297592241');
  assert.equal(red.severity, 'major');
  assert.equal(red.cls, 'critical');
  assert.equal(red.severityLabel, 'Major disruption');
  assert.equal(red.updated.toISOString(), '2026-09-27T18:18:22.000Z');
  assert.match(red.detailsHtml, /<br \/>/); // raw HTML is kept for render time
  assert.equal(yellow.severity, 'minor');
  assert.equal(yellow.cls, 'warning');

  assert.equal(S.normalizeIncidents(null), null);
  const good = S.normalizeIncidents({ Status: 'GoodService', Summary: '', LineUpdates: [] });
  assert.equal(good.cls, 'good');
  assert.deepEqual(good.incidents, []);
  const odd = S.normalizeIncidents({ LineUpdates: [{ Summary: 'x', Colour: 'Code Purple', UpdatedTime: '' }, { Summary: 'x' }, null] });
  assert.equal(odd.incidents.length, 1); // same summary without an id counts once
  assert.equal(odd.incidents[0].severity, 'unknown');
  assert.equal(odd.incidents[0].updated, null);
});

test('normalizeNrccMessages keeps raw HTML, dropping blanks and repeats', () => {
  const msgs = S.normalizeNrccMessages(HUXLEY_WAT);
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].html, /http:\/\/https:\/\//);
  assert.deepEqual(S.normalizeNrccMessages({ nrccMessages: [{ value: '' }, { value: '<p> </p>' }, { value: 'A' }, { value: '<b>A</b>' }] }), [{ html: 'A' }]);
  assert.deepEqual(S.normalizeNrccMessages({ nrccMessages: null }), []);
  assert.deepEqual(S.normalizeNrccMessages(null), []);
});

test('snapshotAge flags snapshots older than 45 minutes', () => {
  const now = new Date('2026-09-27T19:00:00Z');
  assert.deepEqual(S.snapshotAge('2026-09-27T18:30:00Z', now), { date: new Date('2026-09-27T18:30:00Z'), minutes: 30, stale: false });
  assert.equal(S.snapshotAge('2026-09-27T18:15:00Z', now).stale, false); // exactly 45
  assert.equal(S.snapshotAge('2026-09-27T18:14:00Z', now).stale, true);
  assert.equal(S.snapshotAge('2026-09-27T19:02:00Z', now).minutes, 0); // clock skew
  assert.deepEqual(S.snapshotAge(null, now), { date: null, minutes: null, stale: true });
  assert.equal(S.snapshotAge('garbage', now).stale, true);
});

test('safeHref repairs http://https:// and keeps only allowed https hosts', () => {
  assert.equal(S.safeHref('http://https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/'), 'https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/');
  assert.equal(S.safeHref('http://www.southwesternrailway.com/x'), 'https://www.southwesternrailway.com/x');
  assert.equal(S.safeHref('https://tfl.gov.uk/'), 'https://tfl.gov.uk/');
  assert.equal(S.safeHref('http://www.traveline.info/'), null);
  assert.equal(S.safeHref('javascript:alert(1)'), null);
  assert.equal(S.safeHref('https://nationalrail.co.uk.evil.example/'), null);
  assert.equal(S.safeHref('https://user@www.nationalrail.co.uk/'), null);
  assert.equal(S.safeHref(''), null);
});

test('swrHeadline reuses TfL status normalisation and turns a bare URL reason into a link', () => {
  const h = S.swrHeadline(TFL_SWR);
  assert.equal(h.cls, 'info');
  assert.equal(h.description, 'Special Service');
  assert.deepEqual(h.reasons, []);
  assert.deepEqual(h.links, [{ text: 'National Rail details', href: 'https://www.nationalrail.co.uk/service-disruptions/overton-20260327/' }]);

  // Also takes the Map from TflApi's getLineStatuses().
  const T = require('../js/tfl-api.js');
  assert.deepEqual(S.swrHeadline(T.normalizeStatuses(TFL_SWR)), h);

  const text = S.swrHeadline([{ id: 'south-western-railway', lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays', reason: 'Delays between Woking and Guildford.' }] }]);
  assert.equal(text.cls, 'warning');
  assert.deepEqual(text.reasons, ['Delays between Woking and Guildford.']);
  assert.deepEqual(text.links, []);
  // A bare URL to a host we don't link to stays as text.
  assert.deepEqual(S.swrHeadline({ cls: 'info', description: 'x', reasons: ['https://example.com/a'] }).reasons, ['https://example.com/a']);
  assert.equal(S.swrHeadline(new Map()), null);
});

test('htmlParagraphs (local fallback) splits paragraphs, decodes entities and keeps safe links', () => {
  const paras = S.htmlParagraphs(OVERALL.LineUpdates[0].Details);
  assert.equal(paras[0].text, 'Following a passenger being taken ill on a train earlier today at Godalming all lines have now reopened.');
  assert.equal(paras[1].text, "What's Going On:\nTrain services running through this station are returning to normal.");
  assert.equal(paras[2].text, 'Long Distance & Mainline Services');

  const msg = S.htmlParagraphs(HUXLEY_WAT.nrccMessages[0].value);
  assert.equal(msg.length, 1);
  assert.match(msg[0].text, /up to 60 minutes, diverted or revised\. .*National Rail website\.$/);
  assert.deepEqual(msg[0].links, [{ text: 'National Rail website.', href: 'https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/' }]);

  const hostile = S.htmlParagraphs('<script>alert(1)</script><img src=x onerror=alert(1)>Hi <a href="javascript:alert(1)">there</a>');
  assert.deepEqual(hostile, [{ text: 'Hi there', links: [] }]);
});

test('adaptParagraphs accepts the likely htmlToText shapes', () => {
  assert.deepEqual(S.adaptParagraphs('One\n\nTwo'), [{ text: 'One', links: [] }, { text: 'Two', links: [] }]);
  assert.deepEqual(S.adaptParagraphs(['One', '']), [{ text: 'One', links: [] }]);
  assert.deepEqual(
    S.adaptParagraphs([{ text: 'See', links: [{ text: 'NR', href: 'http://https://www.nationalrail.co.uk/a' }, { text: 'bad', href: 'https://evil.example/' }] }]),
    [{ text: 'See', links: [{ text: 'NR', href: 'https://www.nationalrail.co.uk/a' }] }]
  );
  assert.deepEqual(S.adaptParagraphs(null), []);
});

test('htmlParagraphs prefers SwrApi.htmlToText when it exists', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'SwrApi');
  const prev = globalThis.SwrApi;
  globalThis.SwrApi = { htmlToText: () => [{ text: 'from S0', links: [] }] };
  try {
    assert.deepEqual(S.htmlParagraphs('<p>x</p>'), [{ text: 'from S0', links: [] }]);
    globalThis.SwrApi = { htmlToText: () => { throw new Error('boom'); } };
    assert.deepEqual(S.htmlParagraphs('<p>x</p>'), [{ text: 'x', links: [] }]);
  } finally {
    if (had) globalThis.SwrApi = prev;
    else delete globalThis.SwrApi;
  }
});

test('renderStatusHtml without a snapshot: TfL headline and station messages only', () => {
  const html = S.renderStatusHtml({
    headline: S.swrHeadline(TFL_SWR),
    snapshot: null,
    snapshotLoaded: true,
    station: { crs: 'WAT', name: 'London Waterloo' },
    messages: S.normalizeNrccMessages(HUXLEY_WAT),
  }, new Date('2026-09-27T18:30:00Z'));
  assert.match(html, /Special Service/);
  assert.match(html, /href="https:\/\/www\.nationalrail\.co\.uk\/service-disruptions\/overton-20260327\/"[^>]*>National Rail details</);
  assert.match(html, /Status by route group and SWR's incident details aren't available here/);
  assert.match(html, /National Rail messages for London Waterloo/);
  assert.match(html, /clapham-junction-20260927/);
  assert.doesNotMatch(html, /http:\/\/https:/);
  assert.doesNotMatch(html, /swr-st-groups/);
  assert.match(html, /About this data/);
  assert.match(html, /Huxley2, an unofficial/);
});

test('renderStatusHtml with a snapshot: groups, incidents, as-of time, stale flag, and escaping', () => {
  const now = new Date('2026-09-27T19:30:00Z');
  const snapshot = {
    fetchedAt: '2026-09-27T18:20:00Z',
    errors: {},
    overallstatus: { ...OVERALL, LineUpdates: [{ ...OVERALL.LineUpdates[1], Summary: '<img src=x onerror=alert(1)>' }] },
    liveInformationBoard: LIVE_BOARD,
    rainbowBoard: RAINBOW,
  };
  const html = S.renderStatusHtml({ headline: null, headlineError: new Error('TfL API returned 500'), snapshot, snapshotLoaded: true, station: null }, now);
  assert.match(html, /Status unavailable/);
  assert.match(html, /Status by route group/);
  assert.match(html, /as of 19:20 \(1 h 10 min ago\)/);
  assert.match(html, /May be out of date/);
  // Status shown in words next to the colour.
  assert.match(html, /status-critical"><span class="status-icon" aria-hidden="true">✕<\/span>Major Disruption/);
  assert.match(html, /1 of 2 services not running normally/);
  assert.match(html, /Major disruption<\/span><span class="swr-st-isum">&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /What&#39;s Going On:/);
  assert.match(html, /taken at 19:20 \(1 h 10 min ago\)/);
  assert.doesNotMatch(html, /National Rail messages for/); // no station yet

  const fresh = S.renderStatusHtml({ headline: S.swrHeadline(TFL_SWR), snapshot: { ...snapshot, fetchedAt: '2026-09-27T19:20:00Z', errors: { rainbowBoard: 'timeout' } }, snapshotLoaded: true, station: null }, now);
  assert.doesNotMatch(fresh, /May be out of date/);
  assert.match(fresh, /Missing from this snapshot: rainbowBoard/);
});

test('demo fixture: status.json in the S7 format, answered only for that path', () => {
  const now = new Date('2026-09-27T18:30:00Z');
  const snap = S.demoStatusSnapshot(now);
  assert.deepEqual(Object.keys(snap).sort(), ['errors', 'fetchedAt', 'liveInformationBoard', 'overallstatus', 'rainbowBoard']);
  assert.equal(S.snapshotAge(snap.fetchedAt, now).stale, false);
  const groups = S.normalizeRouteGroups(snap.liveInformationBoard, snap.rainbowBoard);
  assert.equal(groups.length, 13);
  assert.ok(!groups.some((g) => g.other));
  const inc = S.normalizeIncidents(snap.overallstatus);
  assert.equal(inc.incidents.length, 2);
  assert.equal(inc.incidents[0].updated.toISOString(), '2026-09-27T18:10:00.000Z');

  assert.ok(S.demoRoute('data/swr/status.json'));
  assert.ok(S.demoRoute('https://example.github.io/tfl-dashboard/data/swr/status.json?t=1'));
  assert.equal(S.demoRoute('data/swr/performance.json'), null);
  assert.equal(S.demoRoute('https://huxley2.azurewebsites.net/departures/WAT/40'), null);
});

test('the module loads in Node without window and exposes its registration object', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(S.module.id, 'status');
  assert.equal(typeof S.module.onStation, 'function');
  assert.equal(typeof S.module.refresh, 'function');
});
