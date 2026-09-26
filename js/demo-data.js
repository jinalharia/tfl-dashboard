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
    'waterloo-city': ['Platform 9'],
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
  };
  const HUBS = {
    HUBKGX: "King's Cross & St Pancras International",
    HUBSRA: 'Stratford',
    HUBBAN: 'Bank',
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
          const dest = dests[(p + i) % dests.length];
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

  function trainLoadings(naptan, line) {
    if ((LINE_MODE[line] || 'tube') !== 'tube') return [];
    const dirs = (PLATFORMS[line] || ['Northbound', 'Southbound']).map((p) => p.split(' - ')[0]);
    const rows = [];
    for (const dir of dirs) {
      for (let m = 5 * 60; m < 24 * 60; m += 15) {
        const bias = rand(line + dir) * 0.4 + 0.6;
        rows.push({ line: LINE_NAMES[line], lineDirection: dir, direction: dir, naptanTo: '', timeSlice: root.TflApi.formatClock(m).replace(':', '') + '-' + root.TflApi.formatClock(m + 15).replace(':', ''), value: Math.round(1 + 5 * typical(naptan, 'MON', m) * bias) });
      }
    }
    return [{ naptanId: naptan, commonName: NAPTANS[naptan].name, lines: [{ id: line, name: LINE_NAMES[line], crowding: { passengerFlows: [], trainLoadings: rows } }] }];
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
      if (lower[2] === 'crowding') return NAPTANS[id] ? trainLoadings(id, parts[3]) : [];
      if (HUBS[id]) return hub(id);
      if (NAPTANS[id]) return stopPoint(id);
      return null;
    }
    if (lower[0] === 'line' && lower[2] === 'status') return lineStatuses(parts[1].split(','));
    if (lower[0] === 'crowding' && parts[1]) {
      const naptan = parts[1];
      if (!NAPTANS[naptan]) return null;
      if (lower[2] === 'live') {
        const v = typical(naptan, now.day, now.minutes) * (0.8 + 0.45 * rand(naptan + Math.floor(Date.now() / 300000)));
        const d = new Date();
        return { dataAvailable: true, percentageOfBaseline: Number(v.toFixed(3)), timeUtc: d.toISOString(), timeLocal: d.toISOString().slice(0, 11) + root.TflApi.formatClock(now.minutes) + ':00' };
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

  root.TflDemo = { createFetch, stations: Object.keys(HUBS).concat(['940GZZLUOXC']) };
})(typeof window !== 'undefined' ? window : globalThis);
