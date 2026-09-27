/*
 * Demo mode: a fake `fetch` that answers the same URLs as the TfL API with
 * synthetic data shaped like the real responses. Enabled with ?demo in the URL.
 * Useful offline, when rate limited, and for tests.
 */
(function (root) {
  'use strict';

  const LINE_NAMES = {
    bakerloo: 'Bakerloo', central: 'Central', circle: 'Circle', 'hammersmith-city': 'Hammersmith & City',
    jubilee: 'Jubilee', metropolitan: 'Metropolitan', northern: 'Northern', piccadilly: 'Piccadilly',
    victoria: 'Victoria', 'waterloo-city': 'Waterloo & City', elizabeth: 'Elizabeth line', dlr: 'DLR',
    mildmay: 'Mildmay', district: 'District',
  };
  const LINE_MODE = { elizabeth: 'elizabeth-line', dlr: 'dlr', mildmay: 'overground' };
  const PLATFORMS = {
    central: ['Eastbound - Platform 1', 'Westbound - Platform 2'],
    jubilee: ['Eastbound - Platform 13', 'Westbound - Platform 14'],
    elizabeth: ['Platform 5', 'Platform 8'],
    dlr: ['Platform 16', 'Platform 17'],
    mildmay: ['Platform 1', 'Platform 2'],
    northern: ['Northbound - Platform 1', 'Southbound - Platform 2'],
    victoria: ['Northbound - Platform 5', 'Southbound - Platform 6'],
    bakerloo: ['Northbound - Platform 3', 'Southbound - Platform 4'],
    piccadilly: ['Eastbound - Platform 5', 'Westbound - Platform 6'],
    'waterloo-city': ['Eastbound - Platform 25', 'Westbound - Platform 9'],
  };
  const DESTINATIONS = {
    central: ['Epping', 'Hainault', 'Ealing Broadway', 'West Ruislip'],
    jubilee: ['Stratford', 'Stanmore', 'Wembley Park'],
    elizabeth: ['Abbey Wood', 'Shenfield', 'Heathrow Terminal 5', 'Reading'],
    dlr: ['Woolwich Arsenal', 'Lewisham', 'Stratford International'],
    mildmay: ['Richmond', 'Clapham Junction', 'Stratford'],
    northern: ['High Barnet', 'Morden', 'Edgware', 'Battersea Power Station'],
    victoria: ['Walthamstow Central', 'Brixton'],
    bakerloo: ['Harrow & Wealdstone', 'Elephant & Castle', 'Queen\'s Park'],
    piccadilly: ['Cockfosters', 'Heathrow Terminal 5', 'Uxbridge'],
    circle: ['Edgware Road', 'Hammersmith'],
    'hammersmith-city': ['Barking', 'Hammersmith'],
    metropolitan: ['Aldgate', 'Amersham', 'Uxbridge'],
    'waterloo-city': ['Waterloo', 'Bank'],
  };

  // Station NaPTAN → { name, lines, scale (busyness multiplier), hub }
  const NAPTANS = {
    '940GZZLUKSX': { name: "King's Cross St. Pancras Underground Station", lines: ['circle', 'hammersmith-city', 'metropolitan', 'northern', 'piccadilly', 'victoria'], scale: 1.0, hub: 'HUBKGX' },
    '940GZZLUOXC': { name: 'Oxford Circus Underground Station', lines: ['bakerloo', 'central', 'victoria'], scale: 0.95 },
    '940GZZLUSTD': { name: 'Stratford Underground Station', lines: ['central', 'jubilee'], scale: 0.9, hub: 'HUBSRA' },
    '910GSTFD': { name: 'Stratford Rail Station', lines: ['elizabeth', 'mildmay'], scale: 0.75, hub: 'HUBSRA' },
    '940GZZDLSTD': { name: 'Stratford DLR Station', lines: ['dlr'], scale: 0.45, hub: 'HUBSRA' },
    '940GZZLUBNK': { name: 'Bank Underground Station', lines: ['central', 'northern', 'waterloo-city'], scale: 1.05, hub: 'HUBBAN' },
    '940GZZDLBNK': { name: 'Bank DLR Station', lines: ['dlr'], scale: 0.6, hub: 'HUBBAN' },
    '940GZZLUWLO': { name: 'Waterloo Underground Station', lines: ['bakerloo', 'jubilee', 'northern', 'waterloo-city'], scale: 1.0, hub: 'HUBWAT' },
  };
  const HUBS = {
    HUBKGX: "King's Cross & St Pancras International",
    HUBSRA: 'Stratford',
    HUBBAN: 'Bank',
    HUBWAT: 'Waterloo',
  };

  // Deterministic pseudo-random numbers so the demo is stable within a minute.
  function rand(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return ((h >>> 0) % 10000) / 10000;
  }

  function typical(naptan, day, minutes) {
    const s = (NAPTANS[naptan] || { scale: 0.5 }).scale;
    const h = minutes / 60 < 4 ? minutes / 60 + 24 : minutes / 60;
    const g = (mu, sd) => Math.exp(-(((h - mu) / sd) ** 2));
    const weekend = day === 'SAT' || day === 'SUN';
    const v = weekend
      ? 0.05 + 0.55 * g(14, 3.2) + 0.15 * g(19, 2)
      : 0.04 + 0.95 * g(8.3, 0.9) + 0.8 * g(17.7, 1.2) + 0.3 * g(13, 2.2) + 0.1 * g(21, 2);
    return Math.max(0.01, Math.min(1, v * s));
  }

  function timeBands(naptan, day) {
    const bands = [];
    for (let m = 5 * 60; m < 25 * 60; m += 15) {
      const t = m % 1440;
      const label = root.TflApi.formatClock(t) + '-' + root.TflApi.formatClock(t + 15);
      bands.push({ timeBand: label, percentageOfBaseLine: Number(typical(naptan, day, t).toFixed(3)) });
    }
    return bands;
  }

  function stopPoint(naptan) {
    const info = NAPTANS[naptan];
    const modes = [...new Set(info.lines.map((l) => LINE_MODE[l] || 'tube'))];
    return {
      $type: 'Tfl.Api.Presentation.Entities.StopPoint, Tfl.Api.Presentation.Entities',
      naptanId: naptan, id: naptan, commonName: info.name, stopType: 'NaptanMetroStation',
      hubNaptanCode: info.hub, modes,
      lines: info.lines.map((id) => ({ id, name: LINE_NAMES[id], type: 'Line' })),
      lineGroup: [{ stationAtcoCode: naptan, lineIdentifier: info.lines }],
      lineModeGroups: modes.map((mode) => ({ modeName: mode, lineIdentifier: info.lines.filter((l) => (LINE_MODE[l] || 'tube') === mode) })),
      additionalProperties: [{ category: 'Geo', key: 'Zone', value: naptan.includes('BNK') || naptan.includes('OXC') || naptan.includes('KSX') ? '1' : '2/3' }],
      children: [],
    };
  }

  function hub(id) {
    const children = Object.keys(NAPTANS).filter((n) => NAPTANS[n].hub === id).map(stopPoint);
    return {
      naptanId: id, id, commonName: HUBS[id], stopType: 'TransportInterchange', modes: [...new Set(children.flatMap((c) => c.modes))],
      lines: children.flatMap((c) => c.lines), lineGroup: [], lineModeGroups: [],
      additionalProperties: children[0].additionalProperties, children,
    };
  }

  function arrivals(naptan) {
    const info = NAPTANS[naptan];
    const minuteSeed = Math.floor(Date.now() / 60000);
    const out = [];
    for (const line of info.lines) {
      const platforms = PLATFORMS[line] || ['Platform 1', 'Platform 2'];
      platforms.forEach((platform, p) => {
        const headway = 2 + Math.round(rand(line + platform) * 4);
        let t = Math.round(rand(line + platform + minuteSeed) * 120) + 20;
        for (let i = 0; i < 4; i++) {
          const dests = DESTINATIONS[line] || ['Terminus'];
          const dest = line === 'waterloo-city' ? (p === 0 ? 'Bank' : 'Waterloo') : dests[(p + i) % dests.length];
          out.push({
            lineId: line, lineName: LINE_NAMES[line], platformName: platform, naptanId: naptan,
            destinationName: dest + (line === 'dlr' ? ' DLR Station' : ' Underground Station'),
            timeToStation: t, currentLocation: i === 0 ? 'Approaching ' + info.name.replace(/ (Underground|Rail|DLR) Station$/, '') : 'Between stations',
          });
          t += headway * 60 + Math.round(rand(line + i + minuteSeed) * 60);
        }
      });
    }
    return out;
  }

  function lineStatuses(ids) {
    return ids.map((id) => {
      if (id === 'northern') return { id, name: LINE_NAMES[id], lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays', reason: 'Northern Line: Minor delays due to an earlier signal failure at Camden Town. GOOD SERVICE on the rest of the line.' }] };
      if (id === 'mildmay') return { id, name: LINE_NAMES[id], lineStatuses: [{ statusSeverity: 3, statusSeverityDescription: 'Part Suspended', reason: 'No service between Stratford and Willesden Junction while we fix a broken down train.' }] };
      return { id, name: LINE_NAMES[id] || id, lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] };
    });
  }


  // Every rail line, for /Line/Mode/{modes}/Status (the network status strip).
  const NETWORK_LINES = [
    ['bakerloo', 'tube'], ['central', 'tube'], ['circle', 'tube'], ['district', 'tube'], ['hammersmith-city', 'tube'],
    ['jubilee', 'tube'], ['metropolitan', 'tube'], ['northern', 'tube'], ['piccadilly', 'tube'], ['victoria', 'tube'],
    ['waterloo-city', 'tube'], ['elizabeth', 'elizabeth-line'], ['dlr', 'dlr'], ['liberty', 'overground'],
    ['lioness', 'overground'], ['mildmay', 'overground'], ['suffragette', 'overground'], ['weaver', 'overground'],
    ['windrush', 'overground'], ['tram', 'tram'],
  ];
  const NETWORK_NAMES = { liberty: 'Liberty', lioness: 'Lioness', suffragette: 'Suffragette', weaver: 'Weaver', windrush: 'Windrush', tram: 'Tram' };

  function networkStatus(modes) {
    const wanted = modes.map((m) => m.toLowerCase());
    const lines = NETWORK_LINES.filter(([, mode]) => wanted.includes(mode));
    return lineStatuses(lines.map(([id]) => id)).map((l, i) => {
      const extra = { modeName: lines[i][1], name: LINE_NAMES[l.id] || NETWORK_NAMES[l.id] || l.id };
      if (l.id === 'piccadilly') {
        l.lineStatuses = [{ statusSeverity: 5, statusSeverityDescription: 'Part Closure', reason: 'PICCADILLY LINE: No service between Acton Town and Uxbridge. Replacement buses operate.' }];
      }
      return { ...l, ...extra };
    });
  }

  /**
   * /Line/{ids}/Status/{from}/to/{to}: planned works relative to now, in the real shape
   * (lineStatuses[].validityPeriods + disruption.category). Includes one ongoing planned closure,
   * one live incident (filtered out by the app), and a repeated entry, as TfL sometimes sends.
   */
  function statusRange(ids) {
    const day = 24 * 3600 * 1000;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const at = (days, hours, mins) => new Date(today.getTime() + days * day + ((hours || 0) * 60 + (mins || 0)) * 60000).toISOString().replace('.000Z', 'Z');
    const toSat = (6 - today.getUTCDay() + 7) % 7 || 7;
    const period = (from, to, isNow) => [{ fromDate: from, toDate: to, isNow: Boolean(isNow) }];
    const planned = (id, severity, description, reason, from, to) => ({
      lineId: id, statusSeverity: severity, statusSeverityDescription: description, reason,
      validityPeriods: period(from, to), disruption: { category: 'PlannedWork', categoryDescription: 'PlannedWork', description: reason },
    });
    const works = {
      central: [planned('central', 5, 'Part Closure', `CENTRAL LINE: Saturday and Sunday, no service between Liverpool Street and Woodford / Newbury Park. Replacement buses operate.`, at(toSat, 3, 30), at(toSat + 2, 0, 29))],
      jubilee: [planned('jubilee', 5, 'Part Closure', 'JUBILEE LINE: Between 0130 and 0430, no service between Finchley Road and Stratford. Replacement buses operate.', at(3, 0, 30), at(3, 3, 30))],
      elizabeth: [planned('elizabeth', 7, 'Reduced Service', 'ELIZABETH LINE: From 2200, a reduced service operates between Paddington and Heathrow Terminal 4 / 5.', at(5, 21), at(6, 0, 29))],
      dlr: [
        planned('dlr', 5, 'Part Closure', 'DOCKLANDS LIGHT RAILWAY: No service between Shadwell and Tower Gateway.', at(toSat + 1, 3, 30), at(toSat + 2, 0, 29)),
        planned('dlr', 5, 'Part Closure', 'DOCKLANDS LIGHT RAILWAY: No service between Shadwell and Tower Gateway.', at(toSat + 1, 3, 30), at(toSat + 2, 0, 29)),
      ],
      northern: [
        { lineId: 'northern', statusSeverity: 9, statusSeverityDescription: 'Minor Delays', reason: 'Northern Line: Minor delays due to an earlier signal failure at Camden Town.', validityPeriods: period(new Date(Date.now() - 3600000).toISOString(), at(1, 0, 29), true), disruption: { category: 'RealTime', categoryDescription: 'RealTime', description: '' } },
        planned('northern', 5, 'Part Closure', 'NORTHERN LINE: Until the end of service tonight, no service between Kennington and Battersea Power Station.', new Date(Date.now() - 7200000).toISOString(), at(1, 0, 29)),
      ],
      'waterloo-city': [planned('waterloo-city', 4, 'Planned Closure', 'Waterloo & City line: service operates 06:00 until 00:30, Monday to Friday only. There is no service on Saturday or Sunday.', at(toSat, 3, 15), at(toSat + 1, 22, 59))],
    };
    return ids.map((id) => ({
      id, name: LINE_NAMES[id] || NETWORK_NAMES[id] || id,
      lineStatuses: works[id] || [{ statusSeverity: 10, statusSeverityDescription: 'Good Service', validityPeriods: [] }],
    }));
  }

  // Simplified route sequences (forward order = first direction code). Real data comes from
  // /Line/{id}/Route/Sequence/all; stations outside the demo set exist only as neighbours.
  const DEMO_ROUTES = {
    central: { dirs: ['EB', 'WB'], ids: ['940GZZLUNHG', '940GZZLUOXC', '940GZZLUBNK', '940GZZLULVT', '940GZZLUSTD', '940GZZLULYS'] },
    victoria: { dirs: ['NB', 'SB'], ids: ['940GZZLUGPK', '940GZZLUOXC', '940GZZLUWRR', '940GZZLUKSX', '940GZZLUHAI'] },
    jubilee: { dirs: ['EB', 'WB'], ids: ['940GZZLUWSM', '940GZZLUWLO', '940GZZLUCYF', '940GZZLUSTD'] },
    northern: { dirs: ['NB', 'SB'], ids: ['940GZZLUKNG', '940GZZLUWLO', '940GZZLUBNK', '940GZZLUKSX', '940GZZLUCTN'] },
    'waterloo-city': { dirs: ['EB', 'WB'], ids: ['940GZZLUWLO', '940GZZLUBNK'] },
    bakerloo: { dirs: ['NB', 'SB'], ids: ['940GZZLULBN', '940GZZLUWLO', '940GZZLUOXC', '940GZZLUBST'] },
    circle: { dirs: ['EB', 'WB'], ids: ['940GZZLUESQ', '940GZZLUKSX', '940GZZLUFCN'] },
    'hammersmith-city': { dirs: ['EB', 'WB'], ids: ['940GZZLUESQ', '940GZZLUKSX', '940GZZLUFCN'] },
    metropolitan: { dirs: ['EB', 'WB'], ids: ['940GZZLUESQ', '940GZZLUKSX', '940GZZLUFCN'] },
    piccadilly: { dirs: ['EB', 'WB'], ids: ['940GZZLURSQ', '940GZZLUKSX', '940GZZLUCAR'] },
  };
  const DEMO_NAMES = {
    '940GZZLUNHG': 'Notting Hill Gate', '940GZZLULVT': 'Liverpool Street', '940GZZLULYS': 'Leytonstone', '940GZZLUGPK': 'Green Park',
    '940GZZLUWRR': 'Warren Street', '940GZZLUHAI': 'Highbury & Islington', '940GZZLUWSM': 'Westminster', '940GZZLUCYF': 'Canary Wharf',
    '940GZZLUKNG': 'Kennington', '940GZZLUCTN': 'Camden Town', '940GZZLULBN': 'Lambeth North', '940GZZLUBST': 'Baker Street',
    '940GZZLUESQ': 'Euston Square', '940GZZLUFCN': 'Farringdon', '940GZZLURSQ': 'Russell Square', '940GZZLUCAR': 'Caledonian Road',
  };
  const demoName = (id) => (NAPTANS[id] ? NAPTANS[id].name.replace(/ Underground Station$/, '') : DEMO_NAMES[id] || id);

  function routeSequence(line) {
    const r = DEMO_ROUTES[line];
    if (!r) return { lineId: line, orderedLineRoutes: [], stopPointSequences: [], stations: [] };
    const rev = [...r.ids].reverse();
    return {
      lineId: line,
      orderedLineRoutes: [{ name: `${demoName(r.ids[0])} ↔ ${demoName(rev[0])}`, naptanIds: r.ids }, { name: `${demoName(rev[0])} ↔ ${demoName(r.ids[0])}`, naptanIds: rev }],
      stopPointSequences: [{ stopPoint: r.ids.map((id) => ({ id, stationId: id, name: demoName(id) + ' Underground Station' })) }],
      stations: [],
    };
  }

  function trainLoadings(naptan, line) {
    if ((LINE_MODE[line] || 'tube') !== 'tube') return [];
    // Like the real response: one row per direction per 15-minute slice, scored 0–6, keyed by the next station.
    const rows = [];
    const r = DEMO_ROUTES[line];
    const slice = (m) => root.TflApi.formatClock(m).replace(':', '') + '-' + root.TflApi.formatClock(m + 15).replace(':', '');
    if (r) {
      for (const [dir, order] of [[r.dirs[0], r.ids], [r.dirs[1], [...r.ids].reverse()]]) {
        const i = order.indexOf(naptan);
        if (i < 0 || i === order.length - 1) continue; // terminus in this direction: no onward row
        const bias = 0.6 + 0.5 * rand(line + dir + naptan);
        for (let m = 5 * 60; m < 24 * 60; m += 15) {
          // Heavier towards the middle of the route, like real loads.
          const mid = 1 - Math.abs(i / Math.max(1, order.length - 1) - 0.5);
          const v = 5.5 * typical(NAPTANS[naptan] ? naptan : '940GZZLUOXC', 'MON', m) * bias * (0.6 + 0.6 * mid);
          rows.push({ line: LINE_NAMES[line], lineDirection: dir, platformDirection: dir, direction: 'Inbound', naptanTo: order[i + 1], timeSlice: slice(m), value: Math.max(0, Math.min(6, Math.round(v))) });
        }
      }
    }
    // Like the real response: ~10 unlabelled passengerFlows values per 15-minute slice.
    const flows = [];
    const lineBias = 0.5 + rand(line + naptan);
    for (let m = 0; m < 24 * 60; m += 15) {
      if (m >= 60 && m < 5 * 60 + 15) continue;
      const total = 4000 * typical(naptan, 'MON', m) * lineBias;
      for (let k = 0; k < 10; k++) {
        flows.push({ timeSlice: root.TflApi.formatClock(m).replace(':', '') + '-' + root.TflApi.formatClock(m + 15).replace(':', ''), value: Math.round((total / 10) * (0.4 + 1.2 * rand(line + m + k))) });
      }
    }
    return { naptanId: naptan, commonName: demoName(naptan), lines: [{ id: line, name: LINE_NAMES[line], crowding: { passengerFlows: NAPTANS[naptan] ? flows : [], trainLoadings: rows } }] };
  }

  function liftDisruptions() {
    return [
      { stationUniqueId: 'HUBSRA', disruptedLiftUniqueIds: ['HUBSRA-Lift-3'], message: 'Stratford: No step-free access between the street and platforms 13 and 14 (Jubilee line) due to a faulty lift. Call us on 0343 222 1234 if you need help planning your journey.' },
      { stationUniqueId: '940GZZLUWYP', disruptedLiftUniqueIds: ['940GZZLUWYP-Lift-5'], message: 'Wembley Park: No lift service between the street and ticket hall.' },
    ];
  }

  function search(q) {
    const needle = q.toLowerCase();
    const matches = [];
    for (const [id, name] of Object.entries(HUBS)) if (name.toLowerCase().includes(needle)) matches.push({ id, name, modes: ['tube'], topMostParentId: id });
    for (const [id, info] of Object.entries(NAPTANS)) {
      if (!info.hub && info.name.toLowerCase().includes(needle)) matches.push({ id, name: info.name.replace(/ Underground Station$/, ''), modes: ['tube'], topMostParentId: id, zone: '1' });
    }
    return { query: q, total: matches.length, matches };
  }

  function route(url) {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const lower = parts.map((p) => p.toLowerCase());
    const now = root.TflApi.londonNow();
    if (lower[0] === 'stoppoint' && lower[1] === 'search') return search(parts[2] || '');
    if (lower[0] === 'stoppoint' && parts[1]) {
      const id = parts[1];
      if (lower[2] === 'arrivals') return NAPTANS[id] ? arrivals(id) : [];
      if (lower[2] === 'crowding') return trainLoadings(id, parts[3]);
      if (HUBS[id]) return hub(id);
      if (NAPTANS[id]) return stopPoint(id);
      return null;
    }
    if (lower[0] === 'disruptions' && lower[1] === 'lifts') return liftDisruptions();
    if (lower[0] === 'line' && lower[2] === 'route' && lower[3] === 'sequence') return routeSequence(parts[1]);
    if (lower[0] === 'line' && lower[1] === 'mode' && lower[3] === 'status') return networkStatus(parts[2].split(','));
    if (lower[0] === 'line' && lower[2] === 'status' && lower[4] === 'to') return statusRange(parts[1].split(','));
    if (lower[0] === 'line' && lower[2] === 'status') return lineStatuses(parts[1].split(','));
    if (lower[0] === 'crowding' && parts[1]) {
      const naptan = parts[1];
      if (!NAPTANS[naptan]) return null;
      if (lower[2] === 'live') {
        const v = typical(naptan, now.day, now.minutes) * (0.8 + 0.45 * rand(naptan + Math.floor(Date.now() / 300000)));
        const d = new Date();
        return { dataAvailable: true, percentageOfBaseline: Number(v.toFixed(3)), timeUtc: d.toISOString(), timeLocal: d.toISOString().slice(0, 10) + ' ' + root.TflApi.formatClock(now.minutes) + ':00' };
      }
      const day = (parts[2] || now.day).toUpperCase();
      const peak = (mu) => root.TflApi.formatClock(mu) + '-' + root.TflApi.formatClock(mu + 15);
      return { naptan, dayOfWeek: day, amPeakTimeBand: peak(495), pmPeakTimeBand: peak(1065), timeBands: timeBands(naptan, day), isFound: true, isAlwaysQuiet: false };
    }
    return null;
  }

  function createFetch() {
    return async function demoFetch(url) {
      await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
      const body = route(url);
      return {
        ok: body !== null,
        status: body === null ? 404 : 200,
        json: async () => body,
      };
    };
  }

  root.TflDemo = { createFetch, stations: Object.keys(HUBS).concat(['940GZZLUOXC']), routeSequence };
})(typeof window !== 'undefined' ? window : globalThis);
