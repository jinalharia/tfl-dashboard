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
 *     GET /Line/Mode/{modes}/Status               status of every line in these modes (network strip)
 *     GET /Line/{ids}/Status/{from}/to/{to}       planned closures over a date range
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

  /**
   * TfL's static crowding response also carries `passengerFlows` for the requested line:
   * several unlabelled values per 15-minute slice. Summing them per slice gives the
   * line's typical passenger flow at this station by time of day.
   * → { bands: [{x, start, value}], peak: {start, value} } or null
   */
  function summarizePassengerFlows(raw, line) {
    const entries = [];
    for (const l of (raw && raw.lines) || []) {
      if (l && slug(l.id) !== slug(line.id) && slug(l.name) !== slug(line.name)) continue;
      const flows = pick(pick(l, 'crowding'), 'passengerFlows');
      if (Array.isArray(flows)) entries.push(...flows);
    }
    const totals = new Map();
    for (const f of entries) {
      const start = parseClock(f.timeSlice);
      const value = Number(f.value);
      if (start === null || !Number.isFinite(value)) continue;
      totals.set(start, (totals.get(start) || 0) + value);
    }
    if (!totals.size) return null;
    const bands = [...totals.entries()]
      .map(([start, value]) => ({ start, x: serviceMinutes(start), value }))
      .sort((a, b) => a.x - b.x);
    const peak = bands.reduce((best, b) => (b.value > best.value ? b : best), bands[0]);
    if (!(peak.value > 0)) return null;
    return { bands, peak: { start: peak.start, value: peak.value } };
  }

  /**
   * When is it usually quieter (or busier)? Looks ahead through today's typical bands
   * from `minutes`, starting from the live value if there is one, else the typical value now.
   * Returns one of:
   *   {kind: 'quieter', start, value}  first band (held for 30 min) a crowding level below now
   *   {kind: 'stays'}                  no quieter period within the window
   *   {kind: 'busier', start, value}   currently quiet, but a busier period is coming
   *   {kind: 'calm'}                   quiet now and for the whole window
   *   null                             no profile
   */
  function quieterTimeHint(bands, minutes, liveValue, windowMinutes) {
    if (!bands || !bands.length) return null;
    const windowLen = windowMinutes || 180;
    const nowBand = bandAt(bands, minutes);
    const current = liveValue !== null && liveValue !== undefined ? liveValue : nowBand ? nowBand.value : null;
    if (current === null) return null;
    const level = crowdingLevel(current).pips;
    const nowX = serviceMinutes(minutes);
    const ahead = bands.filter((b) => b.x > nowX && b.x <= nowX + windowLen);
    if (level >= 2) {
      for (let i = 0; i < ahead.length; i++) {
        const next = ahead[i + 1];
        const lower = (b) => crowdingLevel(b.value).pips < level;
        if (lower(ahead[i]) && (!next || lower(next))) return { kind: 'quieter', start: ahead[i].start, value: ahead[i].value };
      }
      return { kind: 'stays' };
    }
    const busier = ahead.find((b) => crowdingLevel(b.value).pips >= 2);
    return busier ? { kind: 'busier', start: busier.start, value: busier.value } : { kind: 'calm' };
  }

  /** /Disruptions/Lifts/v2 → the entries for any of `ids` (hub code or station NaPTANs). */
  function liftDisruptionsFor(raw, ids) {
    const wanted = new Set(ids.filter(Boolean).map((id) => String(id).toUpperCase()));
    return (Array.isArray(raw) ? raw : [])
      .filter((d) => d && wanted.has(String(d.stationUniqueId || '').toUpperCase()))
      .map((d) => ({
        station: d.stationUniqueId,
        lifts: Array.isArray(d.disruptedLiftUniqueIds) ? d.disruptedLiftUniqueIds.length : 0,
        message: String(d.message || 'A lift at this station is out of service.'),
      }));
  }

  // ---------------------------------------------------------------------------
  // Network status: all-lines strip and planned closures
  // ---------------------------------------------------------------------------

  /**
   * /Line/Mode/{modes}/Status → [{id, name, mode, colour, cls, description, reasons}],
   * worst status first, then by mode (Underground first) and name.
   */
  function networkStatusList(raw) {
    const lines = new Map();
    for (const l of Array.isArray(raw) ? raw : []) if (l && l.id && !lines.has(l.id)) lines.set(l.id, l);
    const statuses = normalizeStatuses([...lines.values()]);
    const modeIdx = (m) => (RAIL_MODES.includes(m) ? RAIL_MODES.indexOf(m) : RAIL_MODES.length);
    return [...lines.values()]
      .map((l) => {
        const s = statuses.get(l.id);
        return { id: l.id, name: l.name || l.id, mode: l.modeName || null, colour: lineColour(l.id), cls: s.cls, description: s.description, reasons: s.reasons };
      })
      .sort((a, b) => STATUS_RANK[b.cls] - STATUS_RANK[a.cls] || modeIdx(a.mode) - modeIdx(b.mode) || a.name.localeCompare(b.name));
  }

  /** London calendar date as YYYY-MM-DD. */
  function londonDate(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  /** {start, end} as YYYY-MM-DD for /Line/{ids}/Status/{start}/to/{end}: today in London and `days` later. */
  function closureDateRange(date, days) {
    const start = londonDate(date || new Date());
    const [y, m, d] = start.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1, d + (days === undefined ? 14 : days))).toISOString().slice(0, 10);
    return { start, end };
  }

  /** TfL timestamps carry a trailing Z; treat any without a zone as UTC too. */
  function parseTflDate(text) {
    if (!text) return NaN;
    const s = String(text);
    return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
  }

  /**
   * /Line/{ids}/Status/{start}/to/{end} → upcoming or planned entries, soonest first:
   *   [{lineId, lineName, colour, severity, cls, description, reason, from, to, current, planned}]
   * Drops Good Service, periods that have ended, and live incidents that have already started
   * (those are in the line's current status). Ongoing planned works are kept, marked `current`.
   * TfL can repeat an entry, so identical line + reason + period entries are merged.
   */
  function upcomingClosures(raw, now) {
    const t = (now || new Date()).getTime();
    const seen = new Set();
    const out = [];
    for (const line of Array.isArray(raw) ? raw : []) {
      for (const s of (line && line.lineStatuses) || []) {
        const cls = statusClass(s.statusSeverity);
        if (cls === 'good') continue;
        const category = String(pick(s.disruption, 'category') || '');
        const planned = /planned/i.test(category) || /planned/i.test(s.statusSeverityDescription || '');
        for (const p of s.validityPeriods || []) {
          const from = parseTflDate(p && p.fromDate);
          const to = parseTflDate(p && p.toDate);
          if (!Number.isFinite(from)) continue;
          if (Number.isFinite(to) && to <= t) continue;
          const current = from <= t;
          if (current && !planned) continue;
          const lineId = line.id || s.lineId;
          const reason = String(s.reason || pick(s.disruption, 'description') || '').trim();
          const key = [lineId, reason, from, to].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            lineId,
            lineName: line.name || lineId,
            colour: lineColour(lineId),
            severity: s.statusSeverity,
            cls,
            description: s.statusSeverityDescription || 'Disruption',
            reason,
            from: new Date(from).toISOString(),
            to: Number.isFinite(to) ? new Date(to).toISOString() : null,
            current,
            planned,
          });
        }
      }
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.lineName.localeCompare(b.lineName));
  }

  /** "Sat 3 Oct 01:30–04:30" or "Sat 3 Oct 04:30 – Sun 4 Oct 01:29", in London time. */
  function formatPeriod(fromIso, toIso) {
    const fmt = (iso) => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(iso));
      const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
      return { day: `${get('weekday')} ${get('day')} ${get('month')}`, time: `${get('hour')}:${get('minute')}` };
    };
    const a = fmt(fromIso);
    if (!toIso) return `From ${a.day} ${a.time}`;
    const b = fmt(toIso);
    return a.day === b.day ? `${a.day} ${a.time}–${b.time}` : `${a.day} ${a.time} – ${b.day} ${b.time}`;
  }

  // ---------------------------------------------------------------------------
  // Boarding estimate: how many trains you may have to let go before boarding
  // ---------------------------------------------------------------------------

  // TfL train-loading scores run 0–6 in observed data (6 on Bank → Waterloo at 17:45); 6 = full.
  const LOADING_SCALE_MAX = 6;
  // Assumed share of arriving passengers who get off at a through station (TfL doesn't publish this).
  const ALIGHTING_SHARE = 0.3;

  /** trainLoadings rows for one line: [{dir, to, start, value}] (dir is NB/SB/EB/WB as TfL gives it). */
  function loadingRows(raw, line) {
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
    return found
      .filter((t) => !t.line || wanted.includes(slug(t.line)))
      .map((t) => ({
        dir: String(t.lineDirection || t.platformDirection || t.direction || '').toUpperCase(),
        to: String(t.naptanTo || '').toUpperCase(),
        start: parseClock(t.timeSlice),
        value: Number(t.value),
      }))
      .filter((r) => r.start !== null && Number.isFinite(r.value));
  }

  /** The score for the 15-minute slice containing `minutes` (null if TfL has no row for that slice). */
  function loadingAt(rows, minutes) {
    const x = serviceMinutes(minutes);
    const hit = rows.find((r) => {
      const rx = serviceMinutes(r.start);
      return rx <= x && x < rx + 15;
    });
    return hit ? hit.value : null;
  }

  /**
   * From /Line/{id}/Route/Sequence/all, the stations a train calls at just before `stationId`
   * when it is heading on to `nextId`. `origin` is true when the train starts at `stationId`
   * in that direction (e.g. Waterloo & City eastbound at Waterloo), so it arrives empty.
   */
  function previousStations(routeSeq, stationId, nextId) {
    const S = String(stationId).toUpperCase();
    const N = String(nextId).toUpperCase();
    const prev = new Set();
    let matched = false;
    let origin = false;
    for (const r of (routeSeq && routeSeq.orderedLineRoutes) || []) {
      const ids = (r.naptanIds || []).map((x) => String(x).toUpperCase());
      for (let i = 0; i < ids.length - 1; i++) {
        if (ids[i] !== S || ids[i + 1] !== N) continue;
        matched = true;
        if (i === 0) origin = true;
        else prev.add(ids[i - 1]);
      }
    }
    return { matched, origin: matched && prev.size === 0 && origin, prev: [...prev] };
  }

  /** Station names by NaPTAN from a route sequence response (for "towards Bank"). */
  function routeStationNames(routeSeq) {
    const out = new Map();
    const clean = (n, id) => String(n || id).replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '');
    // stopPointSequences carry the station NaPTANs; `stations` uses hub ids (e.g. HUBBAN) at interchanges.
    for (const seq of (routeSeq && routeSeq.stopPointSequences) || []) {
      for (const sp of seq.stopPoint || []) {
        const id = sp && (sp.stationId || sp.id);
        if (id && !out.has(String(id).toUpperCase())) out.set(String(id).toUpperCase(), clean(sp.name, id));
      }
    }
    for (const st of (routeSeq && routeSeq.stations) || []) {
      if (st && st.id && !out.has(String(st.id).toUpperCase())) out.set(String(st.id).toUpperCase(), clean(st.name, st.id));
    }
    return out;
  }

  const BOARDING_BANDS = [
    { key: 'board', label: 'Board the first train', trains: 0 },
    { key: 'tight', label: 'First train, but it will be tight', trains: 0 },
    { key: 'wait1', label: 'Expect to let 1 train go', trains: 1 },
    { key: 'wait2', label: 'Expect to let 2 or more trains go', trains: 2 },
  ];

  /**
   * Estimate for one direction. Scores are TfL train-loading values (0–6).
   *   depart:  typical load leaving this station in this direction (this station's own row)
   *   arrive:  typical load arriving from the previous station (ignored when origin is true)
   *   origin:  the train starts here in this direction, so it arrives empty
   *   liveFactor:    live ÷ typical station busyness now (1 when unknown)
   *   serviceFactor: extra pressure from disruption or long gaps (1 = normal)
   * Returns {ratio, band, trainsToLetGo, roomPct, arrivePct, departPct, saturated} or null.
   */
  function boardingEstimate({ depart, arrive, origin, liveFactor, serviceFactor }) {
    if (depart === null || depart === undefined || !Number.isFinite(depart)) return null;
    const d = Math.min(1, Math.max(0, depart / LOADING_SCALE_MAX));
    const hasArrive = !origin && arrive !== null && arrive !== undefined && Number.isFinite(arrive);
    const a = origin ? 0 : hasArrive ? Math.min(1, Math.max(0, arrive / LOADING_SCALE_MAX)) : d;
    // Boarders: the departing load minus those assumed to stay on. When the load drops here
    // (a busy interchange), still assume at least ALIGHTING_SHARE of the departing load got on here.
    const board = Math.max(d - a * (1 - ALIGHTING_SHARE), d * ALIGHTING_SHARE);
    const stay = d - board;
    const room = Math.max(0.05, 1 - stay);
    const f = Math.min(2.5, Math.max(0.5, liveFactor || 1));
    const sf = Math.max(1, serviceFactor || 1);
    let ratio = (board * f * sf) / room;
    // A score at the top of the scale means trains usually leave full: demand is at least the room.
    const saturated = depart >= LOADING_SCALE_MAX;
    if (saturated) ratio = Math.max(ratio, f * sf);
    let band;
    if (ratio < 0.85) band = BOARDING_BANDS[0];
    else if (ratio <= 1) band = BOARDING_BANDS[1];
    else if (ratio <= 2) band = BOARDING_BANDS[2];
    else band = BOARDING_BANDS[3];
    return {
      ratio,
      band,
      trainsToLetGo: ratio <= 1 ? 0 : Math.ceil(ratio) - 1,
      roomPct: Math.round(room * 100),
      arrivePct: Math.round(a * 100),
      departPct: Math.round(d * 100),
      arriveKnown: origin || hasArrive,
      saturated,
    };
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

      /** Every line in the given modes (default: all rail modes), in one request. */
      async getNetworkStatus(modes) {
        return networkStatusList(await get(`/Line/Mode/${(modes || RAIL_MODES).map(enc).join(',')}/Status`));
      },

      /** Planned closures and other upcoming entries for these lines over the next `days` days. */
      async getUpcomingClosures(lineIds, days) {
        if (!lineIds.length) return [];
        const { start, end } = closureDateRange(new Date(), days);
        return upcomingClosures(await get(`/Line/${lineIds.map(enc).join(',')}/Status/${start}/to/${end}`));
      },

      async getLineStatuses(lineIds) {
        if (!lineIds.length) return new Map();
        return normalizeStatuses(await get(`/Line/${lineIds.map(enc).join(',')}/Status`));
      },

      /** Lift outages across the network (used by tfl.gov.uk; not in the published swagger). */
      async getLiftDisruptions() {
        return get('/Disruptions/Lifts/v2/');
      },

      async getRouteSequence(lineId) {
        return get(`/Line/${enc(lineId)}/Route/Sequence/all`);
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
    summarizePassengerFlows,
    quieterTimeHint,
    liftDisruptionsFor,
    networkStatusList,
    closureDateRange,
    upcomingClosures,
    formatPeriod,
    LOADING_SCALE_MAX,
    ALIGHTING_SHARE,
    DIRECTION_NAMES,
    loadingRows,
    loadingAt,
    previousStations,
    routeStationNames,
    boardingEstimate,
    lineColour,
  };

  root.TflApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
