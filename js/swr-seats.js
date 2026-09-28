/*
 * SWR tab, package S4: typical busyness per morning train into London Waterloo (item SWR-2).
 * Renders into <section id="swr-seats">.
 *
 * Data: the weekly snapshot that package S7 publishes, read with SwrApi.snapshot():
 *   data/swr/seats/{CRS}.json   {fetchedAt, crs, from: <SWR's name>, to: "London Waterloo", items: <raw Items[]>}
 *   data/swr/seats/index.json   {fetchedAt, stations: [{crs, seatName}]}
 * copied from SWR's website API (no CORS, so browsers can't call it):
 *   GET https://www.southwesternrailway.com/api/seatavailability/{fromName}/London%20Waterloo?skip=0&take=100
 *   → {TotalResults, Items[{Id, StationFrom, StationTo, Departure "06:28", Arrival "07:04",
 *      JourneyDuration "12:34:00 AM" (junk: not the journey time), Via "-", NumberOfCarriages 8,
 *      Monday…Friday "Green"|"Amber"|"Red"|"VeryRed"|"", Mon_TrainName…Fri_TrainName "Arterio"|""}]}
 *
 * What the colours mean is SWR's own wording, from the labels on its "How busy is my train?" page
 * (https://www.southwesternrailway.com/plan-my-journey/how-busy-is-my-train, checked 2026-09-28):
 *   Green "Seats available", Amber "Some seats available", Red "Standing room only",
 *   VeryRed "Full to capacity", and an empty value "No Service".
 *
 * Coverage is weekday mornings into London Waterloo only (trains arriving before 10:00). When the
 * chosen station has no file, the section stays hidden; at Waterloo it explains what it covers.
 * Every API string is escaped with esc().
 *
 * Classic script; the pure helpers are also exported for Node tests.
 */
(function (root) {
  'use strict';

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const TRAIN_NAME_FIELDS = ['Mon_TrainName', 'Tue_TrainName', 'Wed_TrainName', 'Thu_TrainName', 'Fri_TrainName'];
  const WATERLOO = 'WAT';
  const DEFAULT_ARRIVE_BY = '09:00';
  const STORE_ARRIVE_BY = 'swr.arriveBy';
  const QUIET_WINDOW_MINS = 60; // quieter picks arrive at most this long before the chosen time
  const TABLE_BEFORE_MINS = 60; // the table shows trains arriving from this long before the chosen time…
  const TABLE_AFTER_MINS = 15; // …to this long after it, unless "Show all" is on
  const STALE_DAYS = 15; // S7 refreshes weekly; older than two weeks means the refresh has stopped
  const SWR_PAGE = 'https://www.southwesternrailway.com/plan-my-journey/how-busy-is-my-train';

  /*
   * Levels, keyed by the normalised API value. `label` is SWR's wording (see the header); `short` is
   * this dashboard's abbreviation for the day chips. `pips` and `css` reuse the TfL tab's crowding scale
   * (status colour + pips + text, never colour alone).
   */
  const LEVELS = {
    green: { key: 'green', rank: 1, pips: 1, css: 'quiet', label: 'Seats available', short: 'Seats' },
    amber: { key: 'amber', rank: 2, pips: 2, css: 'moderate', label: 'Some seats available', short: 'Some seats', tiny: 'Some' },
    red: { key: 'red', rank: 3, pips: 3, css: 'busy', label: 'Standing room only', short: 'Standing' },
    veryred: { key: 'veryred', rank: 4, pips: 4, css: 'very-busy', label: 'Full to capacity', short: 'Full' },
    none: { key: 'none', rank: 0, pips: 0, css: 'none', label: 'No service', short: 'No train' },
  };
  const LEGEND_ORDER = ['green', 'amber', 'red', 'veryred', 'none'];

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------------------
  // Times and days
  // ---------------------------------------------------------------------------

  /** "06:28" (or "6:28", "06:28:00") → 388 minutes after midnight, or null. */
  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(clean(hhmm));
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /** 388 → "06:28" (wraps round midnight). */
  function formatMinutes(mins) {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  /**
   * Journey time from Departure and Arrival, in minutes (across midnight if need be), or null.
   * SWR's own JourneyDuration ("12:34:00 AM") isn't used: it's a clock time, not a duration, and
   * doesn't match Departure/Arrival (06:28 → 07:04 is 36 minutes; it says "12:34:00 AM").
   */
  function durationMinutes(departure, arrival) {
    const d = toMinutes(departure);
    const a = toMinutes(arrival);
    if (d === null || a === null) return null;
    let mins = a - d;
    if (mins < 0) mins += 1440;
    return mins > 0 && mins <= 360 ? mins : null;
  }

  /** "9:05", "09:05:00" → "09:05"; anything else → null. */
  function parseArriveBy(value) {
    const m = toMinutes(value);
    return m === null ? null : formatMinutes(m);
  }

  const londonWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long' });

  /** The weekday in London (0 Monday … 6 Sunday) for a Date. */
  function londonDayIndex(date) {
    const name = londonWeekday.format(date);
    const i = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(name);
    return i < 0 ? 0 : i;
  }

  /**
   * Which weekday column to use → {day: 'Monday', index: 0, short: 'Mon', today: bool, weekend: bool}.
   * `day` may be a day name or abbreviation ("Thursday", "thu"), an index 0–4 (Monday–Friday), a Date,
   * or null/undefined for today. Saturday and Sunday fall back to Monday (weekend: true).
   * `now` (default: now) decides what "today" is, in London time.
   */
  function resolveDay(day, now) {
    const nowDate = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const todayIdx = londonDayIndex(nowDate);
    let idx = null;
    let weekend = false;
    if (day instanceof Date) {
      idx = londonDayIndex(day);
    } else if (typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 4) {
      idx = day;
    } else if (typeof day === 'string' && clean(day)) {
      const t = clean(day).toLowerCase().slice(0, 3);
      const all = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      if (all.includes(t)) idx = all.indexOf(t);
    }
    if (idx === null) idx = todayIdx;
    if (idx > 4) { weekend = true; idx = 0; }
    return { day: DAYS[idx], index: idx, short: DAY_SHORT[idx], today: !weekend && idx === todayIdx, weekend };
  }

  // ---------------------------------------------------------------------------
  // Normalising the seat availability items
  // ---------------------------------------------------------------------------

  /** "Green" | "Amber" | "Red" | "VeryRed" | "" | anything else → a level object (a copy, with `raw`). */
  function normalizeLevel(raw) {
    const text = clean(raw);
    const key = text.toLowerCase().replace(/[^a-z]/g, '');
    if (LEVELS[key]) return { ...LEVELS[key], raw: text };
    if (!key) return { ...LEVELS.none, raw: text };
    // A value SWR hasn't used before: show its own text, grey, with no pips.
    return { key: 'unknown', rank: 0, pips: 0, css: 'unknown', label: text, short: text.slice(0, 12), raw: text };
  }

  /** Carriages as a positive whole number, or null. */
  function carriageCount(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n <= 30 ? n : null;
  }

  /** One raw item → a row. */
  function normalizeSeatItem(item) {
    const it = item && typeof item === 'object' ? item : {};
    const departure = toMinutes(it.Departure) === null ? null : formatMinutes(toMinutes(it.Departure));
    const arrival = toMinutes(it.Arrival) === null ? null : formatMinutes(toMinutes(it.Arrival));
    const via = clean(it.Via);
    const names = TRAIN_NAME_FIELDS.map((f) => clean(it[f]));
    const types = [...new Set(names.filter(Boolean))];
    const trainTypes = types.map((name) => {
      const days = DAY_SHORT.filter((d, i) => names[i] === name);
      return { name, days, allDays: days.length === DAYS.length };
    });
    return {
      id: it.Id === undefined || it.Id === null ? null : String(it.Id),
      departure,
      arrival,
      depMins: departure === null ? null : toMinutes(departure),
      arrMins: arrival === null ? null : toMinutes(arrival),
      durationMins: durationMinutes(departure, arrival),
      via: via && via !== '-' ? via : null,
      carriages: carriageCount(it.NumberOfCarriages),
      trainTypes,
      levels: DAYS.map((d) => normalizeLevel(it[d])),
    };
  }

  const byTime = (a, b) => (a.depMins === null) - (b.depMins === null)
    || (a.depMins || 0) - (b.depMins || 0)
    || (a.arrMins === null) - (b.arrMins === null)
    || (a.arrMins || 0) - (b.arrMins || 0);

  /**
   * The raw Items[] (or a whole seats file / API response) for one weekday →
   *   {day, index, short, today, weekend, rows, counts: {green, amber, red, veryred, none, unknown},
   *    total, firstDeparture, lastDeparture, firstArrival, lastArrival}
   * Rows are sorted by departure, then arrival (rows without a departure last); each row has
   * `level`, its level on that day. `day` is anything resolveDay() takes; weekends use Monday.
   */
  function seatSummary(items, day, now) {
    const list = Array.isArray(items) ? items
      : items && Array.isArray(items.items) ? items.items
        : items && Array.isArray(items.Items) ? items.Items : [];
    const d = resolveDay(day, now);
    const rows = list.filter((x) => x && typeof x === 'object').map(normalizeSeatItem).sort(byTime);
    const counts = { green: 0, amber: 0, red: 0, veryred: 0, none: 0, unknown: 0 };
    for (const r of rows) {
      r.level = r.levels[d.index];
      counts[r.level.key] += 1;
    }
    const deps = rows.map((r) => r.depMins).filter((m) => m !== null);
    const arrs = rows.map((r) => r.arrMins).filter((m) => m !== null);
    const fmt = (arr, fn) => (arr.length ? formatMinutes(fn(...arr)) : null);
    return {
      ...d,
      rows,
      counts,
      total: rows.length,
      firstDeparture: fmt(deps, Math.min),
      lastDeparture: fmt(deps, Math.max),
      firstArrival: fmt(arrs, Math.min),
      lastArrival: fmt(arrs, Math.max),
    };
  }

  /**
   * The quieter trains near an arrival time, for the summary's day:
   * Green trains first, then Amber, each nearest to `arriveBy` first, arriving at most
   * `windowMins` (60) before it. When none arrive in that window, the Green/Amber trains arriving up
   * to `windowMins` after it (after: true).
   *   → {target: "09:00", targetMins, from: "08:00", windowMins, picks: [row…], after: bool,
   *      latest: the last train arriving by the time (any level) or null}
   */
  function quieterTrains(summary, arriveBy, opts) {
    const { limit = 3, windowMins = QUIET_WINDOW_MINS } = opts || {};
    const rows = summary && Array.isArray(summary.rows) ? summary.rows : [];
    let target = toMinutes(arriveBy);
    if (target === null) target = toMinutes(DEFAULT_ARRIVE_BY);
    const timed = rows.filter((r) => r.arrMins !== null && r.level);
    const quiet = timed.filter((r) => r.level.key === 'green' || r.level.key === 'amber');
    const rank = (r) => (r.level.key === 'green' ? 0 : 1);
    const gap = (r) => Math.abs(target - r.arrMins);
    let pool = quiet.filter((r) => r.arrMins <= target && r.arrMins >= target - windowMins);
    let after = false;
    if (!pool.length) {
      pool = quiet.filter((r) => r.arrMins > target && r.arrMins <= target + windowMins);
      after = pool.length > 0;
    }
    pool.sort((a, b) => rank(a) - rank(b) || gap(a) - gap(b) || (a.depMins || 0) - (b.depMins || 0));
    const byArrival = timed.filter((r) => r.arrMins <= target).sort((a, b) => b.arrMins - a.arrMins || b.depMins - a.depMins);
    return {
      target: formatMinutes(target),
      targetMins: target,
      from: formatMinutes(target - windowMins),
      windowMins,
      picks: pool.slice(0, Math.max(0, limit)),
      after,
      latest: byArrival[0] || null,
    };
  }

  /**
   * The rows the table shows: those arriving from 60 minutes before the chosen time to 15 minutes
   * after it; all rows with showAll, or when that window is empty. → {rows, all: bool, from, to}
   */
  function visibleRows(summary, arriveBy, showAll) {
    const rows = summary && Array.isArray(summary.rows) ? summary.rows : [];
    let target = toMinutes(arriveBy);
    if (target === null) target = toMinutes(DEFAULT_ARRIVE_BY);
    const from = target - TABLE_BEFORE_MINS;
    const to = target + TABLE_AFTER_MINS;
    const near = rows.filter((r) => r.arrMins !== null && r.arrMins >= from && r.arrMins <= to);
    if (showAll || !near.length || near.length === rows.length) return { rows, all: true, from: formatMinutes(from), to: formatMinutes(to) };
    return { rows: near, all: false, from: formatMinutes(from), to: formatMinutes(to) };
  }

  /**
   * A parsed data/swr/seats/{CRS}.json → {fetchedAt, crs, from, to, items} or null when it isn't
   * usable (missing, not an object, no items array). Also accepts a raw API response ({Items}).
   */
  function normalizeSeatFile(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return null;
    const items = Array.isArray(file.items) ? file.items : Array.isArray(file.Items) ? file.Items : null;
    if (!items) return null;
    return {
      fetchedAt: file.fetchedAt || null,
      crs: clean(file.crs).toUpperCase() || null,
      from: clean(file.from) || null,
      to: clean(file.to) || 'London Waterloo',
      items,
    };
  }

  /** Is `crs` listed in data/swr/seats/index.json? → true, false, or null when the index isn't usable. */
  function indexHasStation(index, crs) {
    if (!index || typeof index !== 'object' || !Array.isArray(index.stations)) return null;
    const c = clean(crs).toUpperCase();
    return index.stations.some((s) => s && clean(s.crs).toUpperCase() === c);
  }

  /** → {date: Date|null, days: number|null, stale: bool}. Stale when older than 15 days or unreadable. */
  function seatsAge(fetchedAt, now) {
    const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(fetchedAt);
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    if (!fetchedAt || Number.isNaN(t)) return { date: null, days: null, stale: true };
    const days = Math.max(0, Math.floor((n - t) / 86400000));
    return { date: new Date(t), days, stale: days > STALE_DAYS };
  }

  // ---------------------------------------------------------------------------
  // Rendering (pure: HTML strings; every API string goes through esc)
  // ---------------------------------------------------------------------------

  function fmtDate(date) {
    return date.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtAgeDays(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many || one + 's'}`; }

  function pipsHtml(level) {
    return level.pips
      ? `<span class="pips" aria-hidden="true">${[1, 2, 3, 4].map((i) => `<span class="pip${i <= level.pips ? ' on' : ''}"></span>`).join('')}</span>`
      : '<span class="swr-seat-nopips" aria-hidden="true">–</span>';
  }

  /** A level with SWR's full wording: pips + text (the key and the quieter picks). */
  function levelChip(level, esc) {
    return `<span class="swr-seat-lv level level-${esc(level.css)}">${pipsHtml(level)}<span class="swr-seat-lv-text">${esc(level.label)}</span></span>`;
  }

  /**
   * One day's cell in the table: tinted by level, with pips and a short label. The day's name shows
   * inside the chip on narrow screens (where the header row is hidden); screen readers get
   * "Monday: Seats available".
   */
  function dayChip(level, dayIndex, esc) {
    return `<span class="swr-seat-chip level level-${esc(level.css)}" title="${esc(DAYS[dayIndex])}: ${esc(level.label)}">`
      + `<span class="swr-seat-chip-top" aria-hidden="true"><span class="swr-seat-dname">${DAY_SHORT[dayIndex]}</span>${pipsHtml(level)}</span>`
      + (level.tiny // a shorter label for the narrow layout's chips
        ? `<span class="swr-seat-chip-text" aria-hidden="true"><span class="swr-seat-long">${esc(level.short)}</span><span class="swr-seat-tiny">${esc(level.tiny)}</span></span>`
        : `<span class="swr-seat-chip-text" aria-hidden="true">${esc(level.short)}</span>`)
      + `<span class="visually-hidden">${esc(DAYS[dayIndex])}: ${esc(level.label)}</span></span>`;
  }

  function legendHtml(esc) {
    return `<ul class="swr-seat-legend" aria-label="Key">${LEGEND_ORDER.map((k) => `<li>${levelChip(LEVELS[k], esc)}</li>`).join('')}</ul>`;
  }

  /** "36 min · 8 coaches · Arterio (Mon, Tue)" pieces for a row. */
  function rowMeta(row) {
    const bits = [];
    if (row.durationMins !== null) bits.push(`${row.durationMins} min`);
    if (row.carriages !== null) bits.push(plural(row.carriages, 'coach', 'coaches'));
    else bits.push('coaches unknown');
    for (const t of row.trainTypes) bits.push(t.allDays ? t.name : `${t.name} (${t.days.join(', ')})`);
    if (row.via) bits.push(`via ${row.via}`);
    return bits;
  }

  function trainLabel(row) {
    return `${row.departure || '—'} → ${row.arrival || '—'}`;
  }

  function hintHtml(summary, quiet, esc) {
    const dayText = summary.day;
    const pickItems = quiet.picks.map((r) => {
      const early = quiet.targetMins - r.arrMins;
      const when = early > 0 ? `arrives ${r.arrival}, ${early} min before ${quiet.target}` : early === 0 ? `arrives ${r.arrival}` : `arrives ${r.arrival}, ${-early} min after ${quiet.target}`;
      return `<li><span class="swr-seat-hint-train"><strong>${esc(r.departure || '—')}</strong> <span class="muted">${esc(when)}${r.carriages !== null ? ` · ${esc(plural(r.carriages, 'coach', 'coaches'))}` : ''}</span></span>${levelChip(r.level, esc)}</li>`;
    }).join('');
    let head;
    let body = '';
    if (quiet.picks.length && !quiet.after) {
      head = `Quieter trains arriving by ${esc(quiet.target)} on ${esc(dayText)}`;
      body = `<ol class="swr-seat-picks">${pickItems}</ol>`;
    } else if (quiet.picks.length) {
      head = `No train that usually has seats arrives between ${esc(quiet.from)} and ${esc(quiet.target)} on ${esc(dayText)}. The nearest after that:`;
      body = `<ol class="swr-seat-picks">${pickItems}</ol>`;
    } else {
      head = `No train that usually has seats arrives within an hour of ${esc(quiet.target)} on ${esc(dayText)}.`;
      if (summary.firstArrival && summary.lastArrival) body = `<p class="muted small">SWR's guide for this station covers trains arriving ${esc(summary.firstArrival)}–${esc(summary.lastArrival)}.</p>`;
    }
    const latest = quiet.latest;
    const latestNote = latest && latest.level.rank >= 3 && !quiet.picks.includes(latest)
      ? `<p class="swr-seat-latest small">The last train that gets you there by ${esc(quiet.target)}, the ${esc(latest.departure || '—')} (arrives ${esc(latest.arrival)}), is usually ${esc(latest.level.label.toLowerCase())} on ${esc(dayText)}s.</p>`
      : '';
    return `<div class="swr-seat-hint card" role="status" aria-live="polite"><p class="swr-seat-hint-head">${head}</p>${body}${latestNote}</div>`;
  }

  function tableHtml(summary, shown, picks, esc) {
    const pickSet = new Set(picks);
    const head = DAYS.map((d, i) => {
      const on = i === summary.index;
      const mark = on ? (summary.today ? '<span class="swr-seat-today">today</span>' : '<span class="visually-hidden"> (selected)</span>') : '';
      return `<th scope="col" class="swr-seat-dayh${on ? ' is-day' : ''}"><abbr title="${d}">${DAY_SHORT[i]}</abbr>${mark}</th>`;
    }).join('');
    const body = shown.rows.map((r) => {
      const meta = rowMeta(r);
      const pick = pickSet.has(r) ? '<span class="swr-seat-tag">Quieter pick</span>' : '';
      const cells = r.levels.map((lv, i) => `<td class="swr-seat-day${i === summary.index ? ' is-day' : ''}">${dayChip(lv, i, esc)}</td>`).join('');
      return `<tr class="${pickSet.has(r) ? 'is-pick' : ''}"><th scope="row" class="swr-seat-train"><span class="swr-seat-times">${esc(trainLabel(r))}</span>${pick}<span class="swr-seat-meta">${esc(meta.join(' · '))}</span></th>${cells}</tr>`;
    }).join('');
    return `<table class="swr-seat-table">
      <caption class="visually-hidden">How busy each morning train to London Waterloo usually is, Monday to Friday</caption>
      <thead><tr><th scope="col" class="swr-seat-trainh">Departs → arrives</th>${head}</tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  /**
   * The part of the section that changes with the chosen day and arrival time:
   * the quieter-trains hint, the key and the table.
   * view: {summary, arriveBy, showAll}
   */
  function renderBody(view, escFn) {
    const esc = escFn || escHtml;
    const { summary } = view;
    const arriveBy = parseArriveBy(view.arriveBy) || DEFAULT_ARRIVE_BY;
    if (!summary.rows.length) return '<p class="muted small">SWR\'s guide lists no morning trains from here.</p>';
    const quiet = quieterTrains(summary, arriveBy);
    const shown = visibleRows(summary, arriveBy, view.showAll);
    const weekendNote = summary.weekend ? `<p class="muted small swr-seat-weekend">It's the weekend, so Monday is highlighted.</p>` : '';
    const range = shown.all
      ? `All ${plural(summary.total, 'train')} in SWR's guide, departing ${esc(summary.firstDeparture || '—')}–${esc(summary.lastDeparture || '—')}.`
      : `${esc(shown.rows.length)} of ${esc(summary.total)} trains: those arriving ${esc(shown.from)}–${esc(shown.to)}.`;
    const canToggle = view.showAll || !shown.all;
    const toggle = canToggle
      ? ` <button type="button" class="link swr-seat-all" aria-pressed="${view.showAll ? 'true' : 'false'}">${view.showAll ? `Show only trains near ${esc(arriveBy)}` : `Show all ${esc(summary.total)} trains`}</button>`
      : '';
    return `${hintHtml(summary, quiet, esc)}
      ${weekendNote}
      ${legendHtml(esc)}
      <p class="muted small swr-seat-range">${range}${toggle}</p>
      ${tableHtml(summary, shown, quiet.picks, esc)}`;
  }

  function controlsHtml(summary, arriveBy, now, esc) {
    const today = resolveDay(null, now);
    const options = DAYS.map((d, i) => `<option value="${d}"${i === summary.index ? ' selected' : ''}>${d}${!today.weekend && i === today.index ? ' (today)' : ''}</option>`).join('');
    return `<div class="swr-seat-controls">
      <label class="swr-seat-field"><span>Day</span><select class="swr-seat-daysel">${options}</select></label>
      <label class="swr-seat-field"><span>Arrive at Waterloo by</span><input type="time" class="swr-seat-arrive" value="${esc(arriveBy)}" step="300" required></label>
    </div>`;
  }

  function aboutHtml(ageText, esc) {
    return `<details class="swr-about swr-seat-about"><summary>About this data</summary><ul>
      <li><strong>Source:</strong> South Western Railway's own guide to how busy its trains usually are, from its <a href="${SWR_PAGE}" target="_blank" rel="noopener noreferrer">“How busy is my train?”</a> page (<code>/api/seatavailability/{station}/London Waterloo</code> on southwesternrailway.com). SWR describes it as a “train capacity checker to show how busy your train is likely to be on a typical weekday morning, travelling to London Waterloo”, showing “the expected number of carriages on your train and whether there are seats available, some seats or standing room only”.</li>
      <li><strong>What the levels mean</strong> is SWR's wording from that page: Green “Seats available”, Amber “Some seats available”, Red “Standing room only”, and a fourth level, “Full to capacity”. A day with no level is SWR's “No Service”. The pips and the short labels on each day are this dashboard's.</li>
      <li><strong>It's typical, not live.</strong> SWR bases it on “averages of how busy your train has been” over a few recent weeks (on 28 September 2026 its page said 23 April to 8 May) and updates it from time to time. It covers weekday mornings only, trains arriving at London Waterloo before 10:00, and only trains <em>into</em> Waterloo.</li>
      <li><strong>Weekly snapshot:</strong> the API is unofficial and undocumented, and browsers can't call it, so this site copies it once a week. This copy was ${ageText}. It may change or stop without notice.</li>
      <li>The journey time is worked out from the departure and arrival times. “Quieter picks” are this dashboard's suggestion: trains usually marked “Seats available”, then “Some seats available”, arriving within an hour before the time you choose (remembered in this browser).</li>
    </ul></details>`;
  }

  /**
   * Inner HTML of <section id="swr-seats"> for a station with a seats file.
   * view: {station, file (normalizeSeatFile), summary, arriveBy, showAll}, now → HTML.
   */
  function renderSeats(view, now, escFn) {
    const esc = escFn || escHtml;
    const nowDate = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const { station, file, summary } = view;
    const arriveBy = parseArriveBy(view.arriveBy) || DEFAULT_ARRIVE_BY;
    const age = seatsAge(file && file.fetchedAt, nowDate);
    const asOf = age.date ? `as of ${fmtDate(age.date)} (${fmtAgeDays(age.days)})` : 'time unknown';
    const name = (station && station.name) || (file && file.from) || '';
    const stale = age.stale
      ? `<p class="swr-seat-stale small"><span class="status status-warning"><span class="status-icon" aria-hidden="true">!</span>May be out of date</span> <span class="muted">This copy of SWR's guide is meant to be refreshed weekly.</span></p>`
      : '';
    return `<h2 id="swr-seats-title" class="section-title">How busy are morning trains to Waterloo?</h2>
      <p class="section-sub muted">Typical weekday mornings from ${esc(name)} to London Waterloo, from SWR's own guide. Snapshot ${esc(asOf)}.</p>
      ${stale}
      ${controlsHtml(summary, arriveBy, nowDate, esc)}
      <div class="swr-seat-body">${renderBody({ summary, arriveBy, showAll: view.showAll }, esc)}</div>
      ${aboutHtml(esc(age.date ? `taken ${fmtDate(age.date)} (${fmtAgeDays(age.days)})` : 'taken at an unknown time'), esc)}`;
  }

  /** At London Waterloo: what the section covers. */
  function renderWaterloo() {
    return `<h2 id="swr-seats-title" class="section-title">How busy are morning trains to Waterloo?</h2>
      <p class="swr-seat-note">SWR's guide to how busy its trains usually are covers weekday morning trains <em>into</em> London Waterloo, from about 170 of its stations. Choose the station you're travelling from to see how busy each of its morning trains to Waterloo usually is.</p>`;
  }

  /** Snapshots aren't published here at all (opened from disk, or before S7). */
  function renderUnavailable(station, escFn) {
    const esc = escFn || escHtml;
    return `<h2 id="swr-seats-title" class="section-title">How busy are morning trains to Waterloo?</h2>
      <p class="muted small swr-seat-note">SWR's typical busyness for morning trains from ${esc((station && station.name) || 'here')} to London Waterloo isn't available here. It comes from a weekly snapshot of SWR's website that this site publishes, which is missing when the page is opened from disk or before snapshots are set up.</p>`;
  }

  // ---------------------------------------------------------------------------
  // Demo fixtures: synthetic data/swr/seats/{CRS}.json in the S7 format, with Items shaped like
  // GET https://www.southwesternrailway.com/api/seatavailability/Woking/London%20Waterloo?skip=0&take=100
  // (captured 2026-09-27). Deterministic: the same station always gets the same trains.
  // ---------------------------------------------------------------------------

  // [SWR's name, first departure, last departure, [fast, slow] journey minutes, typical gap, busyness, share of Arterio trains]
  const DEMO_STATIONS = {
    WOK: ['Woking', '06:28', '09:28', [24, 50], 4, 1.0, 0.1],
    SUR: ['Surbiton', '06:31', '09:40', [17, 31], 5, 1.05, 0.4],
    GLD: ['Guildford', '06:02', '09:12', [36, 62], 7, 0.9, 0.05],
    WIM: ['Wimbledon', '06:40', '09:48', [10, 19], 4, 1.1, 0.35],
    CLJ: ['Clapham Junction', '06:45', '09:50', [6, 10], 3, 1.0, 0.35],
    RMD: ['Richmond', '06:35', '09:40', [16, 24], 6, 0.95, 0.5],
    VXH: ['Vauxhall', '06:50', '09:52', [3, 5], 4, 0.8, 0.35],
  };
  const DEMO_DAY_FACTOR = [0.86, 1.0, 1.02, 0.97, 0.7];

  function demoRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** SWR's JourneyDuration style: a 12-hour clock time ("12:34:00 AM" for 34 minutes). */
  function demoJourneyDuration(mins) {
    const h = Math.floor(mins / 60);
    return `${h === 0 ? 12 : h}:${String(mins % 60).padStart(2, '0')}:00 AM`;
  }

  /** Synthetic raw Items[] for a demo station, or null for a station without demo data. */
  function demoSeatItems(crs) {
    const spec = DEMO_STATIONS[clean(crs).toUpperCase()];
    if (!spec) return null;
    const [name, first, last, [fast, slow], gap, busy, arterioShare] = spec;
    const rand = demoRandom([...crs.toUpperCase()].reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
    const items = [];
    let dep = toMinutes(first);
    const end = toMinutes(last);
    let id = 10 + Math.floor(rand() * 20);
    while (dep <= end) {
      const slowTrain = rand() < 0.25;
      const mins = slowTrain ? slow + Math.floor(rand() * 4) : fast + Math.floor(rand() * 4);
      const arr = dep + mins;
      const arterio = rand() < arterioShare;
      const carriages = arterio ? 10 : [5, 8, 8, 10, 12, 12][Math.floor(rand() * 6)];
      // Busiest arriving 08:05–08:50, quieter either side, fuller on short trains and fast trains.
      const peak = Math.max(0, 1 - Math.abs(arr - 8 * 60 - 28) / 70);
      const base = busy * (0.2 + 0.75 * peak) * Math.sqrt(10 / carriages) * (slowTrain ? 0.8 : 1.05) + (rand() - 0.5) * 0.2;
      const item = {
        Id: id,
        StationFrom: name,
        StationTo: 'London Waterloo',
        Departure: formatMinutes(dep),
        Arrival: formatMinutes(arr),
        JourneyDuration: demoJourneyDuration(Math.max(1, mins - 2)),
        Via: '-',
        NumberOfCarriages: carriages,
      };
      DAYS.forEach((d, i) => {
        const score = base * DEMO_DAY_FACTOR[i];
        item[d] = score < 0.5 ? 'Green' : score < 0.68 ? 'Amber' : score < 0.86 ? 'Red' : 'VeryRed';
      });
      TRAIN_NAME_FIELDS.forEach((f) => { item[f] = arterio ? 'Arterio' : ''; });
      if (arr < 10 * 60) items.push(item); // SWR's guide covers trains arriving before 10:00
      id += 20 + Math.floor(rand() * 60);
      dep += Math.max(1, gap - 2 + Math.floor(rand() * 5));
    }
    return items;
  }

  /** The Monday 05:17 UTC before `now`, when S7's weekly run would have fetched the files. */
  function demoFetchedAt(now) {
    const n = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 5, 17));
    while (d.getUTCDay() !== 1 || d.getTime() > n.getTime()) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString();
  }

  /** A demo data/swr/seats/{CRS}.json, or null. */
  function demoSeatFile(crs, now) {
    const items = demoSeatItems(crs);
    if (!items) return null;
    const c = clean(crs).toUpperCase();
    return { fetchedAt: demoFetchedAt(now), crs: c, from: DEMO_STATIONS[c][0], to: 'London Waterloo', items };
  }

  /** The demo data/swr/seats/index.json. */
  function demoSeatIndex(now) {
    return { fetchedAt: demoFetchedAt(now), stations: Object.entries(DEMO_STATIONS).map(([crs, s]) => ({ crs, seatName: s[0] })) };
  }

  /** SwrApi.demoRoutes entry: answers data/swr/seats/index.json and data/swr/seats/{CRS}.json. */
  function demoRoute(url) {
    const u = String(url || '');
    if (/(^|\/)data\/swr\/seats\/index\.json(?:[?#]|$)/.test(u)) return demoSeatIndex();
    const m = /(^|\/)data\/swr\/seats\/([A-Za-z]{3})\.json(?:[?#]|$)/.exec(u);
    if (m) return demoSeatFile(m[2]);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Page module (browser only)
  // ---------------------------------------------------------------------------

  const store = {
    get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? root.localStorage.removeItem(k) : root.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  const ctl = {
    ctx: null,
    station: null,
    file: null, // normalised seats file for ctl.station
    kind: null, // what's rendered: 'seats' | 'waterloo' | 'unavailable' | null (hidden)
    renderedKey: null, // crs|fetchedAt|weekday of the last full render, so a refresh with nothing new keeps focus
    dayChoice: null, // a day the viewer picked; null follows today
    showAll: false,
    seq: 0,
    wired: false,
  };

  function section() {
    return root.document ? root.document.getElementById('swr-seats') : null;
  }

  function arriveBy() {
    return parseArriveBy(store.get(STORE_ARRIVE_BY)) || DEFAULT_ARRIVE_BY;
  }

  function esc() {
    return (ctl.ctx && ctl.ctx.esc) || escHtml;
  }

  function currentSummary() {
    return seatSummary(ctl.file.items, ctl.dayChoice, new Date());
  }

  function hide() {
    const el = section();
    if (el) { el.hidden = true; el.innerHTML = ''; }
    ctl.kind = null;
    ctl.renderedKey = null;
  }

  function show(html, kind) {
    const el = section();
    if (!el) return;
    const aboutOpen = !!el.querySelector('details.swr-seat-about[open]');
    el.innerHTML = html;
    if (!el.hasAttribute('aria-labelledby')) el.setAttribute('aria-labelledby', 'swr-seats-title');
    if (aboutOpen) {
      const a = el.querySelector('details.swr-seat-about');
      if (a) a.open = true;
    }
    el.hidden = false;
    ctl.kind = kind;
  }

  /** Re-render only the hint, key and table (the controls keep focus). */
  function renderBodyOnly() {
    const el = section();
    const body = el && el.querySelector('.swr-seat-body');
    if (!body || !ctl.file) return;
    const focusedAll = root.document.activeElement && root.document.activeElement.classList.contains('swr-seat-all');
    body.innerHTML = renderBody({ summary: currentSummary(), arriveBy: arriveBy(), showAll: ctl.showAll }, esc());
    if (focusedAll) {
      const b = body.querySelector('.swr-seat-all');
      if (b) b.focus();
    }
  }

  function renderFull() {
    const summary = currentSummary();
    const key = [ctl.station.crs, ctl.file.fetchedAt, summary.day, summary.today].join('|');
    if (ctl.kind === 'seats' && key === ctl.renderedKey) return; // nothing new: leave the page (and focus) alone
    const el = section();
    const active = root.document.activeElement;
    const focusClass = active && el && el.contains(active) ? ['swr-seat-daysel', 'swr-seat-arrive', 'swr-seat-all'].find((c) => active.classList.contains(c)) : null;
    show(renderSeats({ station: ctl.station, file: ctl.file, summary, arriveBy: arriveBy(), showAll: ctl.showAll }, new Date(), esc()), 'seats');
    ctl.renderedKey = key;
    if (focusClass && el) {
      const again = el.querySelector('.' + focusClass);
      if (again) again.focus();
    }
  }

  function wire() {
    const el = section();
    if (!el || ctl.wired) return;
    ctl.wired = true;
    const onTime = (e) => {
      if (!e.target.classList || !e.target.classList.contains('swr-seat-arrive')) return;
      const value = parseArriveBy(e.target.value);
      if (!value) return; // incomplete or cleared: keep the last good time
      if (value === arriveBy()) return;
      store.set(STORE_ARRIVE_BY, value === DEFAULT_ARRIVE_BY ? null : value);
      renderBodyOnly();
    };
    el.addEventListener('input', onTime);
    el.addEventListener('change', (e) => {
      if (e.target.classList && e.target.classList.contains('swr-seat-daysel')) {
        const picked = resolveDay(e.target.value, new Date());
        ctl.dayChoice = picked.today ? null : picked.day;
        renderBodyOnly();
        return;
      }
      onTime(e);
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('button.swr-seat-all') : null;
      if (!b || !el.contains(b)) return;
      ctl.showAll = !ctl.showAll;
      renderBodyOnly();
    });
  }

  async function load(station, ctx) {
    const api = ctx && ctx.api;
    if (!api || typeof api.snapshot !== 'function') return;
    const seq = ++ctl.seq;
    const stale = () => (ctx && typeof ctx.isStale === 'function' && ctx.isStale()) || seq !== ctl.seq || !ctl.station || ctl.station.crs !== station.crs;
    let file = null;
    try { file = normalizeSeatFile(await api.snapshot(`seats/${station.crs}.json`)); } catch (e) { file = null; }
    if (stale()) return;
    if (file) {
      ctl.file = file;
      if (!file.items.length) { hide(); return; } // SWR lists no trains from here
      renderFull();
      return;
    }
    if (ctl.file && ctl.kind === 'seats') return; // a failed refresh keeps the last good copy
    // No file: is the station just not covered, or are the snapshots missing altogether?
    let index = null;
    try { index = await api.snapshot('seats/index.json'); } catch (e) { index = null; }
    if (stale()) return;
    if (indexHasStation(index, station.crs) === null) show(renderUnavailable(station, esc()), 'unavailable');
    else hide();
  }

  const moduleDef = {
    id: 'seats',
    onStation(station, ctx) {
      if (!station || !station.crs) return undefined;
      wire();
      ctl.ctx = ctx || ctl.ctx;
      if (!ctl.station || ctl.station.crs !== station.crs) {
        ctl.file = null;
        ctl.showAll = false;
        hide();
      }
      ctl.station = station;
      if (station.crs === WATERLOO) {
        ctl.seq += 1; // drop any load still in flight
        show(renderWaterloo(), 'waterloo');
        return undefined;
      }
      return load(station, ctx);
    },
    /** Every 60 s; SwrApi.snapshot caches for 60 s and the files change weekly, so this is cheap. */
    refresh(station, ctx) {
      if (!station || !station.crs) return undefined;
      if (!ctl.station || ctl.station.crs !== station.crs) return moduleDef.onStation(station, ctx);
      ctl.ctx = ctx || ctl.ctx;
      if (station.crs === WATERLOO) return undefined;
      return load(station, ctx);
    },
  };

  const api = {
    DAYS,
    DAY_SHORT,
    LEVELS,
    DEFAULT_ARRIVE_BY,
    STORE_ARRIVE_BY,
    QUIET_WINDOW_MINS,
    STALE_DAYS,
    SWR_PAGE,
    toMinutes,
    formatMinutes,
    durationMinutes,
    parseArriveBy,
    resolveDay,
    normalizeLevel,
    carriageCount,
    normalizeSeatItem,
    seatSummary,
    quieterTrains,
    visibleRows,
    normalizeSeatFile,
    indexHasStation,
    seatsAge,
    renderBody,
    renderSeats,
    renderWaterloo,
    renderUnavailable,
    demoSeatItems,
    demoSeatFile,
    demoSeatIndex,
    demoFetchedAt,
    demoRoute,
    module: moduleDef,
  };

  root.SwrSeats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.SwrApi && Array.isArray(window.SwrApi.demoRoutes)) window.SwrApi.demoRoutes.push(demoRoute);
  if (typeof window !== 'undefined' && window.SwrApp) window.SwrApp.register(moduleDef);
})(typeof window !== 'undefined' ? window : globalThis);
