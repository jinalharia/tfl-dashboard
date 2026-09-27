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

  // Station information (package A): facilities, nearby bike docks and station notices, shaped like
  // /StopPoint/{id} additionalProperties, /Occupancy/BikePoints/{ids}, /Place?type=BikePoint and
  // /StopPoint/{id}/Disruption. Values are loosely based on the real responses from 2026-09-27.
  const FACILITIES = {
    '940GZZLUKSX': { Lifts: '10', Escalators: '19', Toilets: 'no', WiFi: 'yes', 'Cash Machines': '9', 'Ticket Halls': '4', 'Help Points': '0 on platforms, 0 in ticket halls, 0 elsewhere', Payphones: '4' },
    '940GZZLUOXC': { Lifts: '0', Escalators: '14', Toilets: 'no', WiFi: 'yes', 'Cash Machines': '3', 'Ticket Halls': '2', 'Help Points': '18 on platforms, 0 in ticket halls, 18 elsewhere' },
    '940GZZLUBNK': { Lifts: '12', Escalators: '33', Toilets: 'no', WiFi: 'yes', 'Ticket Halls': '5' },
    '940GZZDLBNK': { Lifts: '4', Escalators: '6', Toilets: 'no', WiFi: 'yes', 'Ticket Halls': '1' },
    '940GZZLUWLO': { Lifts: '7', Escalators: '23', Toilets: 'yes', WiFi: 'yes', 'Cash Machines': '6', 'Ticket Halls': '3' },
  };
  const STRATFORD_FACILITIES = { Lifts: '5', Escalators: '2', Toilets: 'yes', WiFi: 'yes', 'Cash Machines': '4', 'Ticket Halls': '2', 'Help Points': '0 on platforms, 0 in ticket halls, 0 elsewhere' };
  const BIKE_DOCKS = {
    BikePoints_4: { name: "St. Chad's Street, King's Cross", total: 23, lat: 51.530059, lon: -0.120973 },
    BikePoints_14: { name: 'Argyle Street, Kings Cross', total: 45, lat: 51.530558, lon: -0.123171 },
    BikePoints_70: { name: "Calshot Street , King's Cross", total: 24, lat: 51.531048, lon: -0.117362 },
    BikePoints_798: { name: "Birkenhead Street, King's Cross", total: 26, lat: 51.530199, lon: -0.122299 },
    BikePoints_116: { name: 'Little Argyll Street, West End', total: 21, lat: 51.514499, lon: -0.141423 },
    BikePoints_313: { name: 'Wells Street, Fitzrovia', total: 38, lat: 51.517931, lon: -0.138304 },
    BikePoints_349: { name: 'St. George Street, Mayfair', total: 18, lat: 51.513093, lon: -0.143986 },
    BikePoints_6: { name: 'Broadcasting House, Marylebone', total: 18, lat: 51.518117, lon: -0.144228 },
    BikePoints_790: { name: 'Stratford Station, Stratford', total: 30, lat: 51.541793, lon: -0.003853 },
    BikePoints_785: { name: 'Aquatic Centre, Queen Elizabeth Olympic Park', total: 40, lat: 51.540940, lon: -0.010511 },
    BikePoints_340: { name: 'Bank of England Museum, Bank', total: 22, lat: 51.514441, lon: -0.087587 },
    BikePoints_101: { name: 'Queen Street 1, Bank', total: 24, lat: 51.511553, lon: -0.092940 },
    BikePoints_154: { name: 'Waterloo Station 3, Waterloo', total: 55, lat: 51.503791, lon: -0.112824 },
    BikePoints_361: { name: 'Waterloo Station 2, Waterloo', total: 44, lat: 51.504027, lon: -0.113864 },
  };
  const NEAREST_BIKES = {
    '940GZZLUKSX': ['BikePoints_4', 'BikePoints_14', 'BikePoints_70', 'BikePoints_798'],
    '940GZZLUOXC': ['BikePoints_6', 'BikePoints_116', 'BikePoints_313', 'BikePoints_349'],
    '940GZZLUSTD': ['BikePoints_785', 'BikePoints_790'],
    '910GSTFD': ['BikePoints_785', 'BikePoints_790'],
    '940GZZLUBNK': ['BikePoints_101', 'BikePoints_340'],
    '940GZZLUWLO': ['BikePoints_154', 'BikePoints_361'],
  };
  const COORDS = {
    '940GZZLUKSX': [51.530312, -0.123853], '940GZZLUOXC': [51.515224, -0.141903], '940GZZLUSTD': [51.541806, -0.003458],
    '910GSTFD': [51.541895, -0.003397], '940GZZDLSTD': [51.541806, -0.003458], '940GZZLUBNK': [51.513356, -0.088899],
    '940GZZDLBNK': [51.513356, -0.088899], '940GZZLUWLO': [51.503299, -0.11478],
    HUBKGX: [51.531683, -0.123538], HUBSRA: [51.541508, -0.00241], HUBBAN: [51.513356, -0.088899], HUBWAT: [51.503299, -0.11478],
  };

  function stationProps(naptan) {
    const facilities = NAPTANS[naptan] && NAPTANS[naptan].hub === 'HUBSRA' ? STRATFORD_FACILITIES : FACILITIES[naptan] || {};
    return [
      ...Object.entries(facilities).map(([key, value]) => ({ category: 'Facility', key, sourceSystemKey: 'StaticObjects', value })),
      ...(naptan === '940GZZLUKSX' ? [{ category: 'VisitorCentre', key: 'Location', sourceSystemKey: 'StaticObjects', value: 'Western Ticket Hall Underground Station' }] : []),
      { category: 'Address', key: 'PhoneNo', sourceSystemKey: 'StaticObjects', value: '0845 330 9880' },
      ...(NEAREST_BIKES[naptan] || []).concat(['TaxiRank_5237']).map((value) => ({ category: 'NearestPlaces', key: 'SourceSystemPlaceId', sourceSystemKey: 'StaticObjects', value })),
    ];
  }

  function distanceM(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
    const y = (lat2 - lat1) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
  }

  function bikeOccupancy(ids) {
    const slot = Math.floor(Date.now() / 60000);
    return ids.filter((id) => BIKE_DOCKS[id]).map((id) => {
      const dock = BIKE_DOCKS[id];
      const bikes = id === 'BikePoints_116' ? 0 : Math.round(rand(id + slot) * dock.total * 0.7);
      const eBikes = Math.min(bikes, Math.round(rand(id + 'e' + slot) * 3));
      const broken = Math.round(rand(id + 'x') * 2);
      return {
        $type: 'Tfl.Api.Presentation.Entities.BikePointOccupancy, Tfl.Api.Presentation.Entities',
        id, name: dock.name, bikesCount: bikes, emptyDocks: Math.max(0, dock.total - bikes - broken), totalDocks: dock.total,
        standardBikesCount: bikes - eBikes, eBikesCount: eBikes,
      };
    });
  }

  function bikePlaces(lat, lon, radius) {
    const places = Object.entries(BIKE_DOCKS)
      .map(([id, d]) => ({ $type: 'Tfl.Api.Presentation.Entities.Place, Tfl.Api.Presentation.Entities', id, url: `/Place/${id}`, commonName: d.name, distance: distanceM(lat, lon, d.lat, d.lon), placeType: 'BikePoint', lat: d.lat, lon: d.lon }))
      .filter((p) => p.distance <= radius);
    return { $type: 'Tfl.Api.Presentation.Entities.PlacesResponse, Tfl.Api.Presentation.Entities', centrePoint: [lat, lon], places };
  }

  function stationDisruptions(id) {
    const day = (offset, hh, mm) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offset);
      d.setUTCHours(hh, mm, 0, 0);
      return d.toISOString().replace('.000Z', 'Z');
    };
    const point = (atcoCode, commonName, mode, extra) => ({
      $type: 'Tfl.Api.Presentation.Entities.DisruptedPoint, Tfl.Api.Presentation.Entities',
      atcoCode, stationAtcoCode: atcoCode, commonName, mode, ...extra,
    });
    if (id === 'HUBSRA' || NAPTANS[id] && NAPTANS[id].hub === 'HUBSRA') {
      // Like the real response: the rail notice is repeated once per mode.
      const mildmay = {
        fromDate: day(0, 21, 15), toDate: day(1, 0, 29), type: 'Part Closure', appearance: 'PlannedWork',
        description: 'MILDMAY LINE: After 2215 tonight, no service between Camden Road and Stratford. Rail replacement buses run between Camden Road and Stratford.',
      };
      return [
        point('910GSTFD', 'Stratford (London) Rail Station', 'elizabeth-line', mildmay),
        point('910GSTFD', 'Stratford (London) Rail Station', 'national-rail', mildmay),
        point('910GSTFD', 'Stratford (London) Rail Station', 'overground', mildmay),
        point('940GZZLUSTD', 'Stratford Underground Station', 'tube', {
          fromDate: day(-1, 3, 32), toDate: day(1, 0, 29), type: 'Part Closure', appearance: 'PlannedWork',
          description: 'CENTRAL LINE: No service between Liverpool Street and Woodford / Newbury Park this weekend. Replacement buses operate.',
          additionalInformation: 'Replacement bus services operate: Service CL5: Stratford City Bus Station - Leyton - Leytonstone - Snaresbrook - South Woodford - Woodford.',
        }),
      ];
    }
    if (id === '940GZZLUOXC') {
      return [point('940GZZLUOXC', 'Oxford Circus Underground Station', 'tube', {
        fromDate: day(-20, 2, 7), toDate: day(1, 0, 29), type: 'Interchange Message', appearance: 'RealTime',
        description: 'Oxford Circus Station: reduced escalator service - there is no up escalator in service from the Central line due to a fault.',
      })];
    }
    return [];
  }

  // Deterministic pseudo-random numbers so the demo is stable within a minute.
  function rand(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return ((h >>> 0) % 10000) / 10000;
  }

  function typical(naptan, day, minutes) {
    // Stations outside the demo set (neighbours on the demo routes) get a steady made-up scale.
    const s = NAPTANS[naptan] ? NAPTANS[naptan].scale : 0.3 + 0.6 * rand('scale' + naptan);
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
      additionalProperties: [{ category: 'Geo', key: 'Zone', value: naptan.includes('BNK') || naptan.includes('OXC') || naptan.includes('KSX') ? '1' : '2/3' }, ...stationProps(naptan)],
      lat: (COORDS[naptan] || [])[0], lon: (COORDS[naptan] || [])[1],
      children: [],
    };
  }

  function hub(id) {
    const children = Object.keys(NAPTANS).filter((n) => NAPTANS[n].hub === id).map(stopPoint);
    return {
      naptanId: id, id, commonName: HUBS[id], stopType: 'TransportInterchange', modes: [...new Set(children.flatMap((c) => c.modes))],
      lines: children.flatMap((c) => c.lines), lineGroup: [], lineModeGroups: [],
      additionalProperties: children[0].additionalProperties, lat: COORDS[id][0], lon: COORDS[id][1], children,
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
  // `branches` are extra routes in the same direction, like the real Northern line's several routes.
  const DEMO_ROUTES = {
    central: { dirs: ['EB', 'WB'], ids: ['940GZZLUNHG', '940GZZLUOXC', '940GZZLUBNK', '940GZZLULVT', '940GZZLUSTD', '940GZZLULYS'] },
    // The whole Victoria line, as in the real response (16 stations, Brixton → Walthamstow Central).
    victoria: { dirs: ['NB', 'SB'], ids: ['940GZZLUBXN', '940GZZLUSKW', '940GZZLUVXL', '940GZZLUPCO', '940GZZLUVIC', '940GZZLUGPK', '940GZZLUOXC', '940GZZLUWRR', '940GZZLUEUS', '940GZZLUKSX', '940GZZLUHAI', '940GZZLUFPK', '940GZZLUSVS', '940GZZLUTMH', '940GZZLUBLR', '940GZZLUWWL'] },
    jubilee: { dirs: ['EB', 'WB'], ids: ['940GZZLUWSM', '940GZZLUWLO', '940GZZLUCYF', '940GZZLUSTD'] },
    northern: {
      dirs: ['NB', 'SB'], ids: ['940GZZLUKNG', '940GZZLUWLO', '940GZZLUBNK', '940GZZLUKSX', '940GZZLUCTN', '940GZZLUHGT', '940GZZLUFYC', '940GZZLUWOP', '940GZZLUHBT'],
      branches: [['940GZZLUKNG', '940GZZLUWLO', '940GZZLUBNK', '940GZZLUKSX', '940GZZLUCTN', '940GZZLUHGT', '940GZZLUFYC', '940GZZLUMHL']],
    },
    'waterloo-city': { dirs: ['EB', 'WB'], ids: ['940GZZLUWLO', '940GZZLUBNK'] },
    bakerloo: { dirs: ['NB', 'SB'], ids: ['940GZZLULBN', '940GZZLUWLO', '940GZZLUOXC', '940GZZLUBST', '940GZZLUHAW'] },
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
    '940GZZLUBXN': 'Brixton', '940GZZLUSKW': 'Stockwell', '940GZZLUVXL': 'Vauxhall', '940GZZLUPCO': 'Pimlico', '940GZZLUVIC': 'Victoria',
    '940GZZLUEUS': 'Euston', '940GZZLUFPK': 'Finsbury Park', '940GZZLUSVS': 'Seven Sisters', '940GZZLUTMH': 'Tottenham Hale',
    '940GZZLUBLR': 'Blackhorse Road', '940GZZLUWWL': 'Walthamstow Central', '940GZZLUHGT': 'Highgate', '940GZZLUHBT': 'High Barnet',
    '940GZZLUFYC': 'Finchley Central', '940GZZLUWOP': 'Woodside Park', '940GZZLUMHL': 'Mill Hill East', '940GZZLUHAW': 'Harrow & Wealdstone',
  };
  // Like the real Network Rail-run stations (e.g. Harrow & Wealdstone): /crowding/{id}/Live says dataAvailable false.
  const NO_LIVE_DATA = new Set(['940GZZLUHAW']);
  const demoName = (id) => (NAPTANS[id] ? NAPTANS[id].name.replace(/ Underground Station$/, '') : DEMO_NAMES[id] || id);

  function routeSequence(line) {
    const r = DEMO_ROUTES[line];
    if (!r) return { lineId: line, orderedLineRoutes: [], stopPointSequences: [], stations: [] };
    // Like the real response: each route once per direction, names HTML-encoded ("A  &harr;  B").
    const both = (ids) => {
      const rev = [...ids].reverse();
      return [{ name: `${demoName(ids[0])}  &harr;  ${demoName(rev[0])} `, naptanIds: ids }, { name: `${demoName(rev[0])}  &harr;  ${demoName(ids[0])} `, naptanIds: rev }];
    };
    return {
      lineId: line,
      orderedLineRoutes: [r.ids, ...(r.branches || [])].flatMap(both),
      stopPointSequences: [r.ids, ...(r.branches || [])].map((ids) => ({ stopPoint: ids.map((id) => ({ id, stationId: id, name: demoName(id) + ' Underground Station' })) })),
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
      if (lower[2] === 'disruption') return HUBS[id] || NAPTANS[id] ? stationDisruptions(id) : null;
      if (HUBS[id]) return hub(id);
      if (NAPTANS[id]) return stopPoint(id);
      return null;
    }
    if (lower[0] === 'disruptions' && lower[1] === 'lifts') return liftDisruptions();
    if (lower[0] === 'occupancy' && lower[1] === 'bikepoints' && parts[2]) return bikeOccupancy(parts[2].split(','));
    if (lower[0] === 'place' && !parts[1] && u.searchParams.get('type') === 'BikePoint') {
      return bikePlaces(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lon')), Number(u.searchParams.get('radius')) || 800);
    }
    if (lower[0] === 'line' && lower[2] === 'route' && lower[3] === 'sequence') return routeSequence(parts[1]);
    if (lower[0] === 'line' && lower[1] === 'mode' && lower[3] === 'status') return networkStatus(parts[2].split(','));
    if (lower[0] === 'line' && lower[2] === 'status' && lower[4] === 'to') return statusRange(parts[1].split(','));
    if (lower[0] === 'line' && lower[2] === 'status') return lineStatuses(parts[1].split(','));
    if (lower[0] === 'crowding' && parts[1]) {
      const naptan = parts[1];
      if (lower[2] === 'live' && NO_LIVE_DATA.has(naptan)) return { dataAvailable: false, percentageOfBaseline: 0, timeUtc: null, timeLocal: null };
      if (!NAPTANS[naptan] && !(lower[2] === 'live' && DEMO_NAMES[naptan])) return null;
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
