/*
 * SWR tab, package S6: station punctuality and cancellations (item SWR-11). Renders into
 * <section id="swr-performance">.
 *
 *   Source   GET https://www.southwesternrailway.com/api/stationperformance/{name}?skip=0&take=10
 *            → {TotalResults, Items[{StationName, CRSCode, TOC, Punctal: "85.00", Cancelled: "3.90"}, …,
 *               {StationName: "Wessex route target", CRSCode: "", Punctal: "86.12", Cancelled: "3.68"}],
 *               Period: "4-Week Period from 26 July to 22 August", Next3MonthPlan, NextYearPlan, LongTermPlan}
 *   Read as  snapshot data/swr/performance.json (package S7, weekly), SwrApi.snapshot('performance.json'):
 *            {fetchedAt, period, target: {punctual, cancelled}, stations: {CRS: <raw response above>}}
 *
 * The SWR website API sends no CORS headers, so the page only ever sees S7's weekly copy. SWR's own
 * definitions (from its station performance page, checked 2026-09-28): "Punctuality is the percentage of
 * trains that arrived within 3 minutes of the scheduled time. Cancelled means the percentage of trains that
 * were scheduled to but did not call at this station. This does not include station calls removed from the
 * plan prior to 2200 the day before."
 *
 * Real quirks (2026-09-27/28): numbers arrive as strings; Clapham Junction has one row per operator (Arriva
 * London, GTR, SWR), so the SWR row is picked and the others listed; Berrylands has "0.00"/"0.00", which is
 * a blank, not a perfect record. Every API string is escaped with esc().
 *
 * Classic script; the pure helpers are also exported for Node tests.
 */
(function (root) {
  'use strict';

  const SNAPSHOT_PATH = 'performance.json';
  const STALE_DAYS = 15; // weekly snapshot: older than two runs and a day means the schedule has stopped
  const STATUS_ICONS = { good: '✓', info: 'ℹ', warning: '!' };
  const PLAN_FIELDS = [
    ['Next3MonthPlan', 'Next 3 months'],
    ['NextYearPlan', 'Next year'],
    ['LongTermPlan', 'Long term'],
  ];

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  /** "85.00", 85, " 3.9 % " → a number from 0 to 100; anything else (blank, "n/a", 120, -1) → null. */
  function parsePercent(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    const s = String(value).replace(/%/g, '').trim();
    if (!s || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }

  /** The "Wessex route target" row (no CRS code, "target" in the name). */
  function isTargetRow(item) {
    if (!item || typeof item !== 'object') return false;
    const name = clean(item.StationName);
    return /\broute target\b/i.test(name) || (!clean(item.CRSCode) && /\btarget\b/i.test(name));
  }

  const isSwrToc = (toc) => /^(swr|sw|south western railway)$/i.test(clean(toc));

  /**
   * Items[] → {row, others}: the station's SWR row (else its first row) and the other operators' rows.
   * Rows are matched on CRSCode when `crs` is given; target rows never count.
   */
  function pickStationRows(items, crs) {
    const list = Array.isArray(items) ? items.filter((i) => i && typeof i === 'object' && !isTargetRow(i)) : [];
    const want = clean(crs).toUpperCase();
    const rows = want ? list.filter((i) => clean(i.CRSCode).toUpperCase() === want) : list;
    const pool = rows.length ? rows : want ? list.filter((i) => !clean(i.CRSCode)) : [];
    if (!pool.length) return { row: null, others: [] };
    const row = pool.find((i) => isSwrToc(i.TOC)) || pool[0];
    return { row, others: pool.filter((i) => i !== row) };
  }

  /** "4-Week Period from 26 July to 22 August" → "4-week period from 26 July to 22 August"; blank → null. */
  function periodText(text) {
    const s = clean(text);
    if (!s) return null;
    return s.replace(/^(\d+)[-\s]?week\s+period\b/i, (m, n) => `${n}-week period`);
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  /**
   * One figure against the route target → {value, target, diff, verdict, cls}.
   * diff is value − target rounded to 0.1 point; verdict is 'better' | 'worse' | 'level' | null (no target
   * or no value). For cancellations lower is better.
   */
  function compareToTarget(value, target, lowerIsBetter) {
    const out = { value, target, diff: null, verdict: null, cls: 'info' };
    if (value === null || target === null) return out;
    const diff = round1(value - target);
    out.diff = diff === 0 ? 0 : diff; // no -0
    if (out.diff === 0) out.verdict = 'level';
    else out.verdict = (out.diff < 0) === Boolean(lowerIsBetter) ? 'better' : 'worse';
    out.cls = out.verdict === 'better' ? 'good' : out.verdict === 'worse' ? 'warning' : 'info';
    return out;
  }

  /**
   * One station's raw /api/stationperformance response (+ the snapshot's target, which wins over the
   * response's own "Wessex route target" row, field by field) →
   *   {hasData, reason: null | 'no-response' | 'no-row' | 'no-figures', station: {name, crs, toc},
   *    punctual: compareToTarget(), cancelled: compareToTarget(), targetSource: 'snapshot'|'row'|null,
   *    period, plans: [{label, text}], others: [{toc, punctual, cancelled}]}
   * 'no-figures' covers a row with no usable numbers, and SWR's all-zero placeholder rows (0% on time and
   * 0% cancelled can't both be true for a station with trains).
   */
  function performanceSummary(raw, target, crs) {
    const empty = (reason) => ({
      hasData: false, reason, station: null,
      punctual: compareToTarget(null, null, false), cancelled: compareToTarget(null, null, true),
      targetSource: null, period: null, plans: [], others: [],
    });
    if (!raw || typeof raw !== 'object') return empty('no-response');
    const items = Array.isArray(raw.Items) ? raw.Items : [];

    const snapT = target && typeof target === 'object' ? target : {};
    const rowT = items.find(isTargetRow) || null;
    const tp = parsePercent(snapT.punctual);
    const tc = parsePercent(snapT.cancelled);
    const targetP = tp !== null ? tp : rowT ? parsePercent(rowT.Punctal ?? rowT.Punctual) : null;
    const targetC = tc !== null ? tc : rowT ? parsePercent(rowT.Cancelled) : null;
    const targetSource = tp !== null || tc !== null ? 'snapshot' : targetP !== null || targetC !== null ? 'row' : null;

    const period = periodText(raw.Period);
    const plans = PLAN_FIELDS.map(([key, label]) => ({ label, text: clean(raw[key]) })).filter((p) => p.text);

    const { row, others } = pickStationRows(items, crs);
    if (!row) return { ...empty('no-row'), period, plans, targetSource };

    const figures = (r) => ({ punctual: parsePercent(r.Punctal ?? r.Punctual), cancelled: parsePercent(r.Cancelled) });
    const blank = (f) => (f.punctual === null && f.cancelled === null) || (f.punctual === 0 && f.cancelled === 0);
    const own = figures(row);
    const station = { name: clean(row.StationName) || null, crs: clean(row.CRSCode).toUpperCase() || null, toc: clean(row.TOC) || null };
    const otherRows = others.map((r) => ({ toc: clean(r.TOC) || 'Another operator', ...figures(r) })).filter((f) => !blank(f));

    if (blank(own)) return { ...empty('no-figures'), station, period, plans, targetSource, others: otherRows };
    return {
      hasData: true,
      reason: null,
      station,
      punctual: compareToTarget(own.punctual, targetP, false),
      cancelled: compareToTarget(own.cancelled, targetC, true),
      targetSource,
      period,
      plans,
      others: otherRows,
    };
  }

  /** performance.json → the raw response for a CRS code (keys matched case-insensitively), or null. */
  function stationEntry(snapshot, crs) {
    const stations = snapshot && snapshot.stations && typeof snapshot.stations === 'object' ? snapshot.stations : null;
    const want = clean(crs).toUpperCase();
    if (!stations || !want) return null;
    if (stations[want]) return stations[want];
    const key = Object.keys(stations).find((k) => clean(k).toUpperCase() === want);
    return key ? stations[key] : null;
  }

  /** performance.json + CRS → performanceSummary() with the snapshot's period as a fallback. */
  function summaryFromSnapshot(snapshot, crs) {
    const s = performanceSummary(stationEntry(snapshot, crs), snapshot && snapshot.target, crs);
    if (!s.period && snapshot) s.period = periodText(snapshot.period);
    return s;
  }

  /** "85.00" → "85.0%"; null → "–". */
  function fmtPercent(n) {
    return n === null || n === undefined ? '–' : `${n.toFixed(1)}%`;
  }

  /**
   * compareToTarget() → {label, sentence}, e.g. {label: 'Worse than target', sentence: '1.1 percentage points
   * below the route target of 86.1%.'}. Cancellations add "Lower is better."
   */
  function verdictWords(cmp, lowerIsBetter) {
    if (cmp.value === null) return { label: null, sentence: 'No figure for this period.' };
    if (cmp.target === null) return { label: null, sentence: 'No route target to compare with.' };
    const t = fmtPercent(cmp.target);
    const tail = lowerIsBetter ? ' Lower is better.' : '';
    if (cmp.verdict === 'level') return { label: 'On target', sentence: `Level with the route target of ${t}.${tail}` };
    const pts = Math.abs(cmp.diff).toFixed(1);
    const unit = pts === '1.0' ? 'percentage point' : 'percentage points';
    const side = cmp.diff > 0 ? 'above' : 'below';
    return {
      label: cmp.verdict === 'better' ? 'Better than target' : 'Worse than target',
      sentence: `${pts} ${unit} ${side} the route target of ${t}.${tail}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Rendering (pure: state in, HTML out; every API string escaped)
  // ---------------------------------------------------------------------------

  const DAY_MS = 86400000;

  function fmtDay(date, now) {
    const opts = { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' };
    if (date.getUTCFullYear() !== now.getUTCFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString('en-GB', opts);
  }

  /** fetchedAt → {date, days, stale}; stale when unreadable or older than STALE_DAYS. */
  function snapshotAge(fetchedAt, now) {
    const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(fetchedAt);
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    if (!fetchedAt || Number.isNaN(t)) return { date: null, days: null, stale: true };
    const days = Math.max(0, Math.floor((n - t) / DAY_MS));
    return { date: new Date(t), days, stale: days > STALE_DAYS };
  }

  function tileHtml(title, cmp, lowerIsBetter, esc) {
    const words = verdictWords(cmp, lowerIsBetter);
    const badge = words.label
      ? `<span class="status status-${cmp.cls} swr-pf-verdict"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[cmp.cls] || STATUS_ICONS.info}</span>${esc(words.label)}</span>`
      : '';
    const value = cmp.value === null
      ? '<p class="tile-empty">No figure</p>'
      : `<div class="tile-value swr-pf-value">${esc(fmtPercent(cmp.value))}</div>`;
    return `<article class="tile swr-pf-tile"><header class="tile-head"><h3>${esc(title)}</h3></header>${value}${badge}<p class="swr-pf-sentence">${esc(words.sentence)}</p></article>`;
  }

  function othersHtml(others, mainToc, esc) {
    if (!others.length) return '';
    const list = others.map((o) => `${esc(o.toc)} ${esc(fmtPercent(o.punctual))} on time, ${esc(fmtPercent(o.cancelled))} cancelled`).join('; ');
    return `<p class="muted small swr-pf-others">These figures are for ${!mainToc || isSwrToc(mainToc) ? 'SWR trains' : esc(mainToc)}. SWR also lists other operators here: ${list}.</p>`;
  }

  function plansHtml(plans, esc) {
    if (!plans.length) return '';
    return `<details class="swr-pf-plans" data-key="plans"><summary>What SWR says it's doing to improve</summary><dl>${plans
      .map((p) => `<dt>${esc(p.label)}</dt><dd>${esc(p.text)}</dd>`).join('')}</dl></details>`;
  }

  function aboutHtml(age, missing, now, esc) {
    const snap = missing
      ? 'not available here (the file is published with the site and updated weekly, so it is missing when the page is opened from disk or before snapshots are set up)'
      : age.date ? `taken on ${esc(fmtDay(age.date, now))}` : 'of unknown age';
    return `<details class="swr-pf-about" data-key="about"><summary>About this data</summary><ul>
      <li><strong>Source:</strong> South Western Railway's own station performance figures, from its website (<code>/api/stationperformance/{station}</code>, the data behind its station performance page). This is unofficial and undocumented, and browsers can't call it, so this site shows a weekly snapshot of it: ${snap}.</li>
      <li><strong>Past, not live:</strong> each figure covers one past 4-week rail period, published some weeks after it ends. It says nothing about today's trains.</li>
      <li><strong>On time</strong> is what SWR calls punctuality: "the percentage of trains that arrived within 3 minutes of the scheduled time". <strong>Cancelled</strong> is "the percentage of trains that were scheduled to but did not call at this station. This does not include station calls removed from the plan prior to 2200 the day before."</li>
      <li><strong>Route target</strong> is SWR's "Wessex route target" for the same period. Better or worse is this dashboard's comparison of the two numbers, in percentage points.</li>
      <li>Figures are for SWR trains where SWR lists more than one operator at a station. Stations SWR publishes no figures for, or only zeros, show no section.</li>
    </ul></details>`;
  }

  /**
   * state: {station, snapshot (parsed performance.json | null), loaded} →
   *   {hidden: bool, html}. Hidden until the snapshot has loaded, and when the snapshot has no figures
   *   for the station. A missing snapshot shows a short "not available here" note.
   */
  function renderPerformance(state, now, escFn) {
    const esc = escFn || escHtml;
    const nowDate = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const station = state && state.station;
    if (!station || !state.loaded) return { hidden: true, html: '' };
    const snap = state.snapshot && typeof state.snapshot === 'object' ? state.snapshot : null;
    const title = '<h2 class="section-title">Station performance</h2>';
    const age = snapshotAge(snap && snap.fetchedAt, nowDate);

    if (!snap) {
      return {
        hidden: false,
        html: `${title}<p class="muted small swr-pf-nosnap">Punctuality and cancellation figures aren't available here. They come from a weekly snapshot of SWR's website that this site publishes; it's missing when the page is opened from disk or before snapshots are set up.</p>${aboutHtml(age, true, nowDate, esc)}`,
      };
    }

    const s = summaryFromSnapshot(snap, station.crs);
    if (!s.hasData) return { hidden: true, html: '' };

    const period = s.period ? `${s.period.charAt(0).toUpperCase()}${s.period.slice(1)}` : 'A past 4-week period (dates not given)';
    const asOf = age.date ? `SWR's figures as of ${fmtDay(age.date, nowDate)}` : "SWR's figures, snapshot date unknown";
    const stale = age.stale && age.date
      ? `<p class="swr-pf-stale"><span class="status status-warning"><span class="status-icon" aria-hidden="true">!</span>May be out of date</span> <span>This weekly snapshot is ${esc(String(age.days))} days old.</span></p>`
      : '';

    const html = `${title}
      <p class="swr-pf-sub"><span class="swr-pf-past">Past period, not live</span> <span>${esc(period)}.</span></p>
      <p class="muted small swr-pf-asof">${esc(asOf)} (weekly snapshot).</p>${stale}
      <div class="swr-pf-tiles">${tileHtml('On time', s.punctual, false, esc)}${tileHtml('Cancelled', s.cancelled, true, esc)}</div>
      ${othersHtml(s.others, s.station && s.station.toc, esc)}${plansHtml(s.plans, esc)}${aboutHtml(age, false, nowDate, esc)}`;
    return { hidden: false, html };
  }

  // ---------------------------------------------------------------------------
  // Demo fixture: data/swr/performance.json in the S7 format
  // ---------------------------------------------------------------------------

  const DEMO_PERIOD = '4-Week Period from 26 July to 22 August';
  const DEMO_TARGET = { StationName: 'Wessex route target', CRSCode: '', TOC: '', Punctal: '86.12', Cancelled: '3.68' };
  const DEMO_PLANS = {
    Next3MonthPlan: 'Preparation & delivery for Autumn 2026 season and Winter planning - responsible for delivery: Mark Goodall',
    NextYearPlan: 'Increase usage of bodyworn cameras to deter antisocial behaviour - responsible for delivery: Stuart Meek',
    LongTermPlan: 'Proactive maintenance to reduce coupling equipment and door faults - responsible for delivery: Stuart Meek',
  };
  // [CRS, StationName, TOC, Punctal, Cancelled]. WAT, CLJ, SUR, WOK and BRS are real
  // (GET https://www.southwesternrailway.com/api/stationperformance/{name}?skip=0&take=10, 2026-09-27/28);
  // GLD, WIM, RMD and VXH are made up in the same range.
  const DEMO_ROWS = [
    ['WAT', 'London Waterloo', 'SWR', '82.60', '2.40'],
    ['CLJ', 'Clapham Junction', 'Arriva London', '90.40', '16.20'],
    ['CLJ', 'Clapham Junction', 'GTR', '79.80', '4.30'],
    ['CLJ', 'Clapham Junction', 'SWR', '84.60', '4.10'],
    ['SUR', 'Surbiton', 'SWR', '85.00', '3.90'],
    ['WOK', 'Woking', 'SWR', '70.80', '3.60'],
    ['BRS', 'Berrylands', 'SWR', '0.00', '0.00'],
    ['GLD', 'Guildford', 'SWR', '78.30', '4.70'],
    ['WIM', 'Wimbledon', 'SWR', '88.90', '3.20'],
    ['RMD', 'Richmond', 'SWR', '86.10', '3.70'],
    ['VXH', 'Vauxhall', 'SWR', '87.40', '2.90'],
  ];

  /** The demo performance.json, fetched "last Monday at 05:17 UTC" like S7's weekly run. */
  function demoPerformanceSnapshot(now) {
    const n = now instanceof Date ? new Date(now.getTime()) : new Date(now == null ? Date.now() : Number(now));
    const fetched = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 5, 17));
    while (fetched.getUTCDay() !== 1 || fetched > n) fetched.setUTCDate(fetched.getUTCDate() - 1);
    const items = {};
    DEMO_ROWS.forEach(([crs, StationName, TOC, Punctal, Cancelled], i) => {
      (items[crs] || (items[crs] = [])).push({ Id: i + 1, StationName, CRSCode: crs, TOC, Punctal, Cancelled });
    });
    const stations = {};
    for (const [crs, list] of Object.entries(items)) {
      const Items = [...list, { Id: 194, ...DEMO_TARGET }];
      stations[crs] = { TotalResults: Items.length, Items, Period: DEMO_PERIOD, ...DEMO_PLANS, WessexRouteData: '' };
    }
    return {
      fetchedAt: fetched.toISOString(),
      period: DEMO_PERIOD,
      target: { punctual: DEMO_TARGET.Punctal, cancelled: DEMO_TARGET.Cancelled },
      stations,
    };
  }

  /** SwrApi.demoRoutes entry: answers data/swr/performance.json. */
  function demoRoute(url) {
    return /(^|\/)data\/swr\/performance\.json(?:[?#]|$)/.test(String(url)) ? demoPerformanceSnapshot() : null;
  }

  // ---------------------------------------------------------------------------
  // Controller (browser only)
  // ---------------------------------------------------------------------------

  const ctl = { ctx: null, station: null, snapshot: null, loaded: false, seq: 0, lastHtml: null };

  function render() {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('swr-performance');
    if (!box) return;
    const esc = (ctl.ctx && ctl.ctx.esc) || escHtml;
    const { hidden, html } = renderPerformance(ctl, new Date(), esc);
    if (hidden) {
      box.hidden = true;
      box.replaceChildren();
      ctl.lastHtml = null;
      return;
    }
    if (html !== ctl.lastHtml) {
      // Keep open <details> open across re-renders (a refresh every 60 s, or the snapshot updating).
      const open = new Set([...box.querySelectorAll('details[open][data-key]')].map((d) => d.dataset.key));
      box.innerHTML = html; // every API string in it is escaped
      for (const d of box.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = true;
      ctl.lastHtml = html;
    }
    if (!box.hasAttribute('aria-label')) box.setAttribute('aria-label', 'Station punctuality and cancellations');
    box.hidden = false;
  }

  /** SwrApi.snapshot caches for 60 s and returns null on any failure (and from file:). */
  async function load(ctx) {
    const seq = ++ctl.seq;
    let snap = null;
    try { snap = ctx && ctx.api ? await ctx.api.snapshot(SNAPSHOT_PATH) : null; } catch (e) { snap = null; }
    if (seq !== ctl.seq || (ctx && typeof ctx.isStale === 'function' && ctx.isStale())) return;
    const usable = snap && typeof snap === 'object' && snap.stations && typeof snap.stations === 'object';
    if (usable || !ctl.snapshot) ctl.snapshot = usable ? snap : null; // a failed refresh keeps the last good one
    ctl.loaded = true;
    render();
  }

  function setStation(station, ctx) {
    if (ctx) ctl.ctx = ctx;
    ctl.station = station || null;
  }

  const moduleDef = {
    id: 'performance',
    /** A station was chosen: show its figures, or hide the section if the snapshot has none. */
    onStation(station, ctx) {
      setStation(station, ctx);
      render(); // the last snapshot, if any, for the new station straight away
      return load(ctx);
    },
    /** Every 60 s while the SWR tab is visible, and on "Refresh now". The file changes weekly and is cached 60 s. */
    refresh(station, ctx) {
      setStation(station, ctx);
      return load(ctx);
    },
  };

  const api = {
    SNAPSHOT_PATH,
    STALE_DAYS,
    parsePercent,
    isTargetRow,
    pickStationRows,
    periodText,
    compareToTarget,
    performanceSummary,
    stationEntry,
    summaryFromSnapshot,
    fmtPercent,
    verdictWords,
    snapshotAge,
    renderPerformance,
    demoPerformanceSnapshot,
    demoRoute,
    module: moduleDef,
  };

  root.SwrPerformance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.SwrApi && Array.isArray(window.SwrApi.demoRoutes)) window.SwrApi.demoRoutes.push(demoRoute);
  if (typeof window !== 'undefined' && window.SwrApp) window.SwrApp.register(moduleDef);
})(typeof window !== 'undefined' ? window : globalThis);
