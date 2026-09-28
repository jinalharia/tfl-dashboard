/*
 * SWR tab, package S5: planned closures in the next 14 days (item SWR-10). Renders into <section id="swr-closures">.
 *
 *   Source  National Rail's planned engineering works (nationalrail.co.uk/engineering-works/), SWR and
 *           Island Line notices, via the snapshot data/swr/closures.json that scripts/swr-closures.js
 *           builds during package S7's --status run. National Rail sends no CORS headers.
 *   Format  {format: 1, fetchedAt, source, window: {from, to}, errors, items: [{id, title, summary, from, to,
 *           kind, operators, stations, routeStations, routes, details, url, publishedAt}]}
 *           (see scripts/swr-closures.js and plan.md, "Snapshot file formats").
 *
 * For the chosen station, a notice either affects the station itself (its CRS is in `stations`: named in
 * the notice, or between the two ends of a closed stretch), affects trains to or from it (`routeStations`:
 * also named under "routes affected"), or is elsewhere on SWR (folded away at the end). That matching is
 * this dashboard's own, from station names in National Rail's text.
 *
 * `details` are paragraphs in SwrApi.htmlToText's shape ({text, parts}); they're rendered only through
 * SwrApi.renderParagraphs into empty slots. Every other string is escaped.
 *
 * Classic script; the pure helpers are also exported for Node tests.
 */
(function (root) {
  'use strict';

  const A = root.SwrApi || (typeof require === 'function' ? require('./swr-api.js') : null);

  const DAYS = 14;
  const STALE_HOURS = 12; // the snapshot refreshes about every 6 hours
  const KINDS = {
    closed: { cls: 'critical', label: 'No trains' },
    buses: { cls: 'serious', label: 'Buses replace trains' },
    amended: { cls: 'warning', label: 'Changed timetable' },
    station: { cls: 'info', label: 'Station works' },
  };
  const STATUS_ICONS = { good: '✓', info: 'ℹ', warning: '!', serious: '!!', critical: '✕' };

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------------------
  // Dates (Europe/London calendar days)
  // ---------------------------------------------------------------------------

  /** An instant → 'YYYY-MM-DD' in London. */
  function londonDate(ms) {
    const p = {};
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
    for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
    return `${p.year}-${p.month}-${p.day}`;
  }

  /** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD'. */
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  /** Whole days from ymd a to ymd b. */
  function dayDiff(a, b) {
    const t = (s) => Date.UTC(...s.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
    return Math.round((t(b) - t(a)) / 86400000);
  }

  /**
   * An item's London calendar days. Its from/to carry the London offset ("2026-10-03T00:00:00.000+01:00"),
   * so the date part is the London date. → {start, end} as 'YYYY-MM-DD', or null when unreadable.
   */
  function itemDays(item) {
    const from = clean(item && item.from);
    const to = clean(item && item.to) || from;
    const ok = (s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
    if (!ok(from)) return null;
    const start = from.slice(0, 10);
    const end = ok(to) ? to.slice(0, 10) : start;
    return { start, end: end < start ? start : end };
  }

  const dayFmt = (ymd, opts) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

  /** 'YYYY-MM-DD' → "Sat 3 Oct" (with the year when it isn't `yearOf`'s: "Tue 9 Dec 2025"). */
  function fmtDay(ymd, yearOf) {
    const withYear = yearOf && ymd.slice(0, 4) !== yearOf.slice(0, 4);
    const s = `${dayFmt(ymd, { weekday: 'short' })} ${dayFmt(ymd, { day: 'numeric', month: 'short' })}`;
    return withYear ? `${s} ${ymd.slice(0, 4)}` : s;
  }

  /** {start, end} → "Sat 3 Oct", "Sat 3 – Sun 4 Oct", "Mon 11 May – Sun 11 Oct". */
  function fmtRange(days, today) {
    if (!days) return '';
    if (days.start === days.end) return fmtDay(days.start, today);
    const sameMonth = days.start.slice(0, 7) === days.end.slice(0, 7);
    const start = sameMonth ? dayFmt(days.start, { weekday: 'short', day: 'numeric' }) : fmtDay(days.start, today);
    return `${start} – ${fmtDay(days.end, today)}`;
  }

  // ---------------------------------------------------------------------------
  // Choosing what to show
  // ---------------------------------------------------------------------------

  const codes = (list) => (Array.isArray(list) ? list.map((c) => clean(c).toUpperCase()).filter(Boolean) : []);

  /**
   * closures.json + a station → what the section shows:
   *   {today, last, groups: [{key, label, entries: [{item, days, relation}]}], elsewhere: [{item, days}], total}
   * Only items overlapping today … today + days - 1 (London) and not already over. relation is 'here'
   * (the station is in `stations`) or 'routes' (in `routeStations`). Groups: "now" for items that have
   * started, then one per start date; within a group, 'here' first, then by start and title.
   */
  function selectClosures(snapshot, crs, now, days) {
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    const today = londonDate(n);
    const last = addDays(today, (days || DAYS) - 1);
    const code = clean(crs).toUpperCase();
    const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
    const groups = new Map();
    const elsewhere = [];
    let total = 0;
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || !clean(item.title)) continue;
      const d = itemDays(item);
      if (!d || d.end < today || d.start > last) continue;
      const endMs = Date.parse(item.to);
      if (Number.isFinite(endMs) && endMs < n) continue;
      const key = clean(item.id) || clean(item.title) + d.start;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      const relation = code && codes(item.stations).includes(code) ? 'here'
        : code && codes(item.routeStations).includes(code) ? 'routes' : null;
      if (!relation) {
        elsewhere.push({ item, days: d });
        continue;
      }
      const gkey = d.start <= today ? 'now' : d.start;
      if (!groups.has(gkey)) groups.set(gkey, []);
      groups.get(gkey).push({ item, days: d, relation });
    }
    const order = (a, b) => (a.days.start < b.days.start ? -1 : a.days.start > b.days.start ? 1 : clean(a.item.title).localeCompare(clean(b.item.title)));
    const list = [...groups.entries()]
      .sort(([a], [b]) => (a === 'now' ? -1 : b === 'now' ? 1 : a < b ? -1 : 1))
      .map(([key, entries]) => ({
        key,
        label: key === 'now' ? 'Happening now' : key === addDays(today, 1) ? `Tomorrow, ${fmtDay(key, today)}` : fmtDay(key, today),
        entries: entries.sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'here' ? -1 : 1) || order(a, b)),
      }));
    elsewhere.sort(order);
    return { today, last, groups: list, elsewhere, total };
  }

  /** → {date: Date|null, hours: number|null, stale: bool}. Stale when over STALE_HOURS old or unreadable. */
  function snapshotAge(fetchedAt, now) {
    const t = Date.parse(fetchedAt);
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    if (!fetchedAt || Number.isNaN(t)) return { date: null, hours: null, stale: true };
    const hours = Math.max(0, (n - t) / 3600000);
    return { date: new Date(t), hours, stale: hours > STALE_HOURS };
  }

  // ---------------------------------------------------------------------------
  // Rendering (pure: state in, {html, blocks} out; every string escaped)
  // ---------------------------------------------------------------------------
  // The notice text never goes into the HTML string: each notice gets an empty <div data-para="i"> slot,
  // filled with SwrApi.renderParagraphs(blocks[i]) after the HTML is set.

  function pill(cls, text, esc) {
    return `<span class="status status-${cls}"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[cls] || STATUS_ICONS.info}</span>${esc(text)}</span>`;
  }

  function fmtClock(date) {
    return date.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  }

  function fmtAsOf(age, now) {
    if (!age.date) return 'time unknown';
    const day = londonDate(age.date.getTime());
    const when = day === londonDate(now.getTime()) ? `today at ${fmtClock(age.date)}` : `${fmtDay(day)} at ${fmtClock(age.date)}`;
    return `${when} (${age.hours < 1 ? 'under an hour ago' : `${Math.round(age.hours)} h ago`})`;
  }

  /** Usable paragraphs ({text, parts}) from a notice, or []. */
  function paragraphsOf(details) {
    if (!Array.isArray(details)) return [];
    return details.filter((p) => p && typeof p === 'object' && clean(p.text)).map((p) => ({
      text: String(p.text),
      parts: Array.isArray(p.parts) && p.parts.length
        ? p.parts.filter((x) => x && typeof x === 'object').map((x) => (x.href ? { text: String(x.text || ''), href: String(x.href) } : { text: String(x.text || '') }))
        : [{ text: String(p.text) }],
    }));
  }

  function entryHtml(entry, stationName, today, out) {
    const esc = out.esc;
    const { item, days, relation } = entry;
    const kind = KINDS[item.kind] || KINDS.amended;
    const range = fmtRange(days, today);
    const tag = relation === 'here' ? `Includes ${stationName}` : relation === 'routes' ? `Trains to or from ${stationName}` : '';
    const paras = paragraphsOf(item.details);
    let slot = '';
    if (paras.length) {
      out.blocks.push(paras);
      slot = `<div class="swr-cl-paras" data-para="${out.blocks.length - 1}"></div>`;
    } else if (clean(item.summary)) {
      slot = `<p>${esc(item.summary)}</p>`;
    }
    const routes = (Array.isArray(item.routes) ? item.routes : []).map(clean).filter(Boolean);
    const href = A && item.url ? A.safeHref(item.url) : null;
    const key = 'cl-' + String(clean(item.id) || clean(item.title)).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60);
    return `<li><details class="swr-cl-item swr-cl-${relation || 'other'}" data-key="${esc(key)}">
        <summary>
          <span class="swr-cl-top">${pill(kind.cls, kind.label, esc)}<span class="swr-cl-when">${esc(range)}</span>${tag ? `<span class="swr-cl-tag">${esc(tag)}</span>` : ''}</span>
          <span class="swr-cl-title">${esc(item.title)}</span>
        </summary>
        <div class="swr-cl-body">
          ${routes.length ? `<h4 class="swr-cl-more">Routes affected</h4><p>${esc(routes.join(' '))}</p>` : ''}
          ${slot ? `<h4 class="swr-cl-more">From National Rail</h4>${slot}` : ''}
          ${href ? `<p><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Full notice on National Rail</a></p>` : ''}
        </div></details></li>`;
  }

  function aboutHtml(state, age, now, esc) {
    const snap = !state.snapshot
      ? 'not available here (it is published with the site, so it is missing when the page is opened from disk or before snapshots are set up)'
      : `taken ${esc(fmtAsOf(age, now))}`;
    return `<details class="swr-cl-about"><summary>About this data</summary><ul>
      <li><strong>Source:</strong> National Rail's planned engineering works (<code>nationalrail.co.uk/engineering-works/</code>), the notices that name South Western Railway or Island Line. Browsers can't read those pages directly, so this site keeps a copy, refreshed about every 6 hours: ${snap}. It isn't live: check National Rail or SWR before you travel.</li>
      <li><strong>Which notices show:</strong> any running on a day from today to 13 days ahead. "Includes ${esc(state.station ? state.station.name : 'this station')}" means the notice names this station, or it's between the two ends of a closed stretch. "Trains to or from" it means the station is named under the notice's routes affected, or it's near a stretch where only some lines are closed. That matching is this dashboard's own, from station names in National Rail's text, so it can miss a station or include one too many; the rest are under "Elsewhere on SWR". The stations between two ends are worked out from TfL's list of the stops on each SWR route.</li>
      <li><strong>Labels</strong> (No trains, Buses replace trains, Changed timetable, Station works) come from the words in each notice's title.</li>
      <li>Notice text is shown as plain text, keeping only links to National Rail, SWR, Network Rail and TfL.</li>
    </ul></details>`;
  }

  /**
   * state: {snapshot (closures.json or null), snapshotLoaded, station: {crs, name} | null}
   * → {html, blocks}: the HTML for #swr-closures, and the paragraphs for each of its [data-para] slots.
   */
  function renderClosures(state, now, escFn) {
    const esc = escFn || escHtml;
    const out = { esc, blocks: [] };
    const nowDate = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const snap = state.snapshot && typeof state.snapshot === 'object' && Array.isArray(state.snapshot.items) ? state.snapshot : null;
    const age = snapshotAge(snap && snap.fetchedAt, nowDate);
    const station = state.station || null;
    const name = station ? clean(station.name) || clean(station.crs) : 'this station';
    let html = '<h2 class="section-title">Planned closures, next 14 days</h2>';
    if (!state.snapshotLoaded) return { html: html + '<p class="muted small">Loading planned closures…</p>', blocks: [] };
    if (!snap) {
      html += '<p class="swr-cl-note muted small">Planned closures aren\'t available here. They come from a copy of National Rail\'s engineering works notices that this site publishes; it\'s missing when the page is opened from disk or before snapshots are set up.</p>';
      return { html: html + aboutHtml({ ...state, snapshot: null }, age, nowDate, esc), blocks: [] };
    }

    const sel = selectClosures(snap, station && station.crs, nowDate);
    html += `<p class="muted small swr-cl-asof">From National Rail's engineering works notices, as of ${esc(fmtAsOf(age, nowDate))}.</p>`;
    if (age.stale) html += `<p class="swr-cl-stale">${pill('warning', 'May be out of date', esc)} <span>Notices may have changed since then.</span></p>`;
    const shown = sel.groups.reduce((n, g) => n + g.entries.length, 0);
    if (!shown) {
      html += `<p class="swr-cl-none">${pill('good', 'None found', esc)} <span>No planned closures found for ${esc(name)} or trains to and from it, from today to ${esc(fmtDay(sel.last, sel.today))}.</span></p>`;
    } else {
      html += `<p class="swr-cl-count">${esc(`${shown} ${shown === 1 ? 'notice affects' : 'notices affect'} ${name} or trains to and from it`)}</p>`;
      for (const g of sel.groups) {
        html += `<h3 class="swr-cl-day">${esc(g.label)}</h3><ul class="swr-cl-list">${g.entries.map((e) => entryHtml(e, name, sel.today, out)).join('')}</ul>`;
      }
    }
    if (sel.elsewhere.length) {
      const n = sel.elsewhere.length;
      html += `<details class="swr-cl-elsewhere" data-key="cl-elsewhere"><summary>Elsewhere on SWR: ${n} more ${n === 1 ? 'notice' : 'notices'}</summary><ul class="swr-cl-list">${sel.elsewhere.map((e) => entryHtml(e, name, sel.today, out)).join('')}</ul></details>`;
    } else if (!sel.total) {
      html += '<p class="muted small">National Rail lists no SWR engineering works in this period.</p>';
    }
    html += aboutHtml(state, age, nowDate, esc);
    return { html, blocks: out.blocks };
  }

  // ---------------------------------------------------------------------------
  // Demo fixture: the real closures.json of 2026-09-28 (notice text trimmed to 4 paragraphs), moved on by
  // whole weeks so weekend works still fall on weekends. Titles keep their original dates.
  // ---------------------------------------------------------------------------

  const DEMO_BASE = '2026-09-28';
  const DEMO_ITEMS = [
    {"id":"31pS29f8ugS43rmjQwCukv","title":"Berrylands Station Upgrade: Buses replace trains to / from Berrylands from Monday 11 May to the end of September","summary":"Engineering work is taking place at Berrylands station, closing the station from Monday 11 May to the end of September. Background information on the work can be found below.","from":"2026-05-11T00:00:00.000+01:00","to":"2026-09-30T23:59:00.000+01:00","kind":"buses","operators":["SW"],"stations":["BRS"],"routeStations":["BRS"],"routes":["All South Western Railway services to / from / via Berrylands"],"details":[{"text":"Engineering work is taking place at Berrylands station, closing the station from Monday 11 May to the end of September. Background information on the work can be found below.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place at Berrylands station, closing the station from Monday 11 May to the end of September. Background information on the work can be found below."}]},{"text":"As a result, no trains will call at Berrylands station. Trains will still be able to run through the station without stopping.","parts":[{"text":"As a result, no trains will call at Berrylands station. Trains will still be able to run through the station without stopping."}]},{"text":"Replacement buses will run between:","parts":[{"text":"Replacement buses will run between:"}]},{"text":"• New Malden and Berrylands","parts":[{"text":"• New Malden and Berrylands"}]}],"url":"https://www.nationalrail.co.uk/engineering-works/berrylands-station-closure-20260511/","publishedAt":"2026-05-11T13:46:49.386Z"},
    {"id":"41fANX9WN8NmT9U5acexli","title":"Station improvement work for step-free access: amended services to / from Wandsworth Town from Monday 11 May to Sunday 11 October","summary":"Engineering work is taking place at Wandsworth Town, closing some platforms at the station. Background information on the work taking place can be found below.","from":"2026-05-11T00:00:00.000+01:00","to":"2026-10-11T23:59:00.000+01:00","kind":"station","operators":["SW"],"stations":["WNT"],"routeStations":["WNT"],"routes":["All South Western Railway services to / from Wandsworth Town"],"details":[{"text":"Engineering work is taking place at Wandsworth Town, closing some platforms at the station. Background information on the work taking place can be found below.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place at Wandsworth Town, closing some platforms at the station. Background information on the work taking place can be found below."}]},{"text":"Monday 11 May to Sunday 26 July:","parts":[{"text":"Monday 11 May to Sunday 26 July:"}]},{"text":"Platform 2 at Wandsworth Town is closed. Trains will call at platform 1 during this period.","parts":[{"text":"Platform 2 at Wandsworth Town is closed. Trains will call at platform 1 during this period."}]},{"text":"Monday – Thursday between 11:00 – 14:00:","parts":[{"text":"Monday – Thursday between 11:00 – 14:00:"}]}],"url":"https://www.nationalrail.co.uk/engineering-works/wandsworth-town-20260511/","publishedAt":"2026-09-22T08:30:39.981Z"},
    {"id":"2gFrz8KNjCUURJjTGO09oI","title":"Amended train service between London Waterloo and Exeter St Davids from Monday 10 August until further notice","summary":"The prolonged hot weather has dried out the soil between Salisbury and Exeter St Davids, changing the stability of our tracks and requiring trains to run at reduced speeds. From Monday 10 August, train services between London Waterloo and Exeter St Davids will run to a temporary timetable, as follows:","from":"2026-08-10T00:00:00.000+01:00","to":"2026-10-09T23:59:00.000+01:00","kind":"amended","operators":["SW"],"stations":["WAT","EXD"],"routeStations":["WAT","EXD","SAL","YVJ"],"routes":["Between London Waterloo and Salisbury / Yeovil Junction / Exeter St Davids"],"details":[{"text":"The prolonged hot weather has dried out the soil between Salisbury and Exeter St Davids, changing the stability of our tracks and requiring trains to run at reduced speeds. From Monday 10 August, train services between London Waterloo and Exeter St Davids will run to a temporary timetable, as follows:","parts":[{"text":"The prolonged hot weather has dried out the soil between Salisbury and Exeter St Davids, changing the stability of our tracks and requiring trains to run at reduced speeds. From Monday 10 August, train services between London Waterloo and Exeter St Davids will run to a temporary timetable, as follows:"}]},{"text":"• Services between London Waterloo and Salisbury will continue to run every 30 minutes, with no changes","parts":[{"text":"• Services between London Waterloo and Salisbury will continue to run every 30 minutes, with no changes"}]},{"text":"• One train per hour will run between London Waterloo and Yeovil Junction","parts":[{"text":"• One train per hour will run between London Waterloo and Yeovil Junction"}]},{"text":"• Most journeys from London Waterloo to Yeovil Junction will take 3 minutes longer than usual, with journeys from Yeovil Junction to London Waterloo taking 13 minutes longer than usual","parts":[{"text":"• Most journeys from London Waterloo to Yeovil Junction will take 3 minutes longer than usual, with journeys from Yeovil Junction to London Waterloo taking 13 minutes longer than usual"}]}],"url":"https://www.nationalrail.co.uk/engineering-works/exd-10-aug-20260810/","publishedAt":"2026-09-25T11:35:55.572Z"},
    {"id":"qjKDAB7YwQLCQZa7UMEDI","title":"Buses replace trains between Hounslow and Windsor & Eton Riverside / Virginia Water on Saturday 3 and Sunday 4 October","summary":"Engineering work is taking place between Hounslow and Ascot, closing various lines.","from":"2026-10-03T00:00:00.000+01:00","to":"2026-10-04T23:59:00.000+01:00","kind":"buses","operators":["SW"],"stations":["HOU","WNR","VIR","WTN","FEL","AFS","SNS","WRY","SNY","DAT","EGH"],"routeStations":["HOU","WNR","VIR","WTN","FEL","AFS","SNS","WRY","SNY","DAT","EGH","ACT","LNG","SNG","WAT","WYB","WOK","RDG","RMD","TWI"],"routes":["Between London Waterloo and Staines / Windsor & Eton Riverside / Ascot / Weybridge / Woking / Reading, between Richmond / Twickenham and Windsor & Eton Riverside, and also between Staines and Windsor & Eton Riverside / Weybridge / Woking / Reading"],"details":[{"text":"Engineering work is taking place between Hounslow and Ascot, closing various lines.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place between Hounslow and Ascot, closing various lines."}]},{"text":"All weekend, trains to / from London Waterloo via Staines will run to an amended timetable. Additional services will run between London Waterloo and Hounslow via Twickenham.","parts":[{"text":"All weekend, trains to / from London Waterloo via Staines will run to an amended timetable. Additional services will run between London Waterloo and Hounslow via Twickenham."}]},{"text":"On Saturday, buses will replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside.","parts":[{"text":"On Saturday, buses will replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside."}]},{"text":"On Sunday, buses will replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside / Woking.","parts":[{"text":"On Sunday, buses will replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside / Woking."}]}],"url":"https://www.nationalrail.co.uk/engineering-works/hounslow-3-oct-20261003/","publishedAt":"2026-09-22T06:43:39.792Z"},
    {"id":"2H6kd2sSSqZc6YKseFaCez","title":"Buses replace trains between Southampton Airport Parkway / Southampton Central and stations via Brockenhurst Saturday 3 and Sunday 4 October","summary":"Engineering work is taking place between Southampton Central and Bournemouth, closing all lines.","from":"2026-10-03T00:00:00.000+01:00","to":"2026-10-04T23:59:00.000+01:00","kind":"buses","operators":["XC","SW"],"stations":["SOA","SOU","BCU","SWG","SDN","MBK","RDB","TTN","ANF","BEU","BMH","SWY","NWM","HNA","CHR","POK"],"routeStations":["SOA","SOU","BCU","SWG","SDN","MBK","RDB","TTN","ANF","BEU","BMH","SWY","NWM","HNA","CHR","POK","WAT","PMH","POO","WEY","BSK","SAL","ROM","ESL"],"routes":["CrossCountry between Manchester Piccadilly and Bournemouth South Western Railway between London Waterloo and Southampton Central / Portsmouth Harbour / Poole / Weymouth, between Basingstoke and Poole, between Salisbury and Romsey, and also between Eastleigh and Southampton Central / Portsmouth Harbour / Poole"],"details":[{"text":"Engineering work is taking place between Southampton Central and Bournemouth, closing all lines.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place between Southampton Central and Bournemouth, closing all lines."}]},{"text":"CrossCountry","parts":[{"text":"CrossCountry"}]},{"text":"No trains will run between Southampton Central and Bournemouth all weekend.","parts":[{"text":"No trains will run between Southampton Central and Bournemouth all weekend."}]},{"text":"Rail replacement buses will operate between Southampton Airport Parkway and Bournemouth.","parts":[{"text":"Rail replacement buses will operate between Southampton Airport Parkway and Bournemouth."}]}],"url":"https://www.nationalrail.co.uk/engineering-works/southampton-central-3-oct-20261003/","publishedAt":"2026-09-22T06:33:01.392Z"},
    {"id":"4Z9Yo43qSaUpiBMB3RBDHM","title":"Buses replace trains to / from Portsmouth Harbour on Saturday 3 and Sunday 4 October","summary":"Engineering work is taking place between Cosham and Portsmouth Harbour, closing some lines.","from":"2026-10-03T00:00:00.000+01:00","to":"2026-10-04T23:59:00.000+01:00","kind":"buses","operators":["GW","SW","SN"],"stations":["PMH"],"routeStations":["PMH","CSA","HLS","FTN","PMS","WAT"],"routes":["Great Western Railway between Cardiff Central / Bristol Temple Meads and Portsmouth Harbour South Western railway between London Waterloo and Portsmouth Harbour Southern between London Victoria / Horsham / Brighton / Littlehampton / Barnham and Portsmouth & Southsea / Portsmouth Harbour, between Gatwick Airport and Portsmouth Harbour, and also between Haywards Heath and Portsmouth & Southsea"],"details":[{"text":"Engineering work is taking place between Cosham and Portsmouth Harbour, closing some lines.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place between Cosham and Portsmouth Harbour, closing some lines."}]},{"text":"Great Western Railway:","parts":[{"text":"Great Western Railway:"}]},{"text":"Trains between Cardiff Central / Bristol Temple Meads / Westbury and Portsmouth Harbour will terminate / start at Fareham.","parts":[{"text":"Trains between Cardiff Central / Bristol Temple Meads / Westbury and Portsmouth Harbour will terminate / start at Fareham."}]},{"text":"Replacement buses will operate between Fareham and Portsmouth Harbour.","parts":[{"text":"Replacement buses will operate between Fareham and Portsmouth Harbour."}]}],"url":"https://www.nationalrail.co.uk/engineering-works/pmh-3-oct-20261003/","publishedAt":"2026-09-22T06:23:52.002Z"},
    {"id":"5uZ51REJJZgL8HFSsv51WY","title":"Buses replace trains between Hounslow and Virginia Water / Windsor & Eton Riverside on Saturday 10 and Sunday 11 October","summary":"Engineering work is taking place between Feltham and Virginia Water / Windsor & Eton Riverside, closing all lines.","from":"2026-10-10T00:00:00.000+01:00","to":"2026-10-11T23:59:00.000+01:00","kind":"buses","operators":["SW"],"stations":["HOU","VIR","WNR","WTN","FEL","AFS","SNS","EGH","WRY","SNY","DAT"],"routeStations":["HOU","VIR","WNR","WTN","FEL","AFS","SNS","EGH","WRY","SNY","DAT","WAT","ACT","WYB","WOK","RDG","CLJ","RMD"],"routes":["Between London Waterloo and Staines / Windsor & Eton Riverside / Ascot / Weybridge / Woking / Reading, between Clapham Junction and Windsor & Eton Riverside / Woking, between Richmond and Windsor & Eton Riverside, and also between Staines and Windsor & Eton Riverside / Weybridge / Woking / Reading"],"details":[{"text":"Engineering work is taking place between Feltham and Virginia Water / Windsor & Eton Riverside, closing all lines.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place between Feltham and Virginia Water / Windsor & Eton Riverside, closing all lines."}]},{"text":"Buses will replace trains between:","parts":[{"text":"Buses will replace trains between:"}]},{"text":"• Hounslow and Virginia Water","parts":[{"text":"• Hounslow and Virginia Water"}]},{"text":"• Hounslow and Windsor & Eton Riverside","parts":[{"text":"• Hounslow and Windsor & Eton Riverside"}]}],"url":"https://www.nationalrail.co.uk/engineering-works/hounslow-11-oct-20261010/","publishedAt":"2026-08-06T07:56:12.285Z"},
    {"id":"3REsgxPTPa50oK3j5uVqKs","title":"Buses replace trains to / from / via Guildford on Saturday 10 and Sunday 11 October","summary":"Engineering work is taking place between Wanborough and Guildford and also Woking and Haslemere, closing lines through Guildford.","from":"2026-10-10T00:00:00.000+01:00","to":"2026-10-11T23:59:00.000+01:00","kind":"buses","operators":["GW","SW"],"stations":["GLD","WAN","WOK","HSL","WPL","FNC","GOD","MLF","WTY"],"routeStations":["GLD","WAN","WOK","HSL","WPL","FNC","GOD","MLF","WTY","RDG","WAT","PMH"],"routes":["Great Western Railway between Reading and Redhill / Gatwick Airport South Western Railway between London Waterloo and Guildford / Portsmouth Harbour"],"details":[{"text":"Engineering work is taking place between Wanborough and Guildford and also Woking and Haslemere, closing lines through Guildford.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place between Wanborough and Guildford and also Woking and Haslemere, closing lines through Guildford."}]},{"text":"Great Western Railway:","parts":[{"text":"Great Western Railway:"}]},{"text":"Trains that usually run between Reading and Redhill / Gatwick Airport will be amended to run between Reading and Ash only.","parts":[{"text":"Trains that usually run between Reading and Redhill / Gatwick Airport will be amended to run between Reading and Ash only."}]},{"text":"Replacement buses will run between:","parts":[{"text":"Replacement buses will run between:"}]}],"url":"https://www.nationalrail.co.uk/engineering-works/guildford-10-oct-20261010/","publishedAt":"2026-08-28T11:08:33.429Z"},
    {"id":"0jHr1WblIGhRxG6XhzAny","title":"Buses replace trains to / from / via Salisbury on Saturday 10 and Sunday 11 October","summary":"Engineering work is taking place between Warminster and Romsey, closing all lines.","from":"2026-10-10T00:00:00.000+01:00","to":"2026-10-11T23:59:00.000+01:00","kind":"buses","operators":["GW","SW"],"stations":["SAL","WMN","ROM","DEN","DBG"],"routeStations":["SAL","WMN","ROM","DEN","DBG","WSB","PMH","WAT","FRO","YVJ","CLC"],"routes":["Great Western Railway between Cardiff Central / Bristol Temple Meads / Westbury and Portsmouth Harbour South Western Railway between Salisbury and Romsey, between London Waterloo and Frome / Yeovil Junction, and also between Castle Cary / Westbury and Salisbury"],"details":[{"text":"Engineering work is taking place between Warminster and Romsey, closing all lines.","parts":[{"text":"Engineering work","href":"https://www.nationalrail.co.uk/travel-information/engineering-works-explained/"},{"text":" is taking place between Warminster and Romsey, closing all lines."}]},{"text":"Great Western Railway:","parts":[{"text":"Great Western Railway:"}]},{"text":"Buses will replace trains between Warminster and Southampton Central via Salisbury.","parts":[{"text":"Buses will replace trains between Warminster and Southampton Central via Salisbury."}]},{"text":"The first and last buses of the day will run between Westbury and Southampton Central, calling at Dilton Marsh.","parts":[{"text":"The first and last buses of the day will run between Westbury and Southampton Central, calling at Dilton Marsh."}]}],"url":"https://www.nationalrail.co.uk/engineering-works/warminster-and-southampton-central-20261010/","publishedAt":"2026-09-02T08:05:44.708Z"},
  ];

  function shiftStamp(stamp, days) {
    const s = clean(stamp);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return stamp;
    return addDays(s.slice(0, 10), days) + s.slice(10);
  }

  /** The demo closures.json, moved so it reads as current. */
  function demoClosuresSnapshot(now) {
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    const shift = Math.floor(dayDiff(DEMO_BASE, londonDate(n)) / 7) * 7;
    const items = JSON.parse(JSON.stringify(DEMO_ITEMS)).map((it) => ({ ...it, from: shiftStamp(it.from, shift), to: shiftStamp(it.to, shift) }));
    const first = addDays(DEMO_BASE, shift);
    return {
      format: 1,
      fetchedAt: new Date(n - 95 * 60000).toISOString(),
      source: 'National Rail planned engineering works (nationalrail.co.uk/engineering-works/)',
      window: { from: first, to: addDays(first, DAYS - 1) },
      errors: {},
      items,
    };
  }

  /** SwrApi.demoRoutes entry: answers data/swr/closures.json. */
  function demoRoute(url) {
    return /(^|\/)data\/swr\/closures\.json(?:[?#]|$)/.test(String(url)) ? demoClosuresSnapshot() : null;
  }

  // ---------------------------------------------------------------------------
  // Controller (browser only)
  // ---------------------------------------------------------------------------

  const ctl = { ctx: null, station: null, snapshot: null, snapshotLoaded: false, seq: 0 };

  function render() {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('swr-closures');
    if (!box || !ctl.station) return;
    // Keep open <details> open across refreshes and station changes.
    const open = new Set([...box.querySelectorAll('details[open][data-key]')].map((d) => d.dataset.key));
    const aboutOpen = !!box.querySelector('details.swr-cl-about[open]');
    const esc = (ctl.ctx && ctl.ctx.esc) || escHtml;
    const { html, blocks } = renderClosures(ctl, new Date(), esc);
    box.innerHTML = html; // every string in it is escaped; notice text goes through renderParagraphs below
    for (const slot of box.querySelectorAll('[data-para]')) {
      const paras = blocks[Number(slot.dataset.para)];
      if (paras) slot.replaceChildren(A.renderParagraphs(paras));
    }
    for (const d of box.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = true;
    if (aboutOpen) {
      const a = box.querySelector('details.swr-cl-about');
      if (a) a.open = true;
    }
    box.hidden = false;
  }

  /** SwrApi.snapshot caches for 60 s and returns null on any failure (and from file:). */
  async function load(ctx) {
    const seq = ++ctl.seq;
    let snap = null;
    try { snap = ctx && ctx.api ? await ctx.api.snapshot('closures.json') : null; } catch (e) { snap = null; }
    if (seq !== ctl.seq || (ctx && typeof ctx.isStale === 'function' && ctx.isStale())) return;
    const usable = snap && typeof snap === 'object' && Array.isArray(snap.items);
    if (usable || !ctl.snapshot) ctl.snapshot = usable ? snap : null; // a failed refresh keeps the last good copy
    ctl.snapshotLoaded = true;
    render();
  }

  const moduleDef = {
    id: 'closures',
    onStation(station, ctx) {
      ctl.ctx = ctx;
      ctl.station = station;
      render();
      return load(ctx);
    },
    refresh(station, ctx) {
      ctl.ctx = ctx;
      ctl.station = station;
      return load(ctx);
    },
  };

  const api = {
    DAYS,
    STALE_HOURS,
    KINDS,
    londonDate,
    addDays,
    itemDays,
    fmtDay,
    fmtRange,
    selectClosures,
    snapshotAge,
    paragraphsOf,
    renderClosures,
    demoClosuresSnapshot,
    demoRoute,
    module: moduleDef,
  };

  root.SwrClosures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.SwrApi && Array.isArray(window.SwrApi.demoRoutes)) window.SwrApi.demoRoutes.push(demoRoute);
  if (typeof window !== 'undefined' && window.SwrApp) window.SwrApp.register(moduleDef);
})(typeof window !== 'undefined' ? window : globalThis);
