/*
 * SWR tab, package S1: live departures with train length, a short-train warning and
 * delay/cancellation reasons (items SWR-3, SWR-1, SWR-7).
 *
 * Endpoints (both send Access-Control-Allow-Origin: *), fetched through SwrApi (S0):
 *   GET https://railinfo.southwesternrailway.com/journey/departures/{CRS}   SwrApi.departures(crs)
 *       The board: SWR's live train info, as used by its website. Cached 30 s by SwrApi.
 *   GET https://huxley2.azurewebsites.net/departures/{CRS}/{rows}          SwrApi.huxleyDepartures(crs)
 *       Enrichment: train length, delay/cancel reasons, missing platforms. Huxley2 is an
 *       unofficial, volunteer-run wrapper for National Rail's live data, so it's optional.
 *       Cached 30 s by SwrApi and shared with S3 (one request serves both).
 *
 * Rows are joined on railinfo `Id` = Huxley `serviceID`.
 *
 * Row contract for S2 (calling points): each row has a button.swr-dep-more[data-service-id]
 * and an empty, hidden div.swr-dep-detail[data-service-id]. Opening a row dispatches
 *   document.dispatchEvent(new CustomEvent('swr:service-open', {detail: {serviceId, crs, container}}))
 * and each re-render re-dispatches it for rows that are still open.
 *
 * Classic script (no modules), so index.html also works when opened from disk; also exported
 * for Node so the pure helpers can be unit-tested.
 */
(function (root) {
  'use strict';

  const SWR_OPERATOR_CODES = ['SW', 'IL']; // National Rail codes: South Western Railway, Island Line
  const SWR_OPERATOR_RE = /south\s*western\s*railway|island\s*line/i;
  const SHORT_TRAIN_MAX = 5; // 1–5 coaches counts as short (this dashboard's heuristic)
  const BOARD_LIMIT = 15;
  const STORE_ALL_OPERATORS = 'swr.allOperators';
  const STATUS_ICONS = { good: '✓', info: 'ℹ', warning: '!', serious: '!!', critical: '✕' };

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** "19:21" → 1161 minutes after midnight, or null. */
  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /** Minutes from clock time a to clock time b, taking the shorter way round midnight (23:55 → 00:10 is 15). */
  function minutesBetween(a, b) {
    const x = toMinutes(a);
    const y = toMinutes(b);
    if (x === null || y === null) return null;
    let d = y - x;
    if (d > 720) d -= 1440;
    if (d < -720) d += 1440;
    return d;
  }

  /** 1161 → "19:21" (wraps round midnight). */
  function formatMinutes(mins) {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  /** ISO timestamp → "19:22" in London time, or null. */
  function formatClock(iso) {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    try {
      return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch (e) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }

  /** Minutes after midnight, London time, for a Date. */
  function londonMinutes(date) {
    const t = formatClock(date || new Date());
    return t === null ? 0 : toMinutes(t);
  }

  /** Plain text from a field that should be text but might carry tags or entities. */
  function cleanText(s) {
    if (s === null || s === undefined) return null;
    const text = String(s)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
    return text || null;
  }

  /**
   * Classify an expected-time field (railinfo EstimatedTime or Huxley etd):
   * "On time", "19:45", "Cancelled", "Delayed", or anything else National Rail sends (e.g. "No report").
   * Every status has a text label as well as a colour class.
   */
  function classifyEstimate(scheduled, estimated, cancelled) {
    const raw = cleanText(estimated) || '';
    const lower = raw.toLowerCase();
    if (cancelled || lower === 'cancelled') {
      return { status: 'cancelled', cls: 'critical', label: 'Cancelled', expected: null, lateMins: null };
    }
    if (lower === 'on time') {
      return { status: 'on-time', cls: 'good', label: 'On time', expected: scheduled || null, lateMins: 0 };
    }
    if (lower === 'delayed') {
      return { status: 'delayed', cls: 'serious', label: 'Delayed', expected: null, lateMins: null };
    }
    if (toMinutes(raw) !== null) {
      const late = minutesBetween(scheduled, raw);
      if (late === null || late <= 0) {
        return { status: 'on-time', cls: 'good', label: late < 0 ? `On time (exp ${raw})` : 'On time', expected: raw, lateMins: late === null ? null : 0 };
      }
      return {
        status: 'late',
        cls: late >= 5 ? 'serious' : 'warning',
        label: `Exp ${raw}, ${late} min late`,
        expected: raw,
        lateMins: late,
      };
    }
    return { status: 'unknown', cls: 'info', label: raw || 'No estimate', expected: null, lateMins: null };
  }

  /** Coaches from Huxley's `length`: a positive number, or null when unknown (0, missing, bad). */
  function coachCount(length) {
    const n = Number(length);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /** This dashboard's heuristic: a train of 1–5 coaches may be busier. */
  function isShortTrain(coaches) {
    return coaches !== null && coaches !== undefined && coaches >= 1 && coaches <= SHORT_TRAIN_MAX;
  }

  function isSwrOperator(name, code) {
    if (code && SWR_OPERATOR_CODES.includes(String(code).toUpperCase())) return true;
    return SWR_OPERATOR_RE.test(String(name || ''));
  }

  /** Huxley's origin/destination are arrays (a train can split); join their names. */
  function huxleyPlace(list) {
    const places = Array.isArray(list) ? list.filter((p) => p && p.locationName) : [];
    if (!places.length) return { name: null, crs: null, via: null };
    return {
      name: places.map((p) => p.locationName).join(' & '),
      crs: places[0].crs || null,
      via: cleanText(places.map((p) => p.via).filter(Boolean).join(', ')),
    };
  }

  function platformOf(value) {
    const p = cleanText(value);
    return p && p.toUpperCase() !== 'BUS' ? p : null;
  }

  /** One normalised row from a railinfo item and its Huxley match (or null). */
  function buildRow({ railinfo, huxley, isBus, huxleyOk }) {
    const r = railinfo || null;
    const h = huxley || null;
    const serviceId = String((r && r.Id) || (h && h.serviceID) || '');
    const operator = cleanText(r ? r.Operator : h && h.operator) || '';
    const operatorCode = h && h.operatorCode ? String(h.operatorCode) : null;
    const scheduled = cleanText(r ? r.ScheduledTime : h && h.std) || '';
    const cancelled = Boolean((r && /^cancelled$/i.test(String(r.EstimatedTime || '').trim())) || (h && h.isCancelled));
    const estimate = classifyEstimate(scheduled, r ? r.EstimatedTime : h && h.etd, cancelled);

    const hDest = h ? huxleyPlace(h.destination) : { name: null, crs: null, via: null };
    const hOrig = h ? huxleyPlace(h.origin) : { name: null, crs: null, via: null };
    const destination = r && r.Destination
      ? { name: cleanText(r.Destination.Name) || hDest.name || '', crs: r.Destination.CrsCode || hDest.crs || null }
      : { name: hDest.name || '', crs: hDest.crs };
    const origin = r && r.Origin
      ? { name: cleanText(r.Origin.Name) || hOrig.name || '', crs: r.Origin.CrsCode || hOrig.crs || null }
      : { name: hOrig.name || '', crs: hOrig.crs };

    let platform = r ? platformOf(r.Platform) : null;
    let platformSource = platform ? 'railinfo' : null;
    if (!platform && h && platformOf(h.platform)) {
      platform = platformOf(h.platform);
      platformSource = 'huxley';
    }

    const coaches = isBus || !h ? null : coachCount(h.length);
    const cancelReason = h ? cleanText(h.cancelReason) : null;
    const delayReason = h ? cleanText(h.delayReason) : null;
    const reason = estimate.status === 'cancelled' ? cancelReason || delayReason : delayReason;

    return {
      serviceId,
      isBus: Boolean(isBus),
      operator,
      operatorCode,
      isSwr: isSwrOperator(operator, operatorCode),
      scheduled,
      expected: estimate.expected,
      estimateText: cleanText(r ? r.EstimatedTime : h && h.etd),
      status: estimate.status,
      statusCls: estimate.cls,
      statusLabel: estimate.label,
      lateMins: estimate.lateMins,
      platform,
      platformSource,
      origin,
      destination,
      via: hDest.via,
      matched: Boolean(h),
      // 'known', 'unknown' (National Rail lists 0 or the train isn't in Huxley's rows) or 'unavailable' (Huxley failed).
      lengthState: isBus ? 'n/a' : coaches !== null ? 'known' : huxleyOk ? 'unknown' : 'unavailable',
      coaches,
      short: !isBus && estimate.status !== 'cancelled' && isShortTrain(coaches),
      reason: reason || null,
      reasonKind: reason ? (estimate.status === 'cancelled' && cancelReason ? 'cancel' : 'delay') : null,
    };
  }

  /**
   * Join the railinfo board with Huxley and flag each row.
   * Either input may be null (that source failed). railinfo is the board; Huxley adds length,
   * reasons and missing platforms. If railinfo failed, the board is built from Huxley alone.
   * By default only SWR services are kept; `allOperators: true` keeps every operator.
   */
  function normalizeDepartures(railinfo, huxley, opts) {
    const { allOperators = false, limit = Infinity } = opts || {};
    const railOk = Boolean(railinfo && typeof railinfo === 'object' && Array.isArray(railinfo.Items));
    const huxleyOk = Boolean(huxley && typeof huxley === 'object' && !Array.isArray(huxley));
    const hTrains = huxleyOk && Array.isArray(huxley.trainServices) ? huxley.trainServices.filter(Boolean) : [];
    const hBuses = huxleyOk && Array.isArray(huxley.busServices) ? huxley.busServices.filter(Boolean) : [];
    const byId = new Map();
    for (const s of hTrains.concat(hBuses)) if (s.serviceID) byId.set(String(s.serviceID), s);

    let trains = [];
    let buses = [];
    let source = 'none';
    if (railOk) {
      source = 'railinfo';
      trains = railinfo.Items.filter(Boolean).map((i) => buildRow({ railinfo: i, huxley: byId.get(String(i.Id)), huxleyOk }));
      buses = (Array.isArray(railinfo.BusItems) ? railinfo.BusItems : []).filter(Boolean)
        .map((i) => buildRow({ railinfo: i, huxley: byId.get(String(i.Id)), isBus: true, huxleyOk }));
    } else if (huxleyOk) {
      source = 'huxley';
      trains = hTrains.map((s) => buildRow({ huxley: s, huxleyOk }));
      buses = hBuses.map((s) => buildRow({ huxley: s, isBus: true, huxleyOk }));
    }

    const others = trains.filter((r) => !r.isSwr);
    const otherOperators = [...new Set(others.map((r) => r.operator).filter(Boolean))];
    const keep = (r) => allOperators || r.isSwr;
    const rows = trains.filter(keep);
    const keptBuses = buses.filter(keep);

    const station = railOk && railinfo.Station
      ? { name: cleanText(railinfo.Station.Name) || '', crs: railinfo.Station.CrsCode || null }
      : huxleyOk ? { name: cleanText(huxley.locationName) || '', crs: huxley.crs || null } : { name: '', crs: null };

    return {
      source,
      railinfoOk: railOk,
      huxleyOk,
      generatedAt: (railOk ? railinfo.GeneratedAt : huxleyOk ? huxley.generatedAt : null) || null,
      station,
      allOperators: Boolean(allOperators),
      total: rows.length,
      rows: rows.slice(0, limit),
      buses: keptBuses.slice(0, limit),
      hiddenCount: allOperators ? 0 : others.length,
      otherOperators,
    };
  }

  /** Counts for the summary line over the rows shown. */
  function boardSummary(rows) {
    const list = rows || [];
    return {
      cancelled: list.filter((r) => r.status === 'cancelled').length,
      late: list.filter((r) => r.status === 'late' || r.status === 'delayed').length,
      short: list.filter((r) => r.short).length,
    };
  }

  function coachesText(row) {
    if (row.lengthState === 'known') return `${row.coaches} coach${row.coaches === 1 ? '' : 'es'}`;
    if (row.lengthState === 'unknown') return 'Length unknown';
    return '';
  }

  function shortTrainText(coaches) {
    return `Short train (${coaches} coach${coaches === 1 ? '' : 'es'}), may be busier`;
  }

  /** "Southern and London Overground", "A, B and C". */
  function listNames(names) {
    const n = (names || []).filter(Boolean);
    if (n.length <= 1) return n.join('');
    return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }

  function detailId(serviceId) {
    return 'swr-dep-detail-' + String(serviceId).replace(/[^A-Za-z0-9_-]/g, '');
  }

  // ---------------------------------------------------------------------------
  // Rendering (returns HTML strings; every API string goes through esc())
  // ---------------------------------------------------------------------------

  function renderRow(row, crs) {
    const id = esc(row.serviceId);
    const statusHtml = `<span class="status status-${row.statusCls} swr-dep-status"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[row.statusCls]}</span>${esc(row.statusLabel)}</span>`;
    const meta = [];
    if (row.isBus) meta.push('<span class="swr-dep-bus">Replacement bus</span>');
    else if (row.platform) meta.push(`<span class="swr-dep-plat">Platform <strong>${esc(row.platform)}</strong></span>`);
    else meta.push('<span class="swr-dep-plat muted">Platform not yet shown</span>');
    const coaches = coachesText(row);
    if (coaches) meta.push(`<span class="swr-dep-coaches${row.lengthState === 'unknown' ? ' muted' : ''}">${esc(coaches)}</span>`);
    if (!row.isSwr && row.operator) meta.push(`<span class="swr-dep-op">${esc(row.operator)}</span>`);

    const warn = row.short
      ? `<p class="swr-dep-short"><span class="swr-dep-short-icon" aria-hidden="true">!</span><span>${esc(shortTrainText(row.coaches))} <span class="swr-dep-heuristic">dashboard heuristic</span></span></p>`
      : '';
    const reason = row.reason
      ? `<p class="swr-dep-reason"><span class="visually-hidden">${row.reasonKind === 'cancel' ? 'Cancellation' : 'Delay'} reason: </span>${esc(row.reason)}</p>`
      : '';
    const what = `${row.scheduled} to ${row.destination.name}`;
    return `<li class="swr-dep swr-dep-${esc(row.status)}${row.isBus ? ' swr-dep-is-bus' : ''}" data-service-id="${id}">
      <div class="swr-dep-row">
        <span class="swr-dep-time">${esc(row.scheduled)}</span>
        <span class="swr-dep-dest"><strong>${esc(row.destination.name)}</strong>${row.via ? ` <span class="swr-dep-via">${esc(row.via)}</span>` : ''}</span>
        ${statusHtml}
        <span class="swr-dep-meta">${meta.join('<span class="swr-dep-sep" aria-hidden="true"> · </span>')}</span>
        <button type="button" class="swr-dep-more link" data-service-id="${id}" data-crs="${esc(crs)}" aria-expanded="false" aria-controls="${esc(detailId(row.serviceId))}">Stops<span class="visually-hidden"> for the ${esc(what)}</span></button>
      </div>
      ${warn}${reason}
      <div class="swr-dep-detail" id="${esc(detailId(row.serviceId))}" data-service-id="${id}" hidden></div>
    </li>`;
  }

  /**
   * Inner HTML of <section id="swr-departures">.
   * opts: {stationName, crs, limit, note} — `note` is an extra message such as a failed refresh.
   */
  function renderBoard(model, opts) {
    const { stationName = model.station.name, crs = model.station.crs, limit = BOARD_LIMIT, note = '' } = opts || {};
    const rows = model.rows.slice(0, limit);
    const who = model.allOperators ? 'all operators' : 'SWR';
    const updated = formatClock(model.generatedAt);
    const sum = boardSummary(rows);
    const bits = [];
    if (rows.length) bits.push(`Next ${rows.length}${model.total > rows.length ? ` of ${model.total}` : ''} ${model.allOperators ? '' : 'SWR '}departures`);
    if (sum.cancelled) bits.push(`${sum.cancelled} cancelled`);
    if (sum.late) bits.push(`${sum.late} late`);
    if (sum.short) bits.push(`${sum.short} short train${sum.short === 1 ? '' : 's'}`);
    if (updated) bits.push(`as of ${updated}`);

    const notes = [];
    if (note) notes.push(note);
    if (model.source === 'huxley') notes.push('SWR’s live board didn’t load, so this list comes from National Rail data via Huxley2.');
    if (!model.huxleyOk && model.source !== 'none') notes.push('Train length unavailable: Huxley2, the service this dashboard uses for train length and delay reasons, didn’t answer.');

    const hasOthers = model.otherOperators.length > 0 || model.allOperators;
    const toggle = hasOthers
      ? `<div class="swr-dep-filter">
          <label class="toggle"><input type="checkbox" class="swr-dep-all" ${model.allOperators ? 'checked' : ''}> Show all operators</label>
          ${!model.allOperators && model.hiddenCount ? `<span class="muted small">${model.hiddenCount} train${model.hiddenCount === 1 ? '' : 's'} by ${esc(listNames(model.otherOperators))} hidden</span>` : ''}
        </div>`
      : '';

    let body;
    if (model.source === 'none') {
      body = '<p class="swr-dep-empty message-error">Couldn’t load departures from SWR or National Rail. The next refresh will try again.</p>';
    } else if (!rows.length && !model.buses.length) {
      body = `<p class="swr-dep-empty">No ${who === 'SWR' ? 'SWR ' : ''}departures listed right now.</p>`;
    } else {
      body = rows.length
        ? `<ol class="swr-dep-list card" aria-label="Departures">${rows.map((r) => renderRow(r, crs)).join('')}</ol>`
        : `<p class="swr-dep-empty">No ${who === 'SWR' ? 'SWR ' : ''}trains listed right now.</p>`;
      if (model.buses.length) {
        body += `<h3 class="swr-dep-group">Replacement buses</h3>
          <ol class="swr-dep-list card" aria-label="Replacement buses">${model.buses.slice(0, limit).map((r) => renderRow(r, crs)).join('')}</ol>`;
      }
    }

    return `<h2 id="swr-departures-title" class="section-title">Departures${stationName ? ` from ${esc(stationName)}` : ''}</h2>
      <p class="section-sub muted" role="status">${esc(bits.join(' · '))}</p>
      ${notes.map((n) => `<p class="swr-dep-note">${esc(n)}</p>`).join('')}
      ${toggle}
      ${body}
      ${renderAbout()}`;
  }

  function renderAbout() {
    return `<details class="swr-about swr-dep-about">
      <summary>About this data</summary>
      <ul>
        <li><strong>Departures, platforms and expected times</strong> come from SWR’s live train info (<code>railinfo.southwesternrailway.com/journey/departures/{CRS}</code>), the service behind the live departures on SWR’s website. It isn’t a documented public API. “Delayed” means a late train with no estimate yet.</li>
        <li><strong>Train length and delay or cancellation reasons</strong> come from <a href="https://huxley2.azurewebsites.net/" rel="noopener">Huxley2</a>, an <strong>unofficial</strong>, volunteer-run JSON wrapper for National Rail’s live train data. Rows are matched by service ID. It also fills in a platform that SWR hasn’t shown yet. If Huxley2 is down, the board still shows, without lengths or reasons. “Length unknown” means National Rail didn’t give one, or the train is beyond the 40 departures Huxley2 is asked for.</li>
        <li><strong>Short-train warning</strong> is this dashboard’s own heuristic, not an SWR forecast: a train of ${SHORT_TRAIN_MAX} coaches or fewer is flagged as possibly busier. SWR runs trains of 3 to 12 coaches, and a short train on a busy route usually means less room, but no live per-coach loading is published for SWR trains, so it can’t say how full a train really is.</li>
        <li>At stations shared with other operators, only SWR trains are shown unless you tick “Show all operators”. The list refreshes every 60 seconds.</li>
      </ul>
    </details>`;
  }

  // ---------------------------------------------------------------------------
  // Demo fixtures (routed through SwrApi.demoRoutes in ?demo mode).
  // Shapes follow the real responses captured on 2026-09-27; times are shifted to now.
  // ---------------------------------------------------------------------------

  const DEMO_STATIONS = {
    WAT: { name: 'London Waterloo', tiploc: 'WATRLMN_' },
    CLJ: { name: 'Clapham Junction', tiploc: 'CLPHMJM_' },
    SUR: { name: 'Surbiton', tiploc: 'SURBITN_' },
  };
  const DEMO_NRCC = [
    { value: 'Trains between Clapham Junction and London Victoria / Imperial Wharf / Denmark Hill may be cancelled, severely delayed by up to&nbsp;60 minutes, diverted&nbsp;or revised. More details can be found in the Disruptions area of the <a href="http://https://www.nationalrail.co.uk/service-disruptions/clapham-junction-20260927/">National Rail website.</a>' },
    { value: 'Trains running between Havant and Guildford may be cancelled, delayed by up to 50 minutes or revised. Latest information can be found in the <a href="https://www.nationalrail.co.uk/service-disruptions/godalming-20260927/">Disruptions area of the National Rail website.</a>' },
  ];
  const SW = 'South Western Railway';
  // [minutes from now, destination, CRS, platform (railinfo), estimate, coaches, operator, reason, huxley platform]
  const DEMO_BOARDS = {
    WAT: [
      [1, 'Exeter St Davids', 'EXD', '7', '+2', 10, SW, 'This service has been delayed by a passenger being taken ill on a train'],
      [3, 'Chessington South', 'CSS', '5', 'On time', 8, SW],
      [4, 'Reading', 'RDG', '15', 'On time', 10, SW],
      [7, 'Hampton Court', 'HMC', null, 'On time', 10, SW, null, '4'],
      [9, 'Hounslow', 'HOU', '23', 'On time', 0, SW],
      [12, 'Portsmouth Harbour', 'PMH', '8', '+15', 12, SW, 'This service has been delayed by a passenger being taken ill on a train'],
      [14, 'Guildford', 'GLD', '2', 'On time', 10, SW],
      [17, 'Winchester', 'WIN', '9', 'Delayed', 12, SW, 'This service has been delayed by a speed restriction over a defective section of track'],
      [19, 'Basingstoke', 'BSK', '11', 'On time', 8, SW],
      [22, 'Salisbury', 'SAL', '6', 'On time', 3, SW],
      [24, 'Shepperton', 'SHP', '4', 'Cancelled', 10, SW, 'This service has been cancelled because of a shortage of train crew'],
      [27, 'Hounslow', 'HOU', '22', 'On time', 10, SW],
      [29, 'Weymouth', 'WEY', '10', 'On time', 10, SW],
      [32, 'Dorking', 'DKG', '1', 'On time', 4, SW],
      [35, 'Woking', 'WOK', '12', 'On time', 8, SW],
      [38, 'Portsmouth Harbour', 'PMH', '11', 'On time', 8, SW],
      [41, 'Guildford', 'GLD', '6', 'On time', null, SW], // not in Huxley's rows
    ],
    CLJ: [
      [1, 'Ore', 'ORE', '13', '+20', 8, 'Southern', 'This service has been delayed by a fire next to the track'],
      [2, 'London Waterloo', 'WAT', '7', '+3', 8, SW, 'This service has been delayed by a passenger being taken ill on a train'],
      [4, 'Portsmouth Harbour', 'PMH', '9', 'Delayed', 12, SW, 'This service has been delayed by a passenger being taken ill on a train'],
      [5, 'London Victoria', 'VIC', '12', 'Cancelled', 12, 'Southern', 'This service has been cancelled because of a fire next to the track'],
      [6, 'London Waterloo', 'WAT', '10', '+6', 8, SW, 'This service has been delayed by a speed restriction over a defective section of track'],
      [7, 'Guildford', 'GLD', '11', 'On time', 10, SW],
      [9, 'Dalston Junction', 'DLJ', '2', 'Cancelled', 0, 'London Overground', 'This service has been cancelled because of a fire on property near the railway'],
      [10, 'Winchester', 'WIN', '9', 'On time', 12, SW],
      [11, 'London Waterloo', 'WAT', '7', '+8', 6, SW],
      [12, 'Stratford (London)', 'SRA', '17', 'On time', 0, 'London Overground'],
      [14, 'Basingstoke', 'BSK', '9', 'On time', 8, SW],
      [15, 'Hounslow', 'HOU', '5', 'Cancelled', 8, SW, 'This service has been cancelled because of a shortage of train crew'],
      [17, 'London Waterloo', 'WAT', '10', 'On time', 0, SW],
      [19, 'Epsom Downs', 'EPD', '15', 'Delayed', 8, 'Southern', 'This service has been delayed by a fire next to the track'],
      [21, 'Salisbury', 'SAL', '8', 'On time', 3, SW],
      [23, 'London Waterloo', 'WAT', '7', 'On time', 10, SW],
      [26, 'Shepperton', 'SHP', '5', 'On time', 10, SW],
      [28, 'London Waterloo', 'WAT', '10', 'On time', null, SW],
    ],
    SUR: [
      [2, 'London Waterloo', 'WAT', '3', 'On time', 10, SW],
      [5, 'Hampton Court', 'HMC', '2', 'On time', 4, SW],
      [8, 'Guildford', 'GLD', '1', '+4', 8, SW, 'This service has been delayed by a speed restriction over a defective section of track'],
      [11, 'London Waterloo', 'WAT', '4', 'On time', 12, SW],
      [14, 'Woking', 'WOK', '1', 'Cancelled', 10, SW, 'This service has been cancelled because of a shortage of train crew'],
      [17, 'London Waterloo', 'WAT', '3', 'On time', 10, SW],
      [20, 'Shepperton', 'SHP', '2', 'On time', 0, SW],
      [26, 'London Waterloo', 'WAT', '4', 'On time', 8, SW],
    ],
  };
  const DEMO_BUSES = { SUR: [[12, 'Berrylands', 'BRS'], [42, 'Berrylands', 'BRS']] };
  // Generic board for any other station.
  const DEMO_GENERIC = [
    [3, 'London Waterloo', 'WAT', '1', 'On time', 10, SW],
    [8, 'Guildford', 'GLD', '2', '+7', 8, SW, 'This service has been delayed by signalling problems'],
    [13, 'London Waterloo', 'WAT', '1', 'On time', 4, SW],
    [19, 'Basingstoke', 'BSK', '2', 'Cancelled', 10, SW, 'This service has been cancelled because of a shortage of train crew'],
    [24, 'London Waterloo', 'WAT', '1', 'On time', 0, SW],
    [31, 'Portsmouth Harbour', 'PMH', '2', 'On time', 12, SW],
  ];
  const OPERATOR_CODES = { [SW]: 'SW', Southern: 'SN', 'London Overground': 'LO' };

  /** Demo railinfo and Huxley responses for one station, shaped like the real ones. */
  function demoBoards(crs, now) {
    const code = String(crs || '').toUpperCase();
    const known = DEMO_STATIONS[code];
    let name = known ? known.name : code;
    if (!known && root.SwrApi && typeof root.SwrApi.stationByCrs === 'function') {
      const s = root.SwrApi.stationByCrs(code);
      if (s && s.name) name = s.name;
    }
    const tiploc = known ? known.tiploc : (code + '_____').slice(0, 7) + '_';
    const base = londonMinutes(now || new Date());
    const generatedAt = (now || new Date()).toISOString();
    const station = { Name: name, CrsCode: code };
    const items = [];
    const services = [];
    const board = DEMO_BOARDS[code] || DEMO_GENERIC;
    board.forEach(([offset, dest, destCrs, plat, est, coaches, op, reason, hxPlat], i) => {
      const id = `${9138400 + i * 37}${tiploc}`;
      const std = formatMinutes(base + offset);
      let estimate = est;
      if (/^\+\d+$/.test(est)) estimate = formatMinutes(base + offset + Number(est.slice(1)));
      const cancelled = est === 'Cancelled';
      items.push({ Id: id, Operator: op, Platform: plat, ScheduledTime: std, EstimatedTime: estimate, RouteDirection: 'Departure', Origin: { Name: name, CrsCode: code }, Destination: { Name: dest, CrsCode: destCrs } });
      if (coaches === null) return; // beyond Huxley's rows: no match
      services.push({
        formation: null,
        origin: [{ locationName: name, crs: code, via: null, futureChangeTo: null, assocIsCancelled: false }],
        destination: [{ locationName: dest, crs: destCrs, via: null, futureChangeTo: null, assocIsCancelled: false }],
        currentOrigins: null, currentDestinations: null, rsid: null,
        sta: null, eta: null, std, etd: estimate,
        platform: hxPlat || plat, operator: op, operatorCode: OPERATOR_CODES[op] || 'XX',
        isCircularRoute: false, isCancelled: cancelled, filterLocationCancelled: false, serviceType: 0,
        length: coaches, detachFront: false, isReverseFormation: false,
        cancelReason: cancelled ? reason || null : null,
        delayReason: cancelled ? null : reason || null,
        serviceID: id, adhocAlerts: null,
      });
    });
    const busItems = [];
    const busServices = [];
    (DEMO_BUSES[code] || []).forEach(([offset, dest, destCrs], i) => {
      const id = `${9143270 + i * 2}${tiploc}`;
      const std = formatMinutes(base + offset);
      busItems.push({ Id: id, Operator: SW, Platform: 'BUS', ScheduledTime: std, EstimatedTime: 'On time', RouteDirection: 'Departure', Origin: { Name: name, CrsCode: code }, Destination: { Name: dest, CrsCode: destCrs } });
      busServices.push({
        formation: null,
        origin: [{ locationName: name, crs: code, via: null, futureChangeTo: null, assocIsCancelled: false }],
        destination: [{ locationName: dest, crs: destCrs, via: null, futureChangeTo: null, assocIsCancelled: false }],
        std, etd: 'On time', platform: 'BUS', operator: SW, operatorCode: 'SW', isCancelled: false, serviceType: 1,
        length: 0, cancelReason: null, delayReason: null, serviceID: id,
      });
    });
    return {
      railinfo: { Station: station, GeneratedAt: generatedAt, Items: items, BusItems: busItems },
      huxley: {
        trainServices: services, busServices: busServices.length ? busServices : null, ferryServices: null,
        generatedAt, locationName: name, crs: code, filterLocationName: null, filtercrs: null, filterType: 0,
        nrccMessages: code === 'WAT' || code === 'CLJ' ? DEMO_NRCC : null,
        platformAvailable: true, areServicesAvailable: true,
      },
    };
  }

  /** SwrApi.demoRoutes entry: (url, options) → body | null. */
  function demoRoute(url) {
    const u = String(url || '');
    let m = /railinfo\.southwesternrailway\.com\/journey\/departures\/([A-Za-z]{3})(?:[/?#]|$)/.exec(u);
    if (m) return demoBoards(m[1]).railinfo;
    m = /huxley2\.azurewebsites\.net\/departures\/([A-Za-z]{3})(?:\/(\d+))?(?:[/?#]|$)/.exec(u);
    if (m) {
      const body = demoBoards(m[1]).huxley;
      if (m[2]) body.trainServices = body.trainServices.slice(0, Number(m[2]));
      return body;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Page module (registered with SwrApp from S0)
  // ---------------------------------------------------------------------------

  const store = {
    get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? root.localStorage.removeItem(k) : root.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  const state = {
    station: null,
    token: undefined,
    seq: 0,
    raw: null, // {railinfo, huxley} from the last load with at least one source
    note: '',
    open: new Set(), // service ids whose detail is open
    wired: false,
  };

  function section() {
    return root.document ? root.document.getElementById('swr-departures') : null;
  }

  function dispatchOpen(serviceId, crs, container) {
    const doc = root.document;
    if (!doc || typeof root.CustomEvent !== 'function') return;
    doc.dispatchEvent(new root.CustomEvent('swr:service-open', { detail: { serviceId, crs, container } }));
  }

  function findIn(el, selector, serviceId) {
    for (const node of el.querySelectorAll(selector)) if (node.getAttribute('data-service-id') === serviceId) return node;
    return null;
  }

  function render() {
    const el = section();
    if (!el || !state.station || !state.raw) return;
    const crs = state.station.crs;
    const allOperators = store.get(STORE_ALL_OPERATORS) === '1';
    const model = normalizeDepartures(state.raw.railinfo, state.raw.huxley, { allOperators });

    // Keep open detail containers (and whatever S2 put in them) across the re-render.
    const kept = new Map();
    for (const id of state.open) {
      const node = findIn(el, '.swr-dep-detail', id);
      if (node) kept.set(id, node);
    }

    el.innerHTML = renderBoard(model, { stationName: state.station.name || model.station.name, crs, note: state.note });
    if (!el.hasAttribute('aria-labelledby')) el.setAttribute('aria-labelledby', 'swr-departures-title');
    el.hidden = false;

    for (const id of [...state.open]) {
      const fresh = findIn(el, '.swr-dep-detail', id);
      const button = findIn(el, '.swr-dep-more', id);
      if (!fresh || !button) { state.open.delete(id); continue; }
      const container = kept.get(id) || fresh;
      if (container !== fresh) fresh.replaceWith(container);
      container.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      dispatchOpen(id, crs, container);
    }
  }

  function renderLoading(station) {
    const el = section();
    if (!el) return;
    el.innerHTML = `<h2 id="swr-departures-title" class="section-title">Departures from ${esc(station.name || station.crs)}</h2>
      <p class="section-sub muted" role="status">Loading departures…</p>`;
    el.hidden = false;
  }

  function wire() {
    const el = section();
    if (!el || state.wired) return;
    state.wired = true;
    el.addEventListener('click', (e) => {
      const button = e.target.closest ? e.target.closest('button.swr-dep-more') : null;
      if (!button || !el.contains(button)) return;
      const id = button.getAttribute('data-service-id');
      const detail = findIn(el, '.swr-dep-detail', id);
      if (!detail) return;
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      detail.hidden = !open;
      if (open) {
        state.open.add(id);
        dispatchOpen(id, button.getAttribute('data-crs') || (state.station && state.station.crs), detail);
      } else {
        state.open.delete(id);
      }
    });
    el.addEventListener('change', (e) => {
      if (!e.target.classList || !e.target.classList.contains('swr-dep-all')) return;
      store.set(STORE_ALL_OPERATORS, e.target.checked ? '1' : null);
      render();
      const box = el.querySelector('.swr-dep-all');
      if (box) box.focus();
    });
  }

  async function load(station, ctx) {
    const token = ctx && ctx.token;
    const seq = ++state.seq;
    const api = ctx && ctx.api;
    const call = (name) => (api && typeof api[name] === 'function'
      ? Promise.resolve().then(() => api[name](station.crs))
      : Promise.reject(new Error(`SwrApi.${name} is missing`)));
    const [rail, hux] = await Promise.allSettled([call('departures'), call('huxleyDepartures')]);
    // Drop late responses: the station changed, or a newer load finished first.
    const stale = ctx && typeof ctx.isStale === 'function' ? ctx.isStale() : ctx && ctx.token !== token;
    if (stale || token !== state.token || seq < state.seq) return;
    const railinfo = rail.status === 'fulfilled' ? rail.value : null;
    const huxley = hux.status === 'fulfilled' ? hux.value : null;
    const railOk = Boolean(railinfo && Array.isArray(railinfo.Items));
    if (!railOk && !huxley && state.raw) {
      const at = formatClock(state.raw.railinfo ? state.raw.railinfo.GeneratedAt : state.raw.huxley && state.raw.huxley.generatedAt);
      state.note = `Couldn’t refresh departures${at ? `; showing the list from ${at}` : ''}.`;
    } else {
      state.raw = { railinfo: railOk ? railinfo : null, huxley };
      state.note = '';
    }
    if (!state.raw) state.raw = { railinfo: null, huxley: null };
    render();
  }

  const module_ = {
    id: 'departures',
    onStation(station, ctx) {
      if (!station || !station.crs) return;
      wire();
      const changed = !state.station || state.station.crs !== station.crs;
      state.station = station;
      state.token = ctx && ctx.token;
      if (changed) {
        state.open.clear();
        state.raw = null;
        state.note = '';
        renderLoading(station);
      }
      return load(station, ctx);
    },
    refresh(station, ctx) {
      if (!station || !station.crs) return;
      if (!state.station || state.station.crs !== station.crs) return module_.onStation(station, ctx);
      state.token = ctx && ctx.token;
      return load(station, ctx);
    },
  };

  const api = {
    SWR_OPERATOR_CODES,
    SHORT_TRAIN_MAX,
    BOARD_LIMIT,
    toMinutes,
    minutesBetween,
    formatMinutes,
    formatClock,
    cleanText,
    classifyEstimate,
    coachCount,
    isShortTrain,
    isSwrOperator,
    huxleyPlace,
    normalizeDepartures,
    boardSummary,
    coachesText,
    shortTrainText,
    listNames,
    renderBoard,
    demoBoards,
    demoRoute,
    module: module_,
  };

  root.SwrDepartures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.SwrApi && Array.isArray(window.SwrApi.demoRoutes)) {
    window.SwrApi.demoRoutes.push(demoRoute);
  }
  if (typeof window !== 'undefined' && window.SwrApp) window.SwrApp.register(module_);
})(typeof window !== 'undefined' ? window : globalThis);
