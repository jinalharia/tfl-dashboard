/*
 * SWR package S2: "where is my train", the calling points of one departure (item SWR-8).
 *
 * S1 renders each departure with an empty `div.swr-dep-detail[data-service-id]` and, when a row
 * is opened (and again after each refresh for rows still open), dispatches
 *   document.dispatchEvent(new CustomEvent('swr:service-open', {detail: {serviceId, crs, container}}))
 * This file listens for that event and fills `container` with a vertical list of stops.
 *
 * Endpoints (through window.SwrApi, which routes them to SwrApi.demoRoutes in ?demo):
 *   POST https://railinfo.southwesternrailway.com/journey/services  {"ServiceId": id}   SwrApi.service(id)
 *   GET  https://huxley2.azurewebsites.net/service/{id}     (fallback) SwrApi.huxleyService(id)
 *
 * Classic script (no modules) so index.html also works when opened from disk; the pure helpers
 * are also exported for Node so they can be unit-tested.
 */
(function (root) {
  'use strict';

  const CACHE_TTL_MS = 30 * 1000;
  // Remember the last response per service, so a re-rendered (empty) container is filled at once.
  const MAX_REMEMBERED = 50;
  // Passed stops before this many are folded behind "Show N earlier stops".
  const KEEP_PASSED = 2;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Time helpers ----------

  const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

  /** "19:21" -> minutes after midnight, or null for anything that isn't a clock time. */
  function toMinutes(s) {
    const m = TIME_RE.exec(String(s ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h < 24 && min < 60 ? h * 60 + min : null;
  }

  /** Normalise a clock time to "HH:MM", or null. */
  function toClock(s) {
    const mins = toMinutes(s);
    return mins === null ? null : formatMinutes(mins);
  }

  function formatMinutes(mins) {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /** later - earlier in minutes, across midnight (result in -720..719). */
  function diffMinutes(later, earlier) {
    const a = toMinutes(later);
    const b = toMinutes(earlier);
    if (a === null || b === null) return null;
    let d = (a - b) % 1440;
    if (d >= 720) d -= 1440;
    if (d < -720) d += 1440;
    return d;
  }

  const isOnTime = (s) => /^on time$/i.test(String(s ?? '').trim());
  const isCancelledText = (s) => /cancel/i.test(String(s ?? ''));
  const isDelayedText = (s) => /^delayed$/i.test(String(s ?? '').trim());
  const isNoReport = (s) => /no report/i.test(String(s ?? ''));

  // ---------- Normalisation (shared stop shape) ----------

  /**
   * One stop in the shared shape. Inputs are the raw strings both sources use:
   *   scheduled "19:21" | null; estimated "On time" | "19:45" | "Delayed" | "Cancelled" | null;
   *   actual "On time" | "19:45" | "No report" | null.
   */
  function makeStop(raw) {
    const scheduled = toClock(raw.scheduled);
    const estText = raw.estimated == null ? null : String(raw.estimated).trim();
    const actText = raw.actual == null ? null : String(raw.actual).trim();
    const cancelled = !!raw.cancelled || isCancelledText(estText) || isCancelledText(actText);

    let actual = toClock(actText);
    if (!actual && isOnTime(actText)) actual = scheduled;
    let expected = toClock(estText);
    if (!expected && isOnTime(estText)) expected = scheduled;

    const passed = !cancelled && (!!raw.visited || (actText !== null && actText !== ''));
    const best = passed ? actual : expected;
    let lateMinutes = best && scheduled ? diffMinutes(best, scheduled) : null;
    if (lateMinutes === null && (isOnTime(passed ? actText : estText))) lateMinutes = 0;

    let status;
    if (cancelled) status = 'cancelled';
    else if (passed && isNoReport(actText)) status = 'no-report';
    else if (!passed && isDelayedText(estText)) status = 'delayed';
    else if (lateMinutes === null) status = 'unknown';
    else if (lateMinutes > 0) status = 'late';
    else if (lateMinutes < 0) status = 'early';
    else status = 'on-time';

    return {
      name: String(raw.name ?? raw.crs ?? 'Unknown station'),
      crs: raw.crs ? String(raw.crs).toUpperCase() : null,
      scheduled,
      expected: passed || cancelled ? null : expected,
      actual: passed ? actual : null,
      passed,
      lateMinutes: cancelled ? null : lateMinutes,
      cancelled,
      status,
      statusText: (passed ? actText : estText) || null,
      length: Number.isFinite(raw.length) && raw.length > 0 ? raw.length : null,
      isViewing: false,
      isLastReported: false,
    };
  }

  /**
   * Mark the train's last reported stop. With a `lastCrs` (railinfo's LastLocation) use that
   * station (the last passed copy of it, since a train can call twice, e.g. Virginia Water);
   * otherwise the last stop the train has passed.
   */
  function markLastReported(stops, lastCrs) {
    let idx = -1;
    if (lastCrs) {
      const want = String(lastCrs).toUpperCase();
      stops.forEach((s, i) => { if (s.crs === want && s.passed) idx = i; });
      if (idx < 0) idx = stops.findIndex((s) => s.crs === want);
    }
    if (idx < 0) stops.forEach((s, i) => { if (s.passed) idx = i; });
    if (idx >= 0) stops[idx].isLastReported = true;
    return idx;
  }

  /** Mark the station being viewed: its first copy the train hasn't passed yet, else the last copy. */
  function markViewing(stops, viewingCrs) {
    if (!viewingCrs) return -1;
    const want = String(viewingCrs).toUpperCase();
    let idx = stops.findIndex((s) => s.crs === want && !s.passed);
    if (idx < 0) stops.forEach((s, i) => { if (s.crs === want) idx = i; });
    if (idx >= 0) stops[idx].isViewing = true;
    return idx;
  }

  function finishModel(base, stops, viewingCrs, lastCrs) {
    markLastReported(stops, lastCrs);
    markViewing(stops, viewingCrs);
    const last = stops.find((s) => s.isLastReported);
    return {
      ...base,
      viewingCrs: viewingCrs ? String(viewingCrs).toUpperCase() : null,
      lastLocation: last ? { name: last.name, crs: last.crs } : null,
      allCancelled: stops.length > 0 && stops.every((s) => s.cancelled),
      stops,
    };
  }

  /**
   * railinfo POST /journey/services -> shared shape.
   * The response's top-level `Destination` is really the station the service id was taken from
   * (the board's station). That station's row has `ScheduledTime: null` when it is the origin, so
   * its departure times come from the top-level ScheduledDeparture / EstimatedDeparture /
   * ActualDeparture, which is also the time shown on the departure board.
   */
  function normalizeCallingPoints(service, viewingCrs) {
    const s = service || {};
    const points = Array.isArray(s.CallingPoints) ? s.CallingPoints : [];
    const locCrs = s.Destination && s.Destination.CrsCode ? String(s.Destination.CrsCode).toUpperCase() : null;
    const crsOf = (p) => (p && p.Station && p.Station.CrsCode ? String(p.Station.CrsCode).toUpperCase() : null);
    let locIdx = -1;
    if (locCrs) {
      locIdx = points.findIndex((p) => crsOf(p) === locCrs && !p.ScheduledTime);
      if (locIdx < 0) locIdx = points.findIndex((p) => crsOf(p) === locCrs && !p.IsVisited);
    }
    const stops = points.map((p, i) => {
      const raw = {
        name: p && p.Station ? p.Station.Name : null,
        crs: crsOf(p),
        scheduled: p ? p.ScheduledTime : null,
        estimated: p ? p.EstimatedTime : null,
        actual: p ? p.ActualTime : null,
        visited: !!(p && p.IsVisited),
      };
      if (i === locIdx) {
        if (s.ScheduledDeparture) {
          raw.scheduled = s.ScheduledDeparture;
          raw.estimated = s.EstimatedDeparture ?? raw.estimated;
          raw.actual = s.ActualDeparture ?? raw.actual;
        } else if (!raw.scheduled && s.ScheduledArrival) {
          raw.scheduled = s.ScheduledArrival;
          raw.estimated = s.EstimatedArrival ?? raw.estimated;
          raw.actual = s.ActualArrival ?? raw.actual;
        }
      }
      return makeStop(raw);
    });
    const lastCrs = s.LastLocation && s.LastLocation.CrsCode ? s.LastLocation.CrsCode : null;
    return finishModel({
      source: 'railinfo',
      generatedAt: s.GeneratedAt || null,
      locationCrs: locCrs,
      platform: s.Platform ?? null,
      length: null,
    }, stops, viewingCrs, lastCrs);
  }

  /**
   * Huxley2 GET /service/{id} -> shared shape. The stop the id belongs to (`crs`, with
   * std/etd/atd) is not in either list, so it is put between previousCallingPoints and
   * subsequentCallingPoints. Only the first group of each is this train; further groups are
   * portions that join or split.
   */
  function normalizeHuxleyCallingPoints(service, viewingCrs) {
    const s = service || {};
    const group = (g) => (Array.isArray(g) && g[0] && Array.isArray(g[0].callingPoint) ? g[0].callingPoint : []);
    const fromPoint = (c) => makeStop({
      name: c.locationName, crs: c.crs, scheduled: c.st, estimated: c.et, actual: c.at,
      cancelled: !!c.isCancelled, length: c.length,
    });
    const stops = group(s.previousCallingPoints).map(fromPoint);
    if (s.crs || s.locationName) {
      stops.push(makeStop({
        name: s.locationName, crs: s.crs,
        scheduled: s.std || s.sta,
        estimated: s.std ? s.etd : s.eta,
        actual: s.std ? s.atd : s.ata,
        cancelled: !!s.isCancelled, length: s.length,
      }));
    }
    group(s.subsequentCallingPoints).forEach((c) => stops.push(fromPoint(c)));
    return finishModel({
      source: 'huxley',
      generatedAt: s.generatedAt || null,
      locationCrs: s.crs ? String(s.crs).toUpperCase() : null,
      platform: s.platform ?? null,
      length: Number.isFinite(s.length) && s.length > 0 ? s.length : null,
    }, stops, viewingCrs, null);
  }

  // ---------- Presentation helpers (pure) ----------

  const STATUS_CLASS = {
    'on-time': 'good', early: 'good', late: 'warning', delayed: 'serious',
    cancelled: 'critical', 'no-report': 'info', unknown: 'info',
  };
  const STATUS_ICON = { good: '✓', warning: '!', serious: '!!', critical: '✕', info: '?' };

  const lateness = (n) => (n > 0 ? `${n} min late` : n < 0 ? `${-n} min early` : 'on time');

  /** { cls, icon, text } for one stop. Colour always comes with this text. */
  function stopStatus(stop) {
    let cls = STATUS_CLASS[stop.status] || 'info';
    // Same bands as S1's board: 1-4 minutes late is amber, 5 or more orange.
    if (stop.status === 'late' && stop.lateMinutes >= 5) cls = 'serious';
    let text;
    switch (stop.status) {
      case 'cancelled': text = 'Cancelled'; break;
      case 'no-report': text = 'Passed, no time reported'; break;
      case 'delayed': text = 'Delayed, no estimate yet'; break;
      case 'unknown': text = stop.passed ? 'Passed' : 'No estimate'; break;
      default:
        if (stop.passed) {
          text = stop.actual && stop.lateMinutes !== 0 ? `Departed ${stop.actual}, ${lateness(stop.lateMinutes)}` : 'Departed on time';
        } else {
          text = stop.expected && stop.lateMinutes !== 0 ? `Expected ${stop.expected}, ${lateness(stop.lateMinutes)}` : 'On time';
        }
    }
    return { cls, icon: STATUS_ICON[cls], text };
  }

  /** One sentence on where the train is and where it calls next. */
  function summaryText(model) {
    const stops = model.stops || [];
    if (!stops.length) return 'No calling points reported for this train.';
    if (model.allCancelled) return 'This train is cancelled.';
    const lastIdx = stops.findIndex((s) => s.isLastReported && s.passed);
    const parts = [];
    const when = (s) => {
      if (s.status === 'delayed') return 'delayed';
      if (s.expected && s.lateMinutes) return `expected ${s.expected} (${lateness(s.lateMinutes)})`;
      if (s.expected) return `expected ${s.expected}`;
      return s.scheduled ? `due ${s.scheduled}` : '';
    };
    if (lastIdx >= 0) {
      const last = stops[lastIdx];
      const how = last.lateMinutes === null ? '' : ` (${lateness(last.lateMinutes)})`;
      parts.push(`Last reported at ${last.name}${how}.`);
      const next = stops.slice(lastIdx + 1).find((s) => !s.passed && !s.cancelled);
      if (next) parts.push(`Next: ${next.name}${when(next) ? `, ${when(next)}` : ''}.`);
    } else {
      const first = stops.find((s) => !s.cancelled);
      if (first) parts.push(`Not departed from ${first.name} yet${when(first) ? `: ${when(first)}` : ''}.`);
    }
    const firstCancelled = stops.findIndex((s) => s.cancelled);
    if (firstCancelled > 0 && stops.slice(firstCancelled).every((s) => s.cancelled)) {
      parts.push(`Cancelled from ${stops[firstCancelled].name}.`);
    } else if (stops.some((s) => s.cancelled)) {
      parts.push(`Won't call at ${stops.filter((s) => s.cancelled).map((s) => s.name).join(', ')}.`);
    }
    return parts.join(' ');
  }

  /** "19:58" style time in London for an ISO timestamp, or null. */
  function formatUpdated(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
    } catch (e) {
      return d.toTimeString().slice(0, 8);
    }
  }

  const SOURCE_LABEL = { railinfo: 'SWR live train info', huxley: 'Huxley2 (National Rail data, unofficial)' };

  /** Index of the first stop to show when earlier passed stops are folded away. */
  function foldIndex(stops) {
    const keep = stops.reduce((m, s, i) => (s.isLastReported || s.isViewing || !s.passed ? Math.min(m, i) : m), stops.length);
    const lastIdx = stops.findIndex((s) => s.isLastReported);
    const anchor = Math.min(keep, lastIdx >= 0 ? lastIdx : keep);
    return Math.max(0, anchor - KEEP_PASSED + 1);
  }

  /**
   * HTML for a model. Every API string goes through esc().
   * opts: { serviceId, expanded, note, uid }
   */
  function renderCallingPoints(model, opts) {
    const o = opts || {};
    const stops = model.stops || [];
    const uid = o.uid || 'swr-cp';
    const fold = foldIndex(stops);
    const folded = fold >= 2 && !o.expanded ? fold : 0;
    const canFold = fold >= 2;

    const items = stops.map((s, i) => {
      const st = stopStatus(s);
      const cls = ['swr-cp-stop', `swr-cp-${st.cls}`];
      if (s.passed) cls.push('is-passed');
      if (s.cancelled) cls.push('is-cancelled');
      if (s.isLastReported) cls.push('is-last');
      if (s.isViewing) cls.push('is-viewing');
      if (i === 0) cls.push('is-first');
      if (i === stops.length - 1) cls.push('is-final');
      const tags = [];
      if (s.isViewing) tags.push('<span class="swr-cp-tag swr-cp-tag-here">Your station</span>');
      if (s.isLastReported) tags.push(`<span class="swr-cp-tag swr-cp-tag-last"><span aria-hidden="true">◆ </span>${s.passed ? 'Train last reported here' : 'Train reported here'}</span>`);
      const time = s.scheduled
        ? `<span class="visually-hidden">Scheduled </span>${esc(s.scheduled)}`
        : '<span aria-hidden="true">–</span><span class="visually-hidden">No scheduled time</span>';
      return `<li class="${cls.join(' ')}"${i < folded ? ' hidden' : ''}${s.isViewing ? ' aria-current="location"' : ''}>
        <span class="swr-cp-dot" aria-hidden="true"></span>
        <div class="swr-cp-main">
          <span class="swr-cp-name">${esc(s.name)}${s.passed ? '<span class="visually-hidden">, passed</span>' : ''}</span>
          ${tags.length ? `<span class="swr-cp-tags">${tags.join(' ')}</span>` : ''}
          <span class="swr-cp-status"><span class="swr-cp-icon" aria-hidden="true">${st.icon}</span>${esc(st.text)}</span>
        </div>
        <span class="swr-cp-time">${time}</span>
      </li>`;
    }).join('');

    const listId = `${uid}-list`;
    const toggle = canFold
      ? `<button type="button" class="swr-cp-toggle" aria-expanded="${o.expanded ? 'true' : 'false'}" aria-controls="${esc(listId)}">${o.expanded ? 'Hide earlier stops' : `Show ${fold} earlier ${fold === 1 ? 'stop' : 'stops'}`}</button>`
      : '';
    const updated = formatUpdated(model.generatedAt);
    const meta = [
      model.length ? `${model.length} coaches` : '',
      updated ? `Last updated ${updated}` : 'Last updated time not given',
      `from ${SOURCE_LABEL[model.source] || 'unknown source'}`,
    ].filter(Boolean).join(' · ');

    return `<div class="swr-cp" data-source="${esc(model.source)}"${o.serviceId ? ` data-service-id="${esc(o.serviceId)}"` : ''}>
      <p class="swr-cp-summary">${esc(summaryText(model))}</p>
      ${o.note ? `<p class="swr-cp-note" role="status">${esc(o.note)}</p>` : ''}
      ${toggle}
      <ol class="swr-cp-list" id="${esc(listId)}" aria-label="Calling points, ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}">${items}</ol>
      <p class="swr-cp-meta">${esc(meta)}</p>
      <details class="swr-cp-about">
        <summary>About this data</summary>
        <p>Stops and times come from SWR's live train info (railinfo.southwesternrailway.com), the feed behind SWR's own website.
        If that fails, they come from Huxley2, an unofficial community wrapper around National Rail's live data run by a volunteer.
        "Train last reported here" is the last station the train was recorded at, not a live GPS position. Times are UK local time and are refreshed with the departures board (each train at most every 30 seconds).</p>
      </details>
    </div>`;
  }

  // ---------- Demo fixtures ----------

  // A Waterloo -> Reading stopping pattern, minutes after departure, from the real
  // POST /journey/services response for 9138695SURBITN_ (27/09/2026).
  const DEMO_ROUTE = [
    ['London Waterloo', 'WAT', 0], ['Vauxhall', 'VXH', 5], ['Clapham Junction', 'CLJ', 10],
    ['Wimbledon', 'WIM', 16], ['Surbiton', 'SUR', 23], ['Weybridge', 'WYB', 31],
    ['Addlestone', 'ASN', 43], ['Chertsey', 'CHY', 46], ['Virginia Water', 'VIR', 51],
    ['Virginia Water', 'VIR', 63], ['Sunningdale', 'SNG', 67], ['Ascot', 'ACT', 72],
    ['Martins Heron', 'MAO', 77], ['Bracknell', 'BCE', 80], ['Wokingham', 'WKM', 86],
    ['Winnersh', 'WNS', 90], ['Winnersh Triangle', 'WTI', 92], ['Earley', 'EAR', 95], ['Reading', 'RDG', 100],
  ];

  function hashId(id) {
    let h = 2166136261;
    for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
  }

  function londonNowMinutes() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
      return toMinutes(parts) ?? 0;
    } catch (e) {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  /**
   * The stopping pattern for a demo train: { stops: [[name, crs, minutes], ...], at }, where `at`
   * is the index of the board's own station. With a `board` row (see demoBoardFor) the train
   * calls at the board's station and runs towards the row's destination; without one it is
   * Waterloo -> Reading with `at` 0.
   */
  function demoPattern(board) {
    if (!board || !board.crs) return { stops: DEMO_ROUTE, at: 0 };
    const view = [board.name || board.crs, board.crs];
    const dest = board.destination && board.destination.CrsCode
      ? [board.destination.Name || board.destination.CrsCode, board.destination.CrsCode] : null;
    if (board.bus || !dest) return { stops: [[...view, 0]].concat(dest ? [[...dest, 12]] : []), at: 0 };
    const total = DEMO_ROUTE[DEMO_ROUTE.length - 1][2];
    if (dest[1] === 'WAT') {
      // Up train: Reading -> Waterloo, or from an off-route station via Surbiton.
      let stops = DEMO_ROUTE.slice().reverse().map(([n, c, o]) => [n, c, total - o]);
      let at = stops.findIndex((s) => s[1] === view[1]);
      if (at < 0) {
        const sur = stops.findIndex((s) => s[1] === 'SUR');
        stops = [[...view, stops[sur][2] - 15]].concat(stops.slice(sur));
        at = 0;
      }
      return { stops, at };
    }
    // Down train: from Waterloo (or from the board's station) towards the destination.
    let stops = DEMO_ROUTE.slice();
    let at = stops.findIndex((s) => s[1] === view[1]);
    if (at < 0) { stops = [[...view, 0]]; at = 0; }
    const d = stops.findIndex((s, i) => i > at && s[1] === dest[1]);
    if (d >= 0) return { stops: stops.slice(0, d + 1), at };
    const sur = stops.findIndex((s) => s[1] === 'SUR');
    const keep = stops.slice(0, Math.max(at, sur) + 1);
    return { stops: keep.concat([[...dest, keep[keep.length - 1][2] + 30]]), at };
  }

  /**
   * A plausible train for a service id at `nowMin` (minutes after midnight, London). With a
   * `board` row it is due at the board's station at the row's time, with the row's delay or
   * cancellation. Without one, how far it has got and how late it is depend on the id.
   * Returns { plan: [{name, crs, scheduled, estimated, actual, passed, cancelled}], at }.
   */
  function demoPlan(id, nowMin, board) {
    const h = hashId(id);
    const { stops, at } = demoPattern(board);
    const boardTime = board ? toMinutes(board.scheduled) : null;
    let dep;
    let delay;
    let cancelFrom = -1;
    let noEstimate = false;
    if (boardTime !== null) {
      const est = String(board.estimated || '');
      dep = boardTime - stops[at][2];
      delay = toMinutes(est) !== null ? Math.max(0, diffMinutes(est, board.scheduled)) : 0;
      if (isDelayedText(est)) { delay = 10; noEstimate = true; }
      if (isCancelledText(est)) cancelFrom = 0;
    } else {
      dep = nowMin - [-12, -3, 4, 14, 27, 50][h % 6];       // minutes since scheduled departure
      delay = [0, 0, 2, 5, 0, 14][Math.floor(h / 6) % 6];
      cancelFrom = h % 7 === 3 ? 14 : -1;                   // index in DEMO_ROUTE (Wokingham)
      noEstimate = h % 11 === 5;                            // "Delayed" with no time yet
    }
    const plan = stops.map(([name, crs, off], i) => {
      const sched = dep + off;
      const cancelled = cancelFrom >= 0 && i >= cancelFrom;
      // A board row is still to come at the board's station, so only earlier stops can be passed.
      const passed = !cancelled && diffMinutes(formatMinutes(nowMin), formatMinutes(sched + delay)) >= 0 && (boardTime === null || i < at);
      return {
        name, crs, cancelled, passed,
        scheduled: formatMinutes(sched),
        actual: passed ? (delay ? formatMinutes(sched + delay) : 'On time') : null,
        estimated: cancelled ? 'Cancelled' : passed ? null : noEstimate && delay ? 'Delayed' : delay ? formatMinutes(sched + delay) : 'On time',
      };
    });
    return { plan, at };
  }

  /** Railinfo-shaped body (POST /journey/services) for a demo service id. */
  function demoRailinfoService(id, nowMin, generatedAt, board) {
    const { plan, at } = demoPlan(id, nowMin, board);
    const here = plan[at];
    const origin = at === 0;
    let last = null;
    plan.forEach((p) => { if (p.passed) last = p; });
    return {
      Id: null,
      Destination: { Name: here.name, CrsCode: here.crs },
      LastLocation: last ? { Name: last.name, CrsCode: last.crs } : null,
      Operator: 'South Western Railway',
      Platform: String(1 + (hashId(id) % 19)),
      ScheduledArrival: origin ? null : here.scheduled,
      EstimatedArrival: origin || here.passed ? null : here.estimated,
      ActualArrival: origin ? null : here.actual,
      ScheduledDeparture: here.scheduled,
      EstimatedDeparture: here.passed ? null : here.estimated,
      ActualDeparture: here.actual,
      GeneratedAt: generatedAt || new Date().toISOString(),
      CallingPoints: plan.map((p, i) => {
        // Like the real API, the board's own row has no times of its own when it is the origin.
        const blank = origin && i === 0;
        return {
          Station: { Name: p.name, CrsCode: p.crs },
          ScheduledTime: blank ? null : p.scheduled,
          EstimatedTime: blank ? null : p.estimated,
          ActualTime: blank ? null : p.actual,
          IsVisited: blank ? false : p.passed,
        };
      }),
    };
  }

  /** Huxley2-shaped body (GET /service/{id}) for a demo service id. */
  function demoHuxleyService(id, nowMin, generatedAt, board) {
    const { plan, at } = demoPlan(id, nowMin, board);
    const length = [5, 8, 10, 10, 12][hashId(id) % 5];
    const here = plan[at];
    const origin = at === 0;
    const point = (p) => ({
      locationName: p.name, crs: p.crs, st: p.scheduled, et: p.estimated, at: p.actual,
      isCancelled: p.cancelled, length, detachFront: false, formation: null, adhocAlerts: null,
    });
    const group = (list) => (list.length ? [{ callingPoint: list.map(point), serviceType: 0, serviceChangeRequired: false, assocIsCancelled: false }] : null);
    return {
      generatedAt: generatedAt || new Date().toISOString(),
      locationName: here.name, crs: here.crs,
      operator: 'South Western Railway', operatorCode: 'SW',
      isCancelled: here.cancelled, cancelReason: null, delayReason: null,
      length, platform: String(1 + (hashId(id) % 19)),
      sta: origin ? null : here.scheduled, eta: origin || here.passed ? null : here.estimated, ata: origin ? null : here.actual,
      std: here.scheduled, etd: here.passed ? null : here.estimated, atd: here.actual,
      previousCallingPoints: group(plan.slice(0, at)),
      subsequentCallingPoints: group(plan.slice(at + 1)),
    };
  }

  // The station each service was opened from (set by onServiceOpen), so that in ?demo the
  // demo train matches the departures-board row that was opened.
  const demoViews = new Map();

  function noteDemoView(id, crs) {
    if (!id || !crs) return;
    demoViews.delete(id);
    demoViews.set(id, crs);
    if (demoViews.size > 200) demoViews.delete(demoViews.keys().next().value);
  }

  /**
   * The departures-board row for a demo service id, asked of the other demo routes (S1's
   * railinfo departures fixture): { crs, name, scheduled, estimated, destination, bus } | null.
   */
  function demoBoardFor(id) {
    const crs = demoViews.get(id);
    const swr = root.SwrApi;
    if (!crs || !swr || !Array.isArray(swr.demoRoutes)) return null;
    const url = `https://railinfo.southwesternrailway.com/journey/departures/${encodeURIComponent(crs)}`;
    for (const routeFn of swr.demoRoutes) {
      if (routeFn === demoRoute) continue;
      let body = null;
      try { body = routeFn(url, { method: 'GET' }); } catch (e) { body = null; }
      if (!body || !Array.isArray(body.Items)) continue;
      const bus = (body.BusItems || []).find((x) => String(x.Id) === id);
      const row = bus || body.Items.find((x) => String(x.Id) === id);
      if (!row) continue;
      return {
        crs, name: (body.Station && body.Station.Name) || crs,
        scheduled: row.ScheduledTime, estimated: row.EstimatedTime, destination: row.Destination || null, bus: !!bus,
      };
    }
    return null;
  }

  /** SwrApi demo route: (url, options) => body | null. */
  function demoRoute(url, options) {
    const u = String(url || '');
    if (/railinfo\.southwesternrailway\.com\/journey\/services\b/i.test(u)) {
      let body = options && options.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      const id = body && (body.ServiceId || body.serviceId);
      return id ? demoRailinfoService(String(id), londonNowMinutes(), null, demoBoardFor(String(id))) : null;
    }
    const m = /huxley2\.azurewebsites\.net\/service\/([^/?#]+)/i.exec(u);
    if (m) {
      let id = m[1];
      try { id = decodeURIComponent(id); } catch (e) { /* keep as is */ }
      return demoHuxleyService(id, londonNowMinutes(), null, demoBoardFor(id));
    }
    return null;
  }

  // ---------- Page wiring ----------

  const state = {
    seq: 0,
    tokens: new WeakMap(),    // container -> latest request token
    expanded: new Set(),      // service ids whose earlier stops are shown
    remembered: new Map(),    // service id -> { source, body }
  };

  function remember(id, raw) {
    state.remembered.delete(id);
    state.remembered.set(id, raw);
    if (state.remembered.size > MAX_REMEMBERED) state.remembered.delete(state.remembered.keys().next().value);
  }

  const hasRailinfoStops = (b) => !!(b && Array.isArray(b.CallingPoints) && b.CallingPoints.length);
  const hasHuxleyStops = (b) => !!(b && (b.crs || (Array.isArray(b.subsequentCallingPoints) && b.subsequentCallingPoints.length) || (Array.isArray(b.previousCallingPoints) && b.previousCallingPoints.length)));
  const errMessage = (e) => (e && e.message ? e.message : String(e || 'unknown error'));

  /** railinfo first, then Huxley2. Resolves to { source, body }. */
  function fetchService(api, id) {
    const huxley = (firstErr) => {
      if (typeof api.huxleyService !== 'function') return Promise.reject(firstErr);
      return Promise.resolve()
        .then(() => api.huxleyService(id))
        .then((body) => {
          if (!hasHuxleyStops(body)) throw new Error('no calling points from Huxley2');
          return { source: 'huxley', body };
        })
        .catch((e) => { throw new Error(`${errMessage(firstErr)}; fallback: ${errMessage(e)}`); });
    };
    if (typeof api.service !== 'function') return huxley(new Error('SWR live train info not available'));
    return Promise.resolve()
      .then(() => api.service(id))
      .then((body) => {
        if (!hasRailinfoStops(body)) throw new Error('no calling points from SWR');
        return { source: 'railinfo', body };
      })
      .catch(huxley);
  }

  function loadService(api, id) {
    const run = () => fetchService(api, id);
    return typeof api.cached === 'function' ? Promise.resolve(api.cached(`swr-cp:${id}`, CACHE_TTL_MS, run)) : run();
  }

  function toModel(raw, crs) {
    return raw.source === 'huxley' ? normalizeHuxleyCallingPoints(raw.body, crs) : normalizeCallingPoints(raw.body, crs);
  }

  /** Is this response still wanted? The container may have been closed, removed or re-requested. */
  function isCurrent(container, token, id) {
    if (state.tokens.get(container) !== token) return false;
    if (!container.isConnected) return false;
    if (container.hidden || (container.closest && container.closest('[hidden]'))) return false;
    const own = container.getAttribute && container.getAttribute('data-service-id');
    return !own || own === id;
  }

  // Controls whose focus survives a repaint (S1 re-dispatches the event on every refresh).
  const FOCUSABLE = ['.swr-cp-toggle', '.swr-cp-about summary'];
  const focusMemo = new WeakMap(); // container -> { sel, lostAt }
  const watched = new WeakSet();

  /**
   * Remember which of our controls has focus. S1's refresh takes the open container out of the
   * page for a moment, which drops focus to <body>; restoreFocus() puts it back when S1
   * re-dispatches the event straight after, but not if the user had moved focus away.
   */
  function watchFocus(container) {
    if (watched.has(container)) return;
    watched.add(container);
    container.addEventListener('focusin', (e) => {
      const sel = FOCUSABLE.find((s) => e.target.matches && e.target.matches(s));
      if (sel) focusMemo.set(container, { sel, lostAt: null }); else focusMemo.delete(container);
    });
    container.addEventListener('focusout', (e) => {
      const memo = focusMemo.get(container);
      if (!memo) return;
      if (e.relatedTarget && !container.contains(e.relatedTarget)) focusMemo.delete(container);
      else memo.lostAt = Date.now();
    });
  }

  function restoreFocus(container) {
    const memo = focusMemo.get(container);
    const doc = container.ownerDocument;
    if (!memo || !doc) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement) return;
    if (memo.lostAt !== null && Date.now() - memo.lostAt > 1000) { focusMemo.delete(container); return; }
    const el = container.querySelector(memo.sel);
    if (el) el.focus();
  }

  function paint(container, model, id, crs, note) {
    const uid = `swr-cp-${String(id).replace(/[^A-Za-z0-9_-]/g, '')}`;
    const prevAbout = container.querySelector('.swr-cp-about');
    const aboutOpen = !!(prevAbout && prevAbout.open);
    const active = container.ownerDocument && container.ownerDocument.activeElement;
    const focusSel = active && container.contains(active) ? FOCUSABLE.find((sel) => active.matches(sel)) : null;
    container.innerHTML = renderCallingPoints(model, { serviceId: id, expanded: state.expanded.has(id), note, uid });
    container.removeAttribute('aria-busy');
    if (aboutOpen) container.querySelector('.swr-cp-about').open = true;
    if (focusSel) {
      const el = container.querySelector(focusSel);
      if (el) el.focus();
    }
    const btn = container.querySelector('.swr-cp-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
        paint(container, model, id, crs, note);
        const again = container.querySelector('.swr-cp-toggle');
        if (again) again.focus();
      });
    }
  }

  function onServiceOpen(ev) {
    const d = (ev && ev.detail) || {};
    const container = d.container;
    const id = d.serviceId ? String(d.serviceId) : '';
    if (!container || !id || typeof container.querySelector !== 'function') return;
    const crs = d.crs ? String(d.crs).toUpperCase() : null;
    noteDemoView(id, crs);
    const token = ++state.seq;
    state.tokens.set(container, token);

    const known = state.remembered.get(id);
    const shown = container.querySelector('.swr-cp');
    watchFocus(container);
    if (shown && shown.getAttribute('data-service-id') === id) {
      // Already showing this train (S1 kept the container across its refresh): update in place.
      restoreFocus(container);
    } else if (known) paint(container, toModel(known, crs), id, crs);
    else container.innerHTML = '<p class="swr-cp-loading" role="status">Loading calling points…</p>';
    container.setAttribute('aria-busy', 'true');

    const api = root.SwrApi;
    if (!api) {
      container.removeAttribute('aria-busy');
      if (!known) container.innerHTML = '<p class="swr-cp-error" role="status">Calling points unavailable: the SWR client did not load.</p>';
      return;
    }
    loadService(api, id).then((raw) => {
      if (!isCurrent(container, token, id)) return;
      remember(id, raw);
      paint(container, toModel(raw, crs), id, crs);
    }).catch((err) => {
      if (!isCurrent(container, token, id)) return;
      const again = state.remembered.get(id);
      if (again) {
        paint(container, toModel(again, crs), id, crs, `Couldn't refresh the calling points (${errMessage(err)}). Showing the last ones received.`);
      } else {
        container.removeAttribute('aria-busy');
        container.innerHTML = `<p class="swr-cp-error" role="status">Calling points unavailable right now: ${esc(errMessage(err))}</p>`;
      }
    });
  }

  const api = {
    CACHE_TTL_MS,
    toMinutes,
    diffMinutes,
    makeStop,
    normalizeCallingPoints,
    normalizeHuxleyCallingPoints,
    stopStatus,
    summaryText,
    formatUpdated,
    foldIndex,
    renderCallingPoints,
    demoPattern,
    demoPlan,
    noteDemoView,
    demoBoardFor,
    demoRailinfoService,
    demoHuxleyService,
    demoRoute,
    fetchService,
    onServiceOpen,
  };

  root.SwrCallingPoints = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.SwrApi && Array.isArray(window.SwrApi.demoRoutes)) {
    window.SwrApi.demoRoutes.push(demoRoute);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('swr:service-open', onServiceOpen);
  }
})(typeof window !== 'undefined' ? window : globalThis);
