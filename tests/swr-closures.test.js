const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scripts/swr-closures.js');
const C = require('../js/swr-closures.js');
const STATIONS = require('../js/swr-stations.js');

// ---------------------------------------------------------------------------
// Fixtures (real responses, trimmed)
// ---------------------------------------------------------------------------

const rich = (...paras) => ({ json: { nodeType: 'document', data: {}, content: paras.map((p) => ({ nodeType: 'paragraph', data: {}, content: typeof p === 'string' ? [{ nodeType: 'text', value: p, marks: [], data: {} }] : p })) } });
const text = (value, marks) => ({ nodeType: 'text', value, marks: marks || [], data: {} });
const link = (uri, value) => ({ nodeType: 'hyperlink', data: { uri }, content: [text(value)] });

// GET https://www.nationalrail.co.uk/_next/data/05429787/engineering-works.json?date=20261003 (2026-09-28;
// 24 notices for all operators, trimmed to three SWR ones and one without SWR)
const LISTING_1003 = {
  pageProps: {
    data: {
      requestParams: { date: '2026-10-02T23:00:00.000Z', operatorCode: null },
      engineeringWorks: [
        {
          operatorsAffectedCollection: [{ name: 'South Western Railway', code: 'SW' }],
          name: 'Hounslow 3 Oct',
          summary: rich('Buses replace trains between Hounslow and Windsor & Eton Riverside / Virginia Water on Saturday 3 and Sunday 4 October'),
          p0Description: null,
          slug: 'hounslow-3-oct',
          startDateTime: '2026-10-03T00:00:00.000+01:00',
          endDateTime: '2026-10-04T23:59:00.000+01:00',
          priority: '2',
          hasVideo: false,
          sys: { id: 'qjKDAB7YwQLCQZa7UMEDI', publishedAt: '2026-09-22T06:43:39.792Z' },
        },
        {
          operatorsAffectedCollection: [{ name: 'Great Western Railway', code: 'GW' }, { name: 'South Western Railway', code: 'SW' }, { name: 'Southern', code: 'SN' }],
          name: 'PMH 3 Oct',
          summary: rich('Buses replace trains to / from Portsmouth Harbour on Saturday 3 and Sunday 4 October'),
          slug: 'pmh-3-oct',
          startDateTime: '2026-10-03T00:00:00.000+01:00',
          endDateTime: '2026-10-04T23:59:00.000+01:00',
          priority: '2',
          sys: { id: '4Z9Yo43qSaUpiBMB3RBDHM', publishedAt: '2026-09-21T10:00:00.000Z' },
        },
        {
          operatorsAffectedCollection: [{ name: 'South Western Railway', code: 'SW' }],
          name: 'EXD 10 Aug',
          summary: rich('Amended train service between London Waterloo and Exeter St Davids from Monday 10 August until further notice'),
          slug: 'exd-10-aug',
          startDateTime: '2026-08-10T00:00:00.000+01:00',
          endDateTime: '2026-10-09T23:59:00.000+01:00',
          priority: '2',
          sys: { id: '2gFrz8KNjCUURJjTGO09oI', publishedAt: '2026-08-05T09:00:00.000Z' },
        },
        {
          operatorsAffectedCollection: [{ name: 'Northern', code: 'NT' }, { name: 'TransPennine Express', code: 'TP' }],
          name: 'Huddersfield',
          summary: rich('Transpennine Route Upgrade: no trains to / from / via Huddersfield from Saturday 19 September to Sunday 4 October'),
          slug: 'huddersfield',
          startDateTime: '2026-09-19T00:00:00.000+01:00',
          endDateTime: '2026-10-04T23:59:00.000+01:00',
          priority: '2',
          sys: { id: 'hud', publishedAt: '2026-09-01T00:00:00.000Z' },
        },
      ],
    },
  },
};

// GET https://www.nationalrail.co.uk/engineering-works/hounslow-3-oct-20261003/ → __NEXT_DATA__ (trimmed)
const DETAIL_HOUNSLOW = {
  buildId: '05429787',
  props: {
    pageProps: {
      plannedIncident: {
        __typename: 'PlannedIncident',
        sys: { id: 'qjKDAB7YwQLCQZa7UMEDI', publishedAt: '2026-09-22T06:43:39.792Z' },
        summary: rich('Buses replace trains between Hounslow and Windsor & Eton Riverside / Virginia Water on Saturday 3 and Sunday 4 October'),
        routesAffected: rich('Between London Waterloo and Staines / Windsor & Eton Riverside / Ascot / Weybridge / Woking / Reading, between Richmond / Twickenham and Windsor & Eton Riverside, and also between Staines and Windsor & Eton Riverside / Weybridge / Woking / Reading'),
        description: rich(
          [text(''), link('https://www.nationalrail.co.uk/travel-information/engineering-works-explained/', 'Engineering work'), text(' is taking place between Hounslow and Ascot, closing various lines.')],
          'All weekend, trains to / from London Waterloo via Staines will run to an amended timetable.',
          [text('On '), text('Saturday', [{ type: 'bold' }]), text(', buses will replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside.')],
          [text('Details are on '), link('javascript:alert(1)', 'this page'), text(' and '), link('https://example.com/x', 'that one'), text('.')],
        ),
        name: 'Hounslow 3 Oct',
        slug: 'hounslow-3-oct',
        priority: '2',
        startDateTime: '2026-10-03T00:00:00.000+01:00',
        endDateTime: '2026-10-04T23:59:00.000+01:00',
        operatorsAffectedCollection: { items: [{ operatorName: 'South Western Railway', operatorCode: 'SW' }] },
      },
    },
  },
};

// GET https://api.tfl.gov.uk/Line/south-western-railway/Route/Sequence/outbound (2 of 36 orderedLineRoutes),
// plus one made-up fast route that skips from Waterloo to Staines, to check the path avoids skips.
const TFL_ROUTES = {
  orderedLineRoutes: [
    { name: 'London Waterloo  &harr;  Windsor & Eton Riverside ', naptanIds: ['910GWATRLMN', '910GVAUXHLM', '910GQTRDBAT', '910GCLPHMJ1', '910GERLFLD', '910GWDON', '910GRAYNSPK', '910GNEWMLDN', '9100NRBITON2', '910GKGSTON', '910GHAMWICK', '910GTEDNGTN', '910GSTRWBYH', '910GTWCKNHM', '910GWHTTON', '910GFELTHAM', '910GASFDMSX', '910GSTAINES', '910GWRYSBRY', '910GSUNYMDS', '910GDATCHET', '910GWSORAER'] },
    { name: 'London Waterloo  &harr;  London Waterloo ', naptanIds: ['910GWATRLMN', '910GVAUXHLM', '910GQTRDBAT', '910GCLPHMJC', '910GWDWTOWN', '910GPUTNEY', '910GBARNES', '910GBNSBDGE', '910GCHISWCK', '910GKEWBDGE', '910GBNTFORD', '910GSYONLA', '910GISLEWTH', '910GHOUNSLW', '910GWHTTON', '910GTWCKNHM', '910GSTMGTS', '910GRICHMND', '910GNSHEEN', '910GMRTLKE'] },
    { name: 'London Waterloo  &harr;  Weybridge ', naptanIds: ['910GSTAINES', '910GEGHAM', '910GVRGNWTR', '910GCHTSEY'] },
    { name: 'made-up fast route', naptanIds: ['910GWATRLMN', '910GCLPHMJ1', '910GSTAINES'] },
  ],
};

const HTML_PAGE = (data) => `<!DOCTYPE html><html><head><title>Engineering works</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;

// ---------------------------------------------------------------------------
// scripts/swr-closures.js: parsing
// ---------------------------------------------------------------------------

test('windowDates counts London calendar days, across the October clock change', () => {
  const d = S.windowDates(new Date('2026-10-20T23:30:00Z'), 14); // 00:30 BST on the 21st... GMT from the 25th
  assert.equal(d.length, 14);
  assert.equal(d[0], '2026-10-21');
  assert.equal(d[13], '2026-11-03');
  assert.equal(new Set(d).size, 14);
  assert.equal(S.listingUrl('2026-10-03'), 'https://www.nationalrail.co.uk/engineering-works/?date=20261003');
  assert.equal(S.listingDataUrl('05429787', '2026-10-03'), 'https://www.nationalrail.co.uk/_next/data/05429787/engineering-works.json?date=20261003');
  assert.equal(S.detailUrl('hounslow-3-oct', '2026-10-03T00:00:00.000+01:00'), 'https://www.nationalrail.co.uk/engineering-works/hounslow-3-oct-20261003/');
  assert.equal(S.detailUrl('corkickle-9-dec', '2025-12-09T00:00:00.000Z'), 'https://www.nationalrail.co.uk/engineering-works/corkickle-9-dec-20251209/');
});

test('extractNextData and listingDate read the page data and the day it is really for', () => {
  const page = S.extractNextData(HTML_PAGE({ buildId: 'b1', props: LISTING_1003 }));
  assert.equal(page.buildId, 'b1');
  assert.equal(S.listingDate(page), '2026-10-03');
  assert.equal(S.listingDate(S.asNextData(LISTING_1003)), '2026-10-03');
  // Today's undated page carries "now" (the CDN's cached copy for any ?date=)
  assert.equal(S.listingDate({ props: { pageProps: { data: { requestParams: { date: '2026-09-28T05:02:13.532Z' } } } } }), '2026-09-28');
  assert.equal(S.extractNextData('<html>no data</html>'), null);
  assert.equal(S.extractNextData('<script id="__NEXT_DATA__">{broken</script>'), null);
});

test('parseListing keeps SWR and Island Line notices only', () => {
  const list = S.parseListing(S.asNextData(LISTING_1003));
  assert.deepEqual(list.map((e) => e.slug), ['hounslow-3-oct', 'pmh-3-oct', 'exd-10-aug']);
  const h = list[0];
  assert.equal(h.id, 'qjKDAB7YwQLCQZa7UMEDI');
  assert.equal(h.title, 'Buses replace trains between Hounslow and Windsor & Eton Riverside / Virginia Water on Saturday 3 and Sunday 4 October');
  assert.equal(h.from, '2026-10-03T00:00:00.000+01:00');
  assert.deepEqual(list[1].operators, ['GW', 'SW', 'SN']);
  const il = { props: { pageProps: { data: { engineeringWorks: [{ ...LISTING_1003.pageProps.data.engineeringWorks[0], operatorsAffectedCollection: [{ name: 'Island Line', code: 'IL' }] }] } } } };
  assert.equal(S.parseListing(il).length, 1);
  assert.deepEqual(S.parseListing(null), []);
});

test('richTextParagraphs keeps paragraphs and safe links only', () => {
  const d = S.parseDetail(DETAIL_HOUNSLOW);
  assert.match(d.routes, /^Between London Waterloo and Staines/);
  assert.equal(d.details.length, 4);
  assert.equal(d.details[0].text, 'Engineering work is taking place between Hounslow and Ascot, closing various lines.');
  assert.deepEqual(d.details[0].parts[0], { text: 'Engineering work', href: 'https://www.nationalrail.co.uk/travel-information/engineering-works-explained/' });
  assert.equal(d.details[2].text, 'On Saturday, buses will replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside.');
  // javascript: and other hosts lose the link but keep the text
  assert.equal(d.details[3].text, 'Details are on this page and that one.');
  assert.ok(d.details[3].parts.every((p) => !p.href));
  const list = { json: { nodeType: 'document', content: [{ nodeType: 'unordered-list', content: [{ nodeType: 'list-item', content: [{ nodeType: 'paragraph', content: [text('New Malden and Berrylands')] }] }] }] } };
  assert.deepEqual(S.richTextParagraphs(list).map((p) => p.text), ['• New Malden and Berrylands']);
  assert.equal(S.parseDetail({ props: { pageProps: {} } }), null);
});

test('findStations reads station names from text, longest first', () => {
  const m = S.stationMatcher(STATIONS);
  const r = S.findStations('Buses replace trains between Hounslow and Windsor & Eton Riverside / Virginia Water', m);
  assert.deepEqual(r.crs, ['HOU', 'WNR', 'VIR']);
  assert.equal(r.masked, 'Buses replace trains between §HOU§ and §WNR§ / §VIR§');
  assert.deepEqual(S.findStations('trains to Ash Vale and Ascot, not ash trees', m).crs, ['AHV', 'ACT']);
  assert.deepEqual(S.findStations('between London Waterloo and Exeter St. Davids', m).crs, ['WAT', 'EXD']);
  assert.deepEqual(S.findStations('Walton-on-Thames, Gillingham (Dorset) and the Waterloo & City line', m).crs, ['WAL', 'GIL', 'WAT']);
  assert.deepEqual(S.findStations('reading the notice', m).crs, []);
});

test('betweenPairs and stationsBetween fill in a closed stretch along stopping trains', () => {
  const m = S.stationMatcher(STATIONS);
  const masked = S.findStations('between Wanborough and Guildford and also Woking and Haslemere; and also between Staines and Egham', m).masked;
  assert.deepEqual(S.betweenPairs(masked), [[['WAN'], ['GLD']], [['WOK'], ['HSL']], [['SNS'], ['EGH']]]);
  assert.deepEqual(S.betweenPairs('between §SOA§ / §SOU§ and stations via §BCU§'), [[['SOA', 'SOU'], ['BCU']]]);

  const g = S.parseRoutes(TFL_ROUTES, STATIONS);
  assert.deepEqual(S.stationsBetween('HOU', 'VIR', g), ['HOU', 'WTN', 'FEL', 'AFS', 'SNS', 'EGH', 'VIR']);
  assert.deepEqual(S.stationsBetween('HOU', 'WNR', g), ['HOU', 'WTN', 'FEL', 'AFS', 'SNS', 'WRY', 'SNY', 'DAT', 'WNR']);
  // The made-up Waterloo → Clapham Junction → Staines skip is ignored in favour of a stopping route
  const wat = S.stationsBetween('WAT', 'SNS', g);
  assert.ok(wat.length > 10 && wat.includes('FEL') && wat.includes('AFS'), wat.join(' '));
  assert.deepEqual(S.stationsBetween('HOU', 'LKE', g), ['HOU', 'LKE']); // Island Line: not in TfL's routes
  assert.deepEqual(S.stationsBetween('HOU', 'VIR', null), ['HOU', 'VIR']);
});

test('closureKind reads the title', () => {
  assert.equal(S.closureKind('Buses replace trains to / from Portsmouth Harbour on Saturday 3 and Sunday 4 October'), 'buses');
  assert.equal(S.closureKind('Transpennine Route Upgrade: no trains to / from / via Huddersfield'), 'closed');
  assert.equal(S.closureKind('Station improvement work for step-free access: amended services to / from Wandsworth Town'), 'station');
  assert.equal(S.closureKind('Amended train service between London Waterloo and Exeter St Davids'), 'amended');
});

test('parseClosures builds closures.json: one item per notice, stations and route stations', () => {
  const dates = S.windowDates(new Date('2026-09-28T09:00:00Z'), 14);
  const out = S.parseClosures({
    fetchedAt: '2026-09-28T09:00:00.000Z',
    dates,
    listings: [S.asNextData(LISTING_1003), S.asNextData(LISTING_1003)], // the same notices on two days
    details: { qjKDAB7YwQLCQZa7UMEDI: DETAIL_HOUNSLOW },
    routes: TFL_ROUTES,
    stations: STATIONS,
    errors: { 'listing 2026-10-05': 'HTTP 500' },
  });
  assert.equal(out.format, 1);
  assert.equal(out.fetchedAt, '2026-09-28T09:00:00.000Z');
  assert.deepEqual(out.window, { from: '2026-09-28', to: '2026-10-11' });
  assert.deepEqual(out.errors, { 'listing 2026-10-05': 'HTTP 500' });
  assert.deepEqual(out.items.map((i) => i.id), ['2gFrz8KNjCUURJjTGO09oI', 'qjKDAB7YwQLCQZa7UMEDI', '4Z9Yo43qSaUpiBMB3RBDHM']);

  const [exd, hou, pmh] = out.items;
  // An amended timetable isn't filled in between its ends
  assert.equal(exd.kind, 'amended');
  assert.deepEqual(exd.stations, ['WAT', 'EXD']);
  // Buses: the stretch between the named ends
  assert.equal(hou.kind, 'buses');
  assert.deepEqual(hou.stations, ['HOU', 'WNR', 'VIR', 'WTN', 'FEL', 'AFS', 'SNS', 'WRY', 'SNY', 'DAT', 'EGH']);
  assert.equal(hou.summary, 'Engineering work is taking place between Hounslow and Ascot, closing various lines.');
  // "closing various lines" and "routes affected" only reach routeStations
  for (const c of ['WAT', 'ACT', 'RDG', 'RMD', 'TWI']) assert.ok(hou.routeStations.includes(c) && !hou.stations.includes(c), c);
  assert.equal(hou.url, 'https://www.nationalrail.co.uk/engineering-works/hounslow-3-oct-20261003/');
  assert.equal(hou.details.length, 4);
  assert.equal(hou.publishedAt, '2026-09-22T06:43:39.792Z');
  // No notice page: named stations only, no details
  assert.deepEqual(pmh.stations, ['PMH']);
  assert.deepEqual(pmh.routes, []);
  assert.deepEqual(pmh.details, []);

  // Outside the window
  const later = S.parseClosures({ dates: ['2026-10-05', '2026-10-06'], listings: [S.asNextData(LISTING_1003)], stations: STATIONS });
  assert.deepEqual(later.items.map((i) => i.id), ['2gFrz8KNjCUURJjTGO09oI']);
});

test('"closing all lines" in the first line of a notice puts that stretch in stations', () => {
  const m = S.stationMatcher(STATIONS);
  const g = S.parseRoutes(TFL_ROUTES, STATIONS);
  const entry = S.parseListing(S.asNextData(LISTING_1003))[1]; // Portsmouth Harbour, named alone
  const detail = { routes: '', details: [{ text: 'Engineering work is taking place between Feltham and Staines, closing all lines.', parts: [{ text: 'x' }] }] };
  assert.deepEqual(S.buildItem(entry, detail, m, g).stations, ['PMH', 'FEL', 'SNS', 'AFS']);
  const some = { routes: '', details: [{ text: 'Engineering work is taking place between Feltham and Staines, closing some lines.', parts: [{ text: 'x' }] }] };
  const item = S.buildItem(entry, some, m, g);
  assert.deepEqual(item.stations, ['PMH']);
  assert.deepEqual(item.routeStations, ['PMH', 'FEL', 'SNS', 'AFS']);
});

// ---------------------------------------------------------------------------
// scripts/swr-closures.js: snapshot() with fake fetch helpers
// ---------------------------------------------------------------------------

function fakeClient(pages) {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    if (!(url in pages)) throw new Error('HTTP 404');
    const body = pages[url];
    if (body instanceof Error) throw body;
    return typeof body === 'string' ? body : JSON.stringify(body);
  };
  return { calls, fetchText, fetchJson: async (url) => JSON.parse(await fetchText(url)) };
}

const NOW = new Date('2026-09-28T09:00:00Z');
const TODAY_LISTING = { buildId: 'b1', props: { pageProps: { data: { requestParams: { date: '2026-09-28T09:00:00.000Z' }, engineeringWorks: [LISTING_1003.pageProps.data.engineeringWorks[2]] } } } };

test('snapshot reuses a recent previous file with one request', async () => {
  const previous = { format: 1, fetchedAt: '2026-09-28T06:00:00.000Z', items: [] };
  const c = fakeClient({ 'https://prev/closures.json': previous });
  const out = await S.snapshot({ ...c, now: NOW, previousUrl: 'https://prev/closures.json', stations: STATIONS });
  assert.deepEqual(out, previous);
  assert.deepEqual(c.calls, ['https://prev/closures.json']);
});

test('snapshot fetches listings through the data route, checks their dates, and reuses unchanged notices', async () => {
  const dated = (ymd, works) => ({ pageProps: { data: { requestParams: { date: new Date(`${ymd}T00:00:00+01:00`).toISOString() }, engineeringWorks: works } } });
  const pages = {
    'https://www.nationalrail.co.uk/engineering-works/': HTML_PAGE(TODAY_LISTING),
    // The data route for the 29th answers with the wrong day, and the HTML fallback too (the CDN's copy of today)
    'https://www.nationalrail.co.uk/_next/data/b1/engineering-works.json?date=20260929': dated('2026-09-28', []),
    'https://www.nationalrail.co.uk/engineering-works/?date=20260929': HTML_PAGE(TODAY_LISTING),
    'https://www.nationalrail.co.uk/_next/data/b1/engineering-works.json?date=20260930': dated('2026-09-30', LISTING_1003.pageProps.data.engineeringWorks.slice(0, 2)),
    [S.TFL_ROUTES_URL]: TFL_ROUTES,
    'https://www.nationalrail.co.uk/engineering-works/hounslow-3-oct-20261003/': HTML_PAGE(DETAIL_HOUNSLOW),
    'https://www.nationalrail.co.uk/engineering-works/pmh-3-oct-20261003/': new Error('HTTP 503'),
  };
  const previous = {
    format: 1,
    fetchedAt: '2026-09-27T09:00:00.000Z', // a day old: rebuild
    items: [{ id: '2gFrz8KNjCUURJjTGO09oI', publishedAt: '2026-08-05T09:00:00.000Z', routes: ['Between London Waterloo and Salisbury'], details: [{ text: 'Kept from last time', parts: [{ text: 'Kept from last time' }] }] }],
  };
  pages['https://prev/closures.json'] = previous;
  const c = fakeClient(pages);
  const logs = [];
  const out = await S.snapshot({ ...c, now: NOW, days: 7, previousUrl: 'https://prev/closures.json', stations: STATIONS, log: (m) => logs.push(m) });

  assert.deepEqual(out.window, { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(out.items.map((i) => i.id), ['2gFrz8KNjCUURJjTGO09oI', 'qjKDAB7YwQLCQZa7UMEDI', '4Z9Yo43qSaUpiBMB3RBDHM']);
  // The unchanged notice wasn't fetched again
  assert.ok(!c.calls.some((u) => u.includes('exd-10-aug')));
  assert.equal(out.items[0].details[0].text, 'Kept from last time');
  assert.deepEqual(out.items[0].routeStations, ['WAT', 'EXD', 'SAL']);
  assert.equal(out.items[1].details.length, 4);
  assert.match(out.errors['listing 2026-09-29'], /got the listing for 2026-09-28/);
  assert.equal(out.errors['listing 2026-10-01'], 'HTTP 404');
  assert.equal(out.errors['notice pmh-3-oct'], 'HTTP 503');
  assert.equal(out.fetchedAt, NOW.toISOString());
  assert.ok(logs.some((l) => /3 notices/.test(l)));
});

test('snapshot keeps the previous file when every listing fails, and throws without one', async () => {
  const previous = { format: 1, fetchedAt: '2026-09-20T09:00:00.000Z', items: [{ id: 'x' }] };
  const c = fakeClient({ 'https://prev/closures.json': previous });
  assert.deepEqual(await S.snapshot({ ...c, now: NOW, days: 2, previousUrl: 'https://prev/closures.json', stations: STATIONS }), previous);
  const none = fakeClient({});
  await assert.rejects(S.snapshot({ ...none, now: NOW, days: 2, previousUrl: null, stations: STATIONS }), /every National Rail listing failed/);
  assert.equal(none.calls.length, 3); // today's page, then the dated HTML for each day (no buildId, so no data route)
});

// ---------------------------------------------------------------------------
// js/swr-closures.js: what the page shows
// ---------------------------------------------------------------------------

const SNAP = S.parseClosures({
  fetchedAt: '2026-09-28T09:00:00.000Z',
  dates: S.windowDates(NOW, 14),
  listings: [S.asNextData(LISTING_1003)],
  details: { qjKDAB7YwQLCQZa7UMEDI: DETAIL_HOUNSLOW },
  routes: TFL_ROUTES,
  stations: STATIONS,
});

test('selectClosures groups by date and sorts the station\'s own closures first', () => {
  const s = C.selectClosures(SNAP, 'SNS', NOW);
  assert.equal(s.today, '2026-09-28');
  assert.equal(s.last, '2026-10-11');
  assert.equal(s.total, 3);
  assert.deepEqual(s.groups.map((g) => [g.key, g.label]), [['2026-10-03', 'Sat 3 Oct']]);
  assert.equal(s.groups[0].entries[0].relation, 'here');
  assert.deepEqual(s.elsewhere.map((e) => e.item.id), ['2gFrz8KNjCUURJjTGO09oI', '4Z9Yo43qSaUpiBMB3RBDHM']);

  const wat = C.selectClosures(SNAP, 'WAT', NOW);
  assert.deepEqual(wat.groups.map((g) => g.key), ['now', '2026-10-03']);
  assert.equal(wat.groups[0].label, 'Happening now');
  assert.equal(wat.groups[0].entries[0].relation, 'here'); // Waterloo is named in the Exeter title
  assert.equal(wat.groups[1].entries[0].relation, 'routes');

  // Tomorrow's label, and a notice that has already ended today is dropped
  const fri = C.selectClosures(SNAP, 'HOU', new Date('2026-10-02T09:00:00Z'));
  assert.equal(fri.groups[0].label, 'Tomorrow, Sat 3 Oct');
  const after = C.selectClosures(SNAP, 'HOU', new Date('2026-10-05T09:00:00Z'));
  assert.equal(after.groups.length, 0);
  assert.equal(C.selectClosures(null, 'WAT', NOW).total, 0);
});

test('fmtRange and itemDays', () => {
  assert.equal(C.fmtRange({ start: '2026-10-03', end: '2026-10-04' }, '2026-09-28'), 'Sat 3 – Sun 4 Oct');
  assert.equal(C.fmtRange({ start: '2026-05-11', end: '2026-10-11' }, '2026-09-28'), 'Mon 11 May – Sun 11 Oct');
  assert.equal(C.fmtRange({ start: '2025-12-09', end: '2026-12-13' }, '2026-09-28'), 'Tue 9 Dec 2025 – Sun 13 Dec');
  assert.equal(C.fmtRange({ start: '2026-10-03', end: '2026-10-03' }, '2026-09-28'), 'Sat 3 Oct');
  assert.deepEqual(C.itemDays({ from: '2026-10-03T00:00:00.000+01:00', to: '2026-10-04T23:59:00.000+01:00' }), { start: '2026-10-03', end: '2026-10-04' });
  assert.equal(C.itemDays({ from: 'soon' }), null);
});

test('renderClosures escapes everything and keeps notice text out of the HTML', () => {
  const evil = JSON.parse(JSON.stringify(SNAP));
  evil.items[1].title = '<img src=x onerror=alert(1)> Buses replace trains';
  evil.items[1].routes = ['<script>alert(1)</script>'];
  evil.items[1].details = [{ text: '<b>bold</b>', parts: [{ text: '<b>bold</b>' }] }];
  evil.items[1].url = 'javascript:alert(1)';
  const r = C.renderClosures({ snapshot: evil, snapshotLoaded: true, station: { crs: 'SNS', name: 'Staines' } }, NOW);
  assert.ok(!r.html.includes('<img'), 'title escaped');
  assert.ok(!r.html.includes('<script'), 'routes escaped');
  assert.ok(!r.html.includes('<b>bold'), 'details only through slots');
  assert.ok(!r.html.includes('javascript:'), 'unsafe link dropped');
  assert.match(r.html, /&lt;img src=x/);
  assert.match(r.html, /data-para="0"/);
  assert.equal(r.blocks[0][0].text, '<b>bold</b>');
  assert.match(r.html, /1 notice affects Staines or trains to and from it/);
  assert.match(r.html, /Includes Staines/);
  assert.match(r.html, /Buses replace trains<\/span>/);
  assert.match(r.html, /Elsewhere on SWR: 2 more notices/);
  assert.match(r.html, /About this data/);
});

test('renderClosures: nothing for the station, no snapshot, loading, stale', () => {
  const none = C.renderClosures({ snapshot: SNAP, snapshotLoaded: true, station: { crs: 'SUR', name: 'Surbiton' } }, NOW);
  assert.match(none.html, /No planned closures found for Surbiton/);
  assert.match(none.html, /Elsewhere on SWR: 3 more notices/);
  const missing = C.renderClosures({ snapshot: null, snapshotLoaded: true, station: { crs: 'SUR', name: 'Surbiton' } }, NOW);
  assert.match(missing.html, /aren't available here/);
  assert.match(C.renderClosures({ snapshot: null, snapshotLoaded: false, station: null }, NOW).html, /Loading/);
  const old = C.renderClosures({ snapshot: SNAP, snapshotLoaded: true, station: { crs: 'SUR', name: 'Surbiton' } }, new Date('2026-09-29T09:00:00Z'));
  assert.match(old.html, /May be out of date/);
  assert.ok(!none.html.includes('May be out of date'));
});

test('the demo snapshot moves by whole weeks and answers only closures.json', () => {
  const d = C.demoClosuresSnapshot(new Date('2026-10-08T09:00:00Z'));
  assert.equal(d.format, 1);
  const hou = d.items.find((i) => i.id === 'qjKDAB7YwQLCQZa7UMEDI');
  assert.equal(hou.from, '2026-10-10T00:00:00.000+01:00');
  assert.ok(C.selectClosures(d, 'SNS', new Date('2026-10-08T09:00:00Z')).groups.length > 0);
  assert.ok(C.demoRoute('data/swr/closures.json'));
  assert.equal(C.demoRoute('data/swr/status.json'), null);
});
