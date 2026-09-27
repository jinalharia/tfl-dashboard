const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../js/swr-api.js');
const G = require('../scripts/swr-stations.js');
const SWR_STATIONS = require('../js/swr-stations.js');

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------

// GET https://huxley2.azurewebsites.net/departures/WAT/20?expand=true → nrccMessages[] (2026-09-27)
const NRCC = [
  { value: 'Trains between Clapham Junction and London Victoria / Imperial Wharf / Denmark Hill may be cancelled, severely delayed by up to&nbsp;60 minutes, diverted&nbsp;or revised. More details can be found in the Disruptions area of the <a href="http://https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/">National Rail website.</a>' },
  { value: 'Trains running between Havant and Guildford may be cancelled, delayed by up to 50 minutes or revised. Latest information can be found in the <a href="https://www.nationalrail.co.uk/service-disruptions/godalming-20260927/">Disruptions area of the National Rail website.</a>' },
];
// GET https://huxley2.azurewebsites.net/departures/CLJ/20 → nrccMessages[1] (plain text, no HTML)
const NRCC_PLAIN = { value: 'The lifts are out of order between platform 15 and 16 and the rest of the station at Clapham Junction station.' };

// GET https://www.southwesternrailway.com/api/overallstatus → LineUpdates[0].Details (trimmed), 2026-09-27
const DETAILS = "Following a broken down train earlier today at Yeovil Junction all lines have now reopened.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What's Going On:</strong></span><br />Train services running through this station may be delayed by up to 30 minutes or revised. Disruption is expected until the end of the day.<br /><br />Long Distance &amp; Mainline Services<br />In order to claim for this, you will need to provide the following:<br />- Full contact details<br />- The time and date of your journey<br /><br />If you need any help with your journey, please speak to a member of staff or use a station help point. <br /><br />We are very sorry for any disruption to your journey.";

// Same endpoint → LineUpdates[0].FurtherInfo (trimmed): plain text with bare URLs
const FURTHER = 'If you would prefer to use local buses to continue your journey please check Traveline (http://www.traveline.info/) - South Western Railway tickets are not valid on local buses unless stated above.  Have you been delayed? Please see https://www.southwesternrailway.com/contact-and-help/refunds-and-compensation for our compensation policy.';

test('htmlToText repairs the doubled http://https:// link in a real nrccMessage', () => {
  const [p, ...rest] = A.htmlToText(NRCC[0].value);
  assert.equal(rest.length, 0);
  assert.match(p.text, /^Trains between Clapham Junction .* delayed by up to 60 minutes, diverted or revised\. More details .* the National Rail website\.$/);
  assert.deepEqual(p.links, [{ text: 'National Rail website.', href: 'https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/' }]);
  assert.deepEqual(p.parts.map((x) => Boolean(x.href)), [false, true]);
  assert.equal(p.parts.map((x) => x.text).join(''), p.text);
  assert.ok(!p.text.includes('&nbsp;') && !p.text.includes(' '));
});

test('htmlToText keeps a normal https nationalrail.co.uk link and plain-text messages', () => {
  const [p] = A.htmlToText(NRCC[1].value);
  assert.deepEqual(p.links, [{ text: 'Disruptions area of the National Rail website.', href: 'https://www.nationalrail.co.uk/service-disruptions/godalming-20260927/' }]);
  assert.deepEqual(A.htmlToText(NRCC_PLAIN.value), [{ text: NRCC_PLAIN.value, parts: [{ text: NRCC_PLAIN.value }], links: [] }]);
});

test('htmlToText splits SWR incident Details into paragraphs on blank lines and keeps single <br> as \\n', () => {
  const paras = A.htmlToText(DETAILS).map((p) => p.text);
  assert.deepEqual(paras, [
    'Following a broken down train earlier today at Yeovil Junction all lines have now reopened.',
    "What's Going On:\nTrain services running through this station may be delayed by up to 30 minutes or revised. Disruption is expected until the end of the day.",
    'Long Distance & Mainline Services\nIn order to claim for this, you will need to provide the following:\n- Full contact details\n- The time and date of your journey',
    'If you need any help with your journey, please speak to a member of staff or use a station help point.',
    'We are very sorry for any disruption to your journey.',
  ]);
});

test('htmlToText links bare https URLs on safe domains, not others', () => {
  const [p] = A.htmlToText(FURTHER);
  assert.deepEqual(p.links, [{
    text: 'https://www.southwesternrailway.com/contact-and-help/refunds-and-compensation',
    href: 'https://www.southwesternrailway.com/contact-and-help/refunds-and-compensation',
  }]);
  assert.ok(p.text.includes('Traveline (http://www.traveline.info/)'));
  assert.ok(p.text.includes('stated above. Have you'), 'runs of spaces collapse');
});

test('htmlToText drops unsafe links but keeps their text, and never keeps markup', () => {
  const html = '<p>A <a href="javascript:alert(1)">script</a>, <a href="http://www.nationalrail.co.uk/x">plain http</a>, '
    + '<a href="https://evil.example/nationalrail.co.uk">other site</a>, <a href="https://user:pw@www.tfl.gov.uk/">creds</a>, '
    + '<a href="https://tfl.gov.uk.evil.example/">lookalike</a> and <a href="https://tfl.gov.uk/status">TfL</a>.</p>'
    + '<script>alert(1)</script><style>p{}</style><img src=x onerror="alert(1)" alt="map">'
    + '<ul><li>One &amp; two</li><li>&pound;5 &#8211; &#x2014;</li></ul><div>a < b</div>';
  const paras = A.htmlToText(html);
  assert.deepEqual(paras.map((p) => p.text), [
    'A script, plain http, other site, creds, lookalike and TfL.',
    'map',
    '• One & two',
    '• £5 – —',
    'a < b',
  ]);
  assert.deepEqual(paras[0].links, [{ text: 'TfL', href: 'https://tfl.gov.uk/status' }]);
  for (const p of paras) for (const part of p.parts) assert.ok(!/[<>]/.test(part.text) || part.text === 'a < b');
});

test('htmlToText handles empty input', () => {
  assert.deepEqual(A.htmlToText(null), []);
  assert.deepEqual(A.htmlToText(''), []);
  assert.deepEqual(A.htmlToText('<br><br> <p> </p>'), []);
});

test('safeHref accepts only https links to SWR, National Rail, Network Rail and TfL', () => {
  assert.equal(A.safeHref('http://https://www.nationalrail.co.uk/a'), 'https://www.nationalrail.co.uk/a');
  assert.equal(A.safeHref('https://www.southwesternrailway.com/x?y=1'), 'https://www.southwesternrailway.com/x?y=1');
  assert.equal(A.safeHref('https://networkrail.co.uk/'), 'https://networkrail.co.uk/');
  assert.equal(A.safeHref('https://api.tfl.gov.uk/'), 'https://api.tfl.gov.uk/');
  assert.equal(A.safeHref('http://www.nationalrail.co.uk/a'), null);
  assert.equal(A.safeHref('http://http://www.nationalrail.co.uk/a'), null);
  assert.equal(A.safeHref('https://notnationalrail.co.uk/'), null);
  assert.equal(A.safeHref('/relative'), null);
  assert.equal(A.safeHref('data:text/html,hi'), null);
  assert.equal(A.safeHref(null), null);
});

// ---------------------------------------------------------------------------
// parseUkTime
// ---------------------------------------------------------------------------

test('parseUkTime reads SWR UpdatedTime as London time, in summer and winter', () => {
  // overallstatus LineUpdates[].UpdatedTime
  assert.equal(A.parseUkTime('19:18:22 27/09/2026').toISOString(), '2026-09-27T18:18:22.000Z');
  assert.equal(A.parseUkTime('12:00:00 01/01/2026').toISOString(), '2026-01-01T12:00:00.000Z');
  assert.equal(A.parseUkTime('09:05 02/11/2026').toISOString(), '2026-11-02T09:05:00.000Z');
});

test('parseUkTime reads ISO strings, including .NET 7-digit fractions', () => {
  // railinfo GeneratedAt
  assert.equal(A.parseUkTime('2026-09-27T18:22:21.2509989+00:00').toISOString(), '2026-09-27T18:22:21.250Z');
  assert.equal(A.parseUkTime('2026-09-27T19:20:52+01:00').toISOString(), '2026-09-27T18:20:52.000Z');
  assert.equal(A.parseUkTime('2026-09-27T19:20:52+0100').toISOString(), '2026-09-27T18:20:52.000Z');
  assert.equal(A.parseUkTime('2026-09-27T18:20:52Z').toISOString(), '2026-09-27T18:20:52.000Z');
  // No offset: London time
  assert.equal(A.parseUkTime('2026-09-27T19:20:52').toISOString(), '2026-09-27T18:20:52.000Z');
  assert.equal(A.parseUkTime('2026-12-27 19:20').toISOString(), '2026-12-27T19:20:00.000Z');
});

test('parseUkTime reads board times ("19:21") on the day of `now`, across midnight', () => {
  const now = new Date('2026-09-27T18:00:00Z'); // 19:00 BST
  assert.equal(A.parseUkTime('19:21', now).toISOString(), '2026-09-27T18:21:00.000Z');
  assert.equal(A.parseUkTime('18:59', now).toISOString(), '2026-09-27T17:59:00.000Z');
  // Read at 23:50 London: "00:10" is tomorrow.
  assert.equal(A.parseUkTime('00:10', new Date('2026-09-27T22:50:00Z')).toISOString(), '2026-09-27T23:10:00.000Z');
  // Read at 00:20 London: "23:55" is yesterday.
  assert.equal(A.parseUkTime('23:55', new Date('2026-09-27T23:20:00Z')).toISOString(), '2026-09-27T22:55:00.000Z');
  // Winter (GMT)
  assert.equal(A.parseUkTime('08:15', new Date('2026-12-01T07:00:00Z')).toISOString(), '2026-12-01T08:15:00.000Z');
});

test('parseUkTime returns null for status words and nonsense', () => {
  for (const v of ['On time', 'Cancelled', 'Delayed', '', null, undefined, '25:00', '12:61', '31/02', 'Starts 19:21']) {
    assert.equal(A.parseUkTime(v), null, String(v));
  }
});

// ---------------------------------------------------------------------------
// Station matching (scripts/swr-stations.js)
// ---------------------------------------------------------------------------

// GET https://www.southwesternrailway.com/api/swrstations (3 of 204 entries, 2026-09-27)
const SWR_FIXTURE = [
  { Name: 'London Waterloo', EncodedName: 'London-Waterloo', CrsCode: 'WAT', Latitude: 51.503507, Longitude: -0.113897, NationalLocationCode: '5598', Url: '/travelling-with-us/at-the-station/London-Waterloo' },
  { Name: 'Ascot (Berks)', EncodedName: 'Ascot-Berks', CrsCode: 'ACT', Latitude: 51.40624634, Longitude: -0.675830536, NationalLocationCode: '5666', Url: '/travelling-with-us/at-the-station/Ascot-Berks' },
  { Name: 'Ryde Esplanade', EncodedName: 'Ryde-Esplanade', CrsCode: 'RYD', Latitude: 50.73285421, Longitude: -1.159772507, NationalLocationCode: '5542', Url: '/travelling-with-us/at-the-station/Ryde-Esplanade' },
];
// GET https://api.tfl.gov.uk/Line/south-western-railway/StopPoints (3 of 202 stops, trimmed)
const TFL_FIXTURE = [
  { naptanId: '910GWATRLMN', commonName: 'London Waterloo Rail Station', lat: 51.503299, lon: -0.113109, hubNaptanCode: 'HUBWAT', stopType: 'NaptanRailStation', modes: ['national-rail'], lines: [{ id: 'south-western-railway', name: 'South Western Railway' }], children: [{}] },
  { naptanId: '910GASCOT', commonName: 'Ascot Rail Station', lat: 51.406244, lon: -0.675833, stopType: 'NaptanRailStation', modes: ['national-rail'], lines: [{ id: 'south-western-railway', name: 'South Western Railway' }], children: [{}, {}] },
  { naptanId: '910GPHBR', commonName: 'Portsmouth Harbour Rail Station', lat: 50.796962, lon: -1.10784, stopType: 'NaptanRailStation', modes: ['national-rail'], lines: [{ id: 'southern', name: 'Southern' }, { id: 'south-western-railway', name: 'South Western Railway' }], children: [{}] },
];

test('matchStations matches on nearest coordinates and name, and lists what it cannot match', () => {
  const { stations, unmatched } = G.matchStations(SWR_FIXTURE, TFL_FIXTURE);
  assert.deepEqual(stations, [
    { crs: 'ACT', name: 'Ascot (Berks)', nlc: '5666', lat: 51.406246, lon: -0.675831, naptan: '910GASCOT', tflHub: null, url: '/travelling-with-us/at-the-station/Ascot-Berks' },
    { crs: 'WAT', name: 'London Waterloo', nlc: '5598', lat: 51.503507, lon: -0.113897, naptan: '910GWATRLMN', tflHub: 'HUBWAT', url: '/travelling-with-us/at-the-station/London-Waterloo' },
    { crs: 'RYD', name: 'Ryde Esplanade', nlc: '5542', lat: 50.732854, lon: -1.159773, naptan: null, tflHub: null, url: '/travelling-with-us/at-the-station/Ryde-Esplanade' },
  ]);
  assert.deepEqual(unmatched, [{ crs: 'RYD', name: 'Ryde Esplanade', nearest: { naptan: '910GPHBR', name: 'Portsmouth Harbour Rail Station', distance: 8010 } }]);
});

test('matchStations rejects a nearby stop with a different name and prefers the stop with more lines', () => {
  // Real pairs: Windsor & Eton Riverside is 376 m from Windsor & Eton Central; Reading has two NaPTANs at one point.
  const swr = [
    { Name: 'Windsor & Eton Riverside', CrsCode: 'WNR', Latitude: 51.48565491, Longitude: -0.606528915, NationalLocationCode: '5672', Url: '/x' },
    { Name: 'Reading', CrsCode: 'RDG', Latitude: 51.45878189, Longitude: -0.971854374, NationalLocationCode: '3149', Url: '/y' },
  ];
  const tfl = [
    { naptanId: '910GWINDSEC', commonName: 'Windsor & Eton Central Rail Station', lat: 51.483268, lon: -0.61038, lines: [{ id: 'great-western-railway' }, { id: 'south-western-railway' }] },
    { naptanId: '910GRDNG4AB', commonName: 'Reading Rail Station', lat: 51.458786, lon: -0.971863, lines: [{ id: 'great-western-railway' }, { id: 'south-western-railway' }] },
    { naptanId: '910GRDNGSTN', commonName: 'Reading Rail Station', lat: 51.458786, lon: -0.971863, lines: [{ id: 'elizabeth' }, { id: 'great-western-railway' }, { id: 'south-western-railway' }] },
    { naptanId: '930GLYM', commonName: 'Reading Ferry Terminal', lat: 51.458786, lon: -0.971863, lines: [] },
  ];
  const { stations, unmatched } = G.matchStations(swr, tfl);
  assert.equal(stations.find((s) => s.crs === 'RDG').naptan, '910GRDNGSTN');
  assert.equal(stations.find((s) => s.crs === 'WNR').naptan, null);
  assert.deepEqual(unmatched.map((u) => u.crs), ['WNR']);
});

test('nameScore compares station names loosely', () => {
  assert.equal(G.nameScore('Ascot (Berks)', 'Ascot Rail Station'), 3);
  assert.equal(G.nameScore('Box Hill & Westhumble', 'Box Hill and Westhumble Rail Station'), 3);
  assert.equal(G.nameScore('Gillingham Dorset', 'Gillingham (Dorset) Rail Station'), 2);
  assert.equal(G.nameScore('Windsor & Eton Riverside', 'Windsor & Eton Central Rail Station'), 0);
  assert.equal(G.nameScore('Ryde Esplanade', 'Portsmouth Harbour Rail Station'), 0);
});

test('renderStationsFile writes a script that sets window.SWR_STATIONS and module.exports', () => {
  const src = G.renderStationsFile(G.matchStations(SWR_FIXTURE, TFL_FIXTURE), '2026-09-27');
  const sandbox = { window: {}, module: { exports: {} } };
  vm.runInNewContext(src, sandbox);
  assert.equal(sandbox.window.SWR_STATIONS.length, 3);
  assert.equal(sandbox.module.exports, sandbox.window.SWR_STATIONS);
  assert.match(src, /No TfL stop for:\n \*   RYD Ryde Esplanade/);
});

test('the committed js/swr-stations.js has every quick pick, with TfL links at the interchanges', () => {
  assert.ok(SWR_STATIONS.length >= 200);
  const crs = new Set(SWR_STATIONS.map((s) => s.crs));
  assert.equal(crs.size, SWR_STATIONS.length, 'CRS codes are unique');
  for (const c of ['WAT', 'VXH', 'CLJ', 'WIM', 'SUR', 'RMD', 'WOK', 'GLD']) assert.ok(crs.has(c), c);
  assert.deepEqual(A.stationByCrs('wat'), {
    crs: 'WAT', name: 'London Waterloo', nlc: '5598', lat: 51.503507, lon: -0.113897,
    naptan: '910GWATRLMN', tflHub: 'HUBWAT', url: '/travelling-with-us/at-the-station/London-Waterloo',
  });
  assert.equal(A.stationByCrs('SUR').tflHub, null);
  assert.equal(A.stationByCrs('SUR').naptan, '910GSURBITN');
  assert.equal(A.stationByCrs('XXX'), null);
  for (const s of SWR_STATIONS) {
    assert.deepEqual(Object.keys(s), ['crs', 'name', 'nlc', 'lat', 'lon', 'naptan', 'tflHub', 'url']);
  }
});

// ---------------------------------------------------------------------------
// Picker search and the TfL → SWR link
// ---------------------------------------------------------------------------

test('searchStations matches CRS codes first, then names', () => {
  assert.equal(A.searchStations('sur')[0].crs, 'SUR');
  assert.equal(A.searchStations('WAT')[0].crs, 'WAT');
  assert.deepEqual(A.searchStations('waterloo').map((s) => s.crs), ['WAT']);
  assert.equal(A.searchStations('clapham')[0].crs, 'CLJ');
  assert.equal(A.searchStations('box hill and')[0].crs, 'BXW');
  assert.deepEqual(A.searchStations(''), []);
  assert.ok(A.searchStations('a', null, 5).length <= 5);
});

// GET https://api.tfl.gov.uk/StopPoint/HUBWAT (trimmed to the fields used)
const HUBWAT = {
  naptanId: 'HUBWAT', commonName: 'Waterloo', stopType: 'TransportInterchange',
  lines: [{ id: 'bakerloo' }, { id: 'south-western-railway' }, { id: 'waterloo-city' }],
  children: [
    { naptanId: '940GZZLUWLO', commonName: 'Waterloo Underground Station', hubNaptanCode: 'HUBWAT', lines: [{ id: 'bakerloo' }, { id: 'waterloo-city' }], children: [] },
    { naptanId: '910GWATRLMN', commonName: 'London Waterloo Rail Station', hubNaptanCode: 'HUBWAT', lines: [{ id: 'south-western-railway' }], children: [] },
  ],
};

test('swrStationForTflStop finds the SWR station for a TfL stop that has the SWR line', () => {
  assert.equal(A.swrStationForTflStop(HUBWAT).crs, 'WAT');
  assert.equal(A.swrStationForTflStop(HUBWAT.children[1]).crs, 'WAT');
  assert.equal(A.swrStationForTflStop(HUBWAT.children[0]), null);
  assert.equal(A.swrStationForTflStop({ naptanId: '940GZZLUOXC', lines: [{ id: 'victoria' }] }), null);
  assert.equal(A.swrStationForTflStop(null), null);
});

// ---------------------------------------------------------------------------
// Tab and URL state
// ---------------------------------------------------------------------------

test('tabState picks the tab from the URL, then the remembered tab', () => {
  assert.deepEqual(A.tabState('?tab=swr&swr=WAT', null), { tab: 'swr', swr: 'WAT', station: null, demo: false });
  assert.deepEqual(A.tabState('?tab=swr&swr=wat&demo', null), { tab: 'swr', swr: 'WAT', station: null, demo: true });
  assert.equal(A.tabState('?station=940GZZLUOXC', 'swr').tab, 'tfl');
  assert.equal(A.tabState('?swr=SUR', null).tab, 'swr');
  assert.equal(A.tabState('?tab=tfl&swr=SUR', 'swr').tab, 'tfl');
  assert.equal(A.tabState('?station=HUBWAT&swr=WAT', 'swr').tab, 'swr');
  assert.equal(A.tabState('?station=HUBWAT&swr=WAT', null).tab, 'tfl');
  assert.equal(A.tabState('', 'swr').tab, 'swr');
  assert.equal(A.tabState('', 'bogus').tab, 'tfl');
  assert.equal(A.tabState('?tab=nope', null).tab, 'tfl');
  assert.equal(A.tabState('?swr=Surbiton', null).swr, null);
  assert.equal(A.tabState('?station=940GZZLUOXC', null).station, '940GZZLUOXC');
});

test('tabSearch updates tab and swr and keeps the other parameters', () => {
  assert.equal(A.tabSearch('', { tab: 'swr', swr: 'wat' }), '?tab=swr&swr=WAT');
  assert.equal(A.tabSearch('?demo&station=HUBWAT', { tab: 'swr' }), '?demo&station=HUBWAT&tab=swr');
  assert.equal(A.tabSearch('?tab=swr&swr=WAT&demo', { tab: 'tfl' }), '?swr=WAT&demo');
  assert.equal(A.tabSearch('?tab=swr&swr=WAT', { swr: null }), '?tab=swr');
  assert.equal(A.tabSearch('?tab=swr', { tab: 'tfl' }), '');
  // Round trip
  const s = A.tabSearch('?station=940GZZLUWLO', { tab: 'swr', swr: 'VXH' });
  assert.deepEqual(A.tabState(s, null), { tab: 'swr', swr: 'VXH', station: '940GZZLUWLO', demo: false });
});

// ---------------------------------------------------------------------------
// Fetch wrappers, cache and demo routes
// ---------------------------------------------------------------------------

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    if (r instanceof Error) throw r;
    return { ok: r.status === undefined || r.status < 400, status: r.status || 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

test('cached shares one call per key within the TTL and forgets failures', async () => {
  let n = 0;
  const a = await Promise.all([A.cached('t1', 1000, async () => ++n), A.cached('t1', 1000, async () => ++n)]);
  assert.deepEqual(a, [1, 1]);
  assert.equal(await A.cached('t1', 0, async () => ++n), 2);
  await assert.rejects(A.cached('t2', 1000, async () => { throw new Error('boom'); }));
  await new Promise((r) => setImmediate(r));
  assert.equal(await A.cached('t2', 1000, async () => 'ok'), 'ok');
});

test('departures, service and Huxley wrappers call the right URLs, and departures are cached', async () => {
  A.clearCache();
  // Trimmed real responses: railinfo /journey/departures/WAT and Huxley /departures/WAT/40
  const f = fakeFetch((url) => ({ body: { url } }));
  A.configure({ fetch: f, demo: false });
  try {
    assert.equal((await A.departures('wat')).url, 'https://railinfo.southwesternrailway.com/journey/departures/WAT');
    await A.departures('WAT');
    assert.equal(f.calls.length, 1, 'second call within 30 s is cached');
    assert.equal((await A.huxleyDepartures('SUR')).url, 'https://huxley2.azurewebsites.net/departures/SUR/40');
    await A.service('9138693WATRLMN_');
    const post = f.calls[f.calls.length - 1];
    assert.equal(post.url, 'https://railinfo.southwesternrailway.com/journey/services');
    assert.equal(post.init.method, 'POST');
    assert.equal(post.init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(post.init.body), { ServiceId: '9138693WATRLMN_' });
    assert.equal((await A.huxleyService('9138516WATRLMN_')).url, 'https://huxley2.azurewebsites.net/service/9138516WATRLMN_');
    await assert.rejects(A.departures('Surbiton'), /Not a station code/);
  } finally {
    A.configure({ fetch: null });
    A.clearCache();
  }
});

test('fetch wrappers throw with the HTTP status; snapshot returns null on any failure', async () => {
  A.clearCache();
  const f = fakeFetch((url) => {
    if (url.includes('/departures/SUR')) return { status: 500 };
    if (url === 'data/swr/status.json') return { body: { fetchedAt: '2026-09-27T18:00:00Z' } };
    if (url === 'data/swr/broken.json') return new TypeError('Failed to fetch');
    return { status: 404 };
  });
  A.configure({ fetch: f, demo: false });
  try {
    await assert.rejects(A.departures('SUR'), (e) => e.status === 500 && /SWR live train info returned 500/.test(e.message));
    assert.deepEqual(await A.snapshot('status.json'), { fetchedAt: '2026-09-27T18:00:00Z' });
    assert.equal(await A.snapshot('seats/WOK.json'), null);
    assert.equal(await A.snapshot('broken.json'), null);
    assert.equal(await A.snapshot('../secret.json'), null);
    assert.equal(await A.snapshot('https://evil.example/x.json'), null);
  } finally {
    A.configure({ fetch: null });
    A.clearCache();
  }
});

test('demo mode answers from demoRoutes; an unhandled URL is a 404', async () => {
  A.clearCache();
  const seen = [];
  const route = (url, options) => {
    seen.push([url, options.method || 'GET']);
    if (url === 'https://railinfo.southwesternrailway.com/journey/departures/WAT') return { Station: { Name: 'London Waterloo', CrsCode: 'WAT' }, Items: [] };
    if (url === 'data/swr/status.json') return { fetchedAt: 'x' };
    return null;
  };
  A.demoRoutes.push(route);
  A.configure({ demo: true, fetch: () => { throw new Error('network used in demo mode'); } });
  try {
    assert.equal((await A.departures('WAT')).Station.CrsCode, 'WAT');
    assert.deepEqual(await A.snapshot('status.json'), { fetchedAt: 'x' });
    await assert.rejects(A.huxleyDepartures('WAT'), (e) => e.status === 404);
    await assert.rejects(A.service('X'), (e) => e.status === 404);
    assert.deepEqual(seen.at(-1), ['https://railinfo.southwesternrailway.com/journey/services', 'POST']);
    // createDemoFetch falls back to another fetch (the TfL demo) for URLs the routes don't handle.
    const tfl = A.createDemoFetch(async () => ({ ok: true, status: 200, json: async () => 'fallback' }));
    assert.equal(await (await tfl('https://api.tfl.gov.uk/Line/victoria/Status')).json(), 'fallback');
  } finally {
    A.demoRoutes.splice(A.demoRoutes.indexOf(route), 1);
    A.configure({ demo: false, fetch: null });
    A.clearCache();
  }
});

test('every SWR package file exists, and index.html loads them in the contract order', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(scripts.indexOf('js/app.js')), [
    'js/app.js', 'js/swr-stations.js', 'js/swr-api.js', 'js/swr-app.js',
    'js/swr-departures.js', 'js/swr-calling-points.js', 'js/swr-status.js', 'js/swr-seats.js', 'js/swr-closures.js', 'js/swr-performance.js',
  ]);
  const sections = [...html.matchAll(/<section id="(swr-(?:status|departures|seats|closures|performance))"[^>]*\bhidden\b/g)].map((m) => m[1]);
  assert.deepEqual(sections, ['swr-status', 'swr-departures', 'swr-seats', 'swr-closures', 'swr-performance']);
  for (const name of ['departures', 'calling-points', 'status', 'seats', 'closures', 'performance']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'js', `swr-${name}.js`)), name);
    assert.ok(html.includes(`<link rel="stylesheet" href="css/swr-${name}.css">`), name);
  }
});
