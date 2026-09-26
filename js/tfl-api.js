/*
 * TfL API client + response normalisation.
 *
 * Endpoints used (all on https://api.tfl.gov.uk):
 *   Unified API
 *     GET /StopPoint/Search/{query}?modes=...     station search
 *     GET /StopPoint/{id}                         station, child stops, lines per NaPTAN
 *     GET /StopPoint/{id}/Arrivals                live arrivals per platform
 *     GET /StopPoint/{id}/Crowding/{line}         static train-loading data per line
 *     GET /Line/{ids}/Status                      line status / disruption
 *   Crowding API
 *     GET /crowding/{naptan}/Live                 live station busyness (% of baseline)
 *     GET /crowding/{naptan}/{dayOfWeek}          typical busyness in 15-minute bands
 *
 * Classic script (no modules) so index.html also works when opened from disk;
 * also exported for Node so the pure helpers can be unit-tested.
 */
(function (root) {
  'use strict';

  const BASE_URL = 'https://api.tfl.gov.uk';
  const RAIL_MODES = ['tube', 'elizabeth-line', 'dlr', 'overground', 'tram'];
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  // The chart's x-axis runs over the "service day", starting at 04:00.
  const SERVICE_DAY_START = 4 * 60;

  const MODE_LABELS = {
    tube: 'Underground',
    'elizabeth-line': 'Elizabeth line',
    dlr: 'DLR',
    overground: 'Overground',
    tram: 'Tram',
  };

  // Official TfL line colours.
  const LINE_COLOURS = {
    bakerloo: '#B36305',
    central: '#E32017',
    circle: '#FFD300',
    district: '#00782A',
    'hammersmith-city': '#F3A9BB',
    jubilee: '#A0A5A9',
    metropolitan: '#9B0056',
    northern: '#000000',
    piccadilly: '#003688',
    victoria: '#0098D4',
    'waterloo-city': '#95CDBA',
    elizabeth: '#6950A1',
    dlr: '#00A4A7',
    'london-overground': '#EE7C0E',
    liberty: '#5D6061',
    lioness: '#FAA61A',
    mildmay: '#0077AD',
    suffragette: '#5BBD72',
    weaver: '#823A62',
    windrush: '#ED1B00',
    tram: '#84B817',
  };

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  /** Read a property ignoring case (the API is inconsistent: percentageOfBaseLine vs percentageOfBaseline). */
  function pick(obj, name) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (name in obj) return obj[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === lower) return obj[key];
    }
    return undefined;
  }

  /** Crowding values are a fraction of the station's baseline (busiest) level; tolerate percentages too. */
  function toFraction(value) {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
    return n > 3 ? n / 100 : n;
  }

  /** "08:15" / "0815" / "08:15-08:30" → minutes after midnight of the first time found. */
  function parseClock(text) {
    const m = /(\d{1,2}):?(\d{2})/.exec(String(text || ''));
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 29 || min > 59) return null;
    return (h * 60 + min) % 1440;
  }

  function serviceMinutes(minutes) {
    return (minutes - SERVICE_DAY_START + 1440) % 1440;
  }

  function formatClock(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  /** Current day-of-week and minutes-after-midnight in London, whatever the viewer's timezone. */
  function londonNow(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date || new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const day = get('weekday').slice(0, 3).toUpperCase();
    return { day: DAYS.includes(day) ? day : DAYS[(date || new Date()).getDay()], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  }

  const LEVELS = [
    { max: 0.25, key: 'quiet', label: 'Quiet', pips: 1 },
    { max: 0.5, key: 'moderate', label: 'Moderately busy', pips: 2 },
    { max: 0.75, key: 'busy', label: 'Busy', pips: 3 },
    { max: Infinity, key: 'very-busy', label: 'Very busy', pips: 4 },
  ];

  function crowdingLevel(fraction) {
    if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
      return { key: 'unknown', label: 'No data', pips: 0 };
    }
    return LEVELS.find((l) => fraction < l.max);
  }

  function normalizeLive(raw) {
    const value = toFraction(pick(raw, 'percentageOfBaseline'));
    const flag = pick(raw, 'dataAvailable');
    return {
      available: flag !== false && value !== null,
      value,
      timeLocal: pick(raw, 'timeLocal') || null,
      timeUtc: pick(raw, 'timeUtc') || null,
    };
  }

  /**
   * Accepts either the single-day shape ({dayOfWeek, timeBands, ...}) or the
   * all-days shape ({daysOfWeek: [...]}) and returns the requested day's bands.
   */
  function normalizeDay(raw, day) {
    let dayObj = raw;
    const days = pick(raw, 'daysOfWeek');
    if (Array.isArray(days)) {
      dayObj = days.find((d) => String(pick(d, 'dayOfWeek') || '').toUpperCase().startsWith(day)) || days[0] || {};
    }
    const bands = (pick(dayObj, 'timeBands') || [])
      .map((b) => {
        const text = pick(b, 'timeBand');
        const start = parseClock(text);
        const value = toFraction(pick(b, 'percentageOfBaseLine'));
        if (start === null || value === null) return null;
        return { start, label: String(text), x: serviceMinutes(start), value };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    const isFound = pick(raw, 'isFound');
    return {
      found: isFound !== false && bands.length > 0,
      alwaysQuiet: pick(raw, 'isAlwaysQuiet') === true,
      amPeak: pick(dayObj, 'amPeakTimeBand') || null,
      pmPeak: pick(dayObj, 'pmPeakTimeBand') || null,
      bands,
    };
  }

  /** The typical value for the 15-minute band containing `minutes`. */
  function bandAt(bands, minutes) {
    if (!bands || !bands.length) return null;
    const x = serviceMinutes(minutes);
    let best = null;
    for (const b of bands) {
      if (b.x <= x && x < b.x + 15) return b;
      if (!best || Math.abs(b.x - x) < Math.abs(best.x - x)) best = b;
    }
    return best && Math.abs(best.x - x) <= 30 ? best : null;
  }

  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isStationNaptan(id) {
    return /^(940G|910G)/i.test(String(id || ''));
  }

  function lineColour(id) {
    return LINE_COLOURS[id] || '#6b6b6b';
  }

  function naptanLabel(modes) {
    const labels = [...new Set(modes)].map((m) => MODE_LABELS[m] || m);
    if (labels.length <= 1) return labels[0] || 'Station';
    return labels.slice(0, -1).join(', ') + ' & ' + labels[labels.length - 1];
  }

  /**
   * Turn a /StopPoint/{id} response into:
   *   lines:   [{id, name, mode, naptan, colour}]
   *   naptans: [{id, label, modes, lineIds}]  (one per station NaPTAN — each has its own crowding feed)
   */
  function buildStationModel(stop) {
    const nodes = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      nodes.push(n);
      (n.children || []).forEach(walk);
    })(stop);

    const lineMode = new Map();
    const lineName = new Map();
    for (const n of nodes) {
      for (const g of n.lineModeGroups || []) {
        for (const id of g.lineIdentifier || []) if (!lineMode.has(id)) lineMode.set(id, g.modeName);
      }
      for (const l of n.lines || []) if (l && l.id && !lineName.has(l.id)) lineName.set(l.id, l.name || l.id);
    }

    const lineNaptan = new Map();
    for (const n of nodes) {
      for (const g of n.lineGroup || []) {
        let naptan = g.stationAtcoCode || g.naptanIdReference;
        if (!isStationNaptan(naptan)) naptan = isStationNaptan(n.naptanId || n.id) ? n.naptanId || n.id : null;
        if (!naptan) continue;
        for (const id of g.lineIdentifier || []) if (!lineNaptan.has(id)) lineNaptan.set(id, naptan);
      }
    }
    // Lines listed without a lineGroup entry: attach to the node's own NaPTAN.
    for (const n of nodes) {
      const own = n.naptanId || n.id;
      if (!isStationNaptan(own)) continue;
      for (const l of n.lines || []) if (l && l.id && !lineNaptan.has(l.id)) lineNaptan.set(l.id, own);
    }

    const lines = [];
    for (const [id, naptan] of lineNaptan) {
      const mode = lineMode.get(id);
      if (!RAIL_MODES.includes(mode)) continue;
      lines.push({ id, name: lineName.get(id) || id, mode, naptan, colour: lineColour(id) });
    }
    lines.sort((a, b) => RAIL_MODES.indexOf(a.mode) - RAIL_MODES.indexOf(b.mode) || a.name.localeCompare(b.name));

    const naptanMap = new Map();
    for (const l of lines) {
      if (!naptanMap.has(l.naptan)) naptanMap.set(l.naptan, { id: l.naptan, modes: [], lineIds: [] });
      const g = naptanMap.get(l.naptan);
      g.lineIds.push(l.id);
      if (!g.modes.includes(l.mode)) g.modes.push(l.mode);
    }
    const naptans = [...naptanMap.values()].map((g) => ({ ...g, label: naptanLabel(g.modes) }));

    const zoneProp = (stop.additionalProperties || []).find((p) => p && p.key === 'Zone');
    return {
      id: stop.naptanId || stop.id,
      name: stop.commonName || stop.name || stop.id,
      zone: zoneProp ? zoneProp.value : null,
      modes: [...new Set(lines.map((l) => l.mode))],
      lines,
      naptans,
    };
  }

  const STATUS_CLASSES = {
    good: [10, 18, 19],
    info: [0, 20],
    warning: [7, 9, 12, 13, 14, 15, 17],
    serious: [3, 5, 6, 8, 11],
    critical: [1, 2, 4, 16],
  };
  const STATUS_RANK = { good: 0, info: 1, warning: 2, serious: 3, critical: 4 };

  function statusClass(severity) {
    for (const [cls, list] of Object.entries(STATUS_CLASSES)) if (list.includes(severity)) return cls;
    return 'info';
  }

  /** /Line/{ids}/Status → Map(lineId → {cls, description, reasons}) */
  function normalizeStatuses(raw) {
    const out = new Map();
    for (const line of raw || []) {
      const statuses = line.lineStatuses || [];
      let cls = statuses.length ? 'good' : 'info';
      const descriptions = [];
      const reasons = [];
      for (const s of statuses) {
        const c = statusClass(s.statusSeverity);
        if (STATUS_RANK[c] > STATUS_RANK[cls]) cls = c;
        if (s.statusSeverityDescription && !descriptions.includes(s.statusSeverityDescription)) descriptions.push(s.statusSeverityDescription);
        if (s.reason && !reasons.includes(s.reason)) reasons.push(s.reason);
      }
      out.set(line.id, { cls, description: descriptions.join(', ') || 'Status unavailable', reasons });
    }
    return out;
  }

  /** /StopPoint/{id}/Arrivals → [{platform, trains:[{destination, minutes, location}]}] for one line. */
  function summarizeArrivals(arrivals, lineId, perPlatform) {
    const limit = perPlatform || 3;
    const byPlatform = new Map();
    for (const a of arrivals || []) {
      if (a.lineId !== lineId) continue;
      const named = a.platformName && !/^platform unknown$/i.test(a.platformName) ? a.platformName : null;
      const platform = named || 'Platform not yet confirmed';
      if (!byPlatform.has(platform)) byPlatform.set(platform, []);
      byPlatform.get(platform).push({
        destination: String(a.destinationName || a.towards || 'Check front of train').replace(/\s+(Underground|DLR|Rail|Overground)\s+Station$/i, ''),
        minutes: Math.max(0, Math.round((a.timeToStation || 0) / 60)),
        seconds: a.timeToStation || 0,
        location: a.currentLocation || '',
      });
    }
    return [...byPlatform.entries()]
      .map(([platform, trains]) => ({ platform, trains: trains.sort((x, y) => x.seconds - y.seconds).slice(0, limit) }))
      .sort((a, b) => {
        const au = a.platform === 'Platform not yet confirmed';
        const bu = b.platform === 'Platform not yet confirmed';
        return au - bu || a.platform.localeCompare(b.platform, 'en', { numeric: true });
      });
  }

  const DIRECTION_NAMES = { NB: 'Northbound', SB: 'Southbound', EB: 'Eastbound', WB: 'Westbound' };

  /**
   * /StopPoint/{id}/Crowding/{line} → per-direction train loading at `minutes`,
   * expressed relative to that direction's busiest time slice (the raw scale isn't documented).
   */
  function summarizeTrainLoadings(raw, line, minutes) {
    const found = [];
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      for (const [k, child] of Object.entries(v)) {
        if (k.toLowerCase() === 'trainloadings' && Array.isArray(child)) found.push(...child);
        else walk(child);
      }
    })(raw);
    const wanted = [slug(line.id), slug(line.name)];
    let rows = found.filter((t) => !t.line || wanted.includes(slug(t.line)));
    const byDir = new Map();
    for (const t of rows) {
      const start = parseClock(t.timeSlice);
      const value = Number(t.value);
      if (start === null || !Number.isFinite(value)) continue;
      const raw = t.lineDirection || t.platformDirection || t.direction || 'All trains';
      const dir = DIRECTION_NAMES[String(raw).toUpperCase()] || raw;
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push({ x: serviceMinutes(start), value });
    }
    const nowX = serviceMinutes(minutes);
    const out = [];
    for (const [direction, slices] of byDir) {
      const max = Math.max(...slices.map((s) => s.value));
      if (!(max > 0)) continue;
      const current = slices.filter((s) => s.x <= nowX).sort((a, b) => b.x - a.x)[0];
      if (!current || nowX - current.x > 60) continue;
      out.push({ direction: String(direction), relative: current.value / max });
    }
    return out.sort((a, b) => a.direction.localeCompare(b.direction));
  }

  // ---------------------------------------------------------------------------
  // HTTP client
  // ---------------------------------------------------------------------------

  function createClient(options) {
    const opts = options || {};
    const fetchImpl = opts.fetch || ((...args) => root.fetch(...args));
    const enc = encodeURIComponent;

    async function get(path, params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
      if (opts.appKey) qs.set('app_key', opts.appKey);
      const url = BASE_URL + path + (qs.toString() ? '?' + qs.toString() : '');
      let res;
      try {
        res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      } catch (e) {
        const err = new Error('Network error contacting the TfL API');
        err.cause = e;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(
          res.status === 429
            ? 'TfL API rate limit reached — add an app key in Settings or wait a minute'
            : `TfL API returned ${res.status} for ${path}`
        );
        err.status = res.status;
        throw err;
      }
      return res.json();
    }

    return {
      async searchStations(query) {
        const data = await get(`/StopPoint/Search/${enc(query)}`, { modes: RAIL_MODES.join(','), maxResults: 15 });
        const seen = new Set();
        const out = [];
        for (const m of data.matches || []) {
          const id = m.topMostParentId || m.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push({ id, name: m.name, modes: (m.modes || []).filter((x) => RAIL_MODES.includes(x)), zone: m.zone || null });
        }
        return out;
      },

      /** Loads a stop and climbs to its hub (e.g. HUBSRA for Stratford) so every line at the station is included. */
      async getStation(id) {
        let stop = await get(`/StopPoint/${enc(id)}`);
        if (Array.isArray(stop)) stop = stop[0];
        if (stop && stop.hubNaptanCode && stop.hubNaptanCode !== (stop.naptanId || stop.id)) {
          try {
            let hub = await get(`/StopPoint/${enc(stop.hubNaptanCode)}`);
            if (Array.isArray(hub)) hub = hub[0];
            const model = buildStationModel(hub);
            if (model.lines.length) return model;
          } catch (e) {
            /* fall back to the stop itself */
          }
        }
        return buildStationModel(stop);
      },

      async getLiveCrowding(naptan) {
        return normalizeLive(await get(`/crowding/${enc(naptan)}/Live`));
      },

      async getDayCrowding(naptan, day) {
        return normalizeDay(await get(`/crowding/${enc(naptan)}/${enc(day)}`), day);
      },

      async getArrivals(naptan) {
        return get(`/StopPoint/${enc(naptan)}/Arrivals`);
      },

      async getLineStatuses(lineIds) {
        if (!lineIds.length) return new Map();
        return normalizeStatuses(await get(`/Line/${lineIds.map(enc).join(',')}/Status`));
      },

      async getTrainLoadings(naptan, lineId) {
        return get(`/StopPoint/${enc(naptan)}/Crowding/${enc(lineId)}`, { direction: 'all' });
      },
    };
  }

  const api = {
    BASE_URL,
    RAIL_MODES,
    MODE_LABELS,
    createClient,
    pick,
    toFraction,
    parseClock,
    serviceMinutes,
    formatClock,
    londonNow,
    crowdingLevel,
    normalizeLive,
    normalizeDay,
    bandAt,
    buildStationModel,
    normalizeStatuses,
    summarizeArrivals,
    summarizeTrainLoadings,
    lineColour,
  };

  root.TflApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
