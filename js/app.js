(function () {
  'use strict';

  const T = window.TflApi;
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const REFRESH_MS = 60 * 1000;
  const SERIES_VARS = ['--series-1', '--series-2', '--series-3'];

  const QUICK_PICKS = DEMO
    ? [['940GZZLUKSX', "King's Cross"], ['940GZZLUOXC', 'Oxford Circus'], ['940GZZLUSTD', 'Stratford'], ['940GZZLUBNK', 'Bank'], ['940GZZLUWLO', 'Waterloo']]
    : [
        ['940GZZLUKSX', "King's Cross"], ['940GZZLUOXC', 'Oxford Circus'], ['940GZZLUSTD', 'Stratford'],
        ['940GZZLUBNK', 'Bank'], ['940GZZLUWLO', 'Waterloo'], ['940GZZLULNB', 'London Bridge'],
        ['940GZZLULVT', 'Liverpool Street'], ['940GZZLUVIC', 'Victoria'],
      ];

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (v) => Math.round(v * 100) + '%';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  const state = {
    client: null,
    station: null,
    profiles: new Map(), // naptan → normalized day | Error
    profileDay: null,
    live: new Map(), // naptan → normalized live | Error
    arrivals: new Map(), // naptan → raw arrivals | Error
    statuses: new Map(), // lineId → status
    statusError: null,
    loadings: new Map(), // lineId → raw train-loading response (also carries passenger flows)
    lifts: null, // [{station, lifts, message}] for this station | Error | null
    boarding: new Map(), // lineId → [{dir, to, toName, origin, prevNames, ownRows, arriveRows}]
    info: { notices: null, bikes: null, bikePlaces: null, loaded: false }, // station information section (package A)
    updatedAt: null,
    token: 0,
    timer: null,
    busy: false,
  };

  function makeClient() {
    state.client = T.createClient({
      appKey: DEMO ? null : store.get('tfl.appKey'),
      fetch: DEMO ? window.TflDemo.createFetch() : undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    const label = { light: 'Light', dark: 'Dark' }[theme] || 'Auto';
    $('#theme-toggle').textContent = `Theme: ${label}`;
  }
  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(store.get('tfl.theme') || 'auto') + 1) % order.length];
    store.set('tfl.theme', next === 'auto' ? null : next);
    applyTheme(next);
    if (state.station) renderChart();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  let searchTimer = null;
  let searchSeq = 0;
  let results = [];
  let activeIdx = -1;

  function renderResults(message) {
    const list = $('#search-results');
    const input = $('#station-search');
    list.textContent = '';
    if (message) {
      const li = document.createElement('li');
      li.className = 'result-msg';
      li.textContent = message;
      list.appendChild(li);
    }
    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.id = `result-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === activeIdx));
      li.className = 'result' + (i === activeIdx ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = r.name;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = [r.modes.map((m) => T.MODE_LABELS[m] || m).join(' · '), r.zone ? `Zone ${r.zone}` : ''].filter(Boolean).join(' — ');
      li.append(name, meta);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.appendChild(li);
    });
    const open = Boolean(message) || results.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    input.setAttribute('aria-activedescendant', activeIdx >= 0 ? `result-${activeIdx}` : '');
  }

  function closeResults() {
    results = [];
    activeIdx = -1;
    renderResults();
  }

  function choose(i) {
    const r = results[i];
    if (!r) return;
    $('#station-search').value = r.name;
    closeResults();
    loadStation(r.id);
  }

  function onSearchInput() {
    const q = $('#station-search').value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) return closeResults();
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const found = await state.client.searchStations(q);
        if (seq !== searchSeq) return;
        results = found;
        activeIdx = found.length ? 0 : -1;
        renderResults(found.length ? null : 'No Underground, Elizabeth line, DLR, Overground or Tram stations match');
      } catch (e) {
        if (seq !== searchSeq) return;
        results = [];
        renderResults(e.message);
      }
    }, 300);
  }

  function onSearchKey(e) {
    if (e.key === 'ArrowDown' && results.length) { activeIdx = (activeIdx + 1) % results.length; renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && results.length) { activeIdx = (activeIdx - 1 + results.length) % results.length; renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) choose(activeIdx); }
    else if (e.key === 'Escape') closeResults();
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  const settle = (p) => p.then((v) => v, (e) => (e instanceof Error ? e : new Error(String(e))));

  async function loadStation(id) {
    const token = ++state.token;
    stopTimer();
    state.station = null;
    state.profiles.clear();
    state.live.clear();
    state.arrivals.clear();
    state.statuses = new Map();
    state.loadings.clear();
    state.lifts = null;
    state.boarding = new Map();
    state.info = { notices: null, bikes: null, bikePlaces: null, loaded: false };
    showMessage('Loading station…', 'loading');

    const url = new URL(location.href);
    url.searchParams.set('station', id);
    history.replaceState(null, '', url);

    let station;
    try {
      station = await state.client.getStation(id);
    } catch (e) {
      if (token === state.token) showMessage(`Couldn't load this station: ${e.message}`, 'error');
      return;
    }
    if (token !== state.token) return;
    if (!station.lines.length) {
      showMessage(`${station.name} isn't served by the Underground, Elizabeth line, DLR, Overground or Tram, so there's no rail crowding data for it.`, 'error');
      return;
    }
    state.station = station;
    loadClosures(station);
    document.title = `${station.name} · Live station crowding`;

    await Promise.all([loadProfiles(token), loadLive(token), loadTrainLoadings(token), showStationInfo() ? loadStationInfo(token) : null]);
    if (token !== state.token) return;
    render();
    startTimer();
  }

  async function loadProfiles(token) {
    const { day } = T.londonNow();
    const entries = await Promise.all(
      state.station.naptans.map(async (n) => [n.id, await settle(state.client.getDayCrowding(n.id, day))])
    );
    if (token !== state.token) return;
    state.profiles = new Map(entries);
    state.profileDay = day;
  }

  async function loadTrainLoadings(token) {
    const tubeLines = state.station.lines.filter((l) => l.mode === 'tube');
    const entries = await Promise.all(
      tubeLines.map(async (l) => [l.id, await settle(state.client.getTrainLoadings(l.naptan, l.id))])
    );
    if (token !== state.token) return;
    state.loadings = new Map(entries.filter(([, v]) => !(v instanceof Error)));
    await loadBoardingInputs(token, tubeLines);
  }

  // Route sequences and other stations' train loadings are static, so cache them for the session.
  const staticCache = new Map();
  function cached(key, fn) {
    if (!staticCache.has(key)) staticCache.set(key, settle(fn()));
    return staticCache.get(key);
  }

  /**
   * For each line and direction: this station's own loading rows, plus the previous station's
   * rows towards here (from the route sequence), so the boarding estimate can see how full
   * trains arrive. At a terminus in that direction the train starts here and arrives empty.
   */
  async function loadBoardingInputs(token, lines) {
    const out = new Map();
    await Promise.all(lines.map(async (line) => {
      const raw = state.loadings.get(line.id);
      if (!raw) return;
      const own = T.loadingRows(raw, line);
      if (!own.length) return;
      const route = await cached(`route:${line.id}`, () => state.client.getRouteSequence(line.id));
      if (route instanceof Error) return;
      const names = T.routeStationNames(route);
      const station = String(line.naptan).toUpperCase();
      const dirs = [...new Map(own.map((r) => [`${r.dir}|${r.to}`, r])).values()];
      const result = await Promise.all(dirs.map(async ({ dir, to }) => {
        const p = T.previousStations(route, station, to);
        const arriveRows = [];
        const prevNames = [];
        for (const prev of p.prev) {
          const prevRaw = await cached(`load:${prev}:${line.id}`, () => state.client.getTrainLoadings(prev, line.id));
          if (prevRaw instanceof Error) continue;
          const rows = T.loadingRows(prevRaw, line).filter((r) => r.to === station);
          if (rows.length) { arriveRows.push(rows); prevNames.push(names.get(prev) || prev); }
        }
        return {
          dir, to, toName: names.get(to) || to, origin: p.origin, prevNames,
          ownRows: own.filter((r) => r.dir === dir && r.to === to), arriveRows,
        };
      }));
      out.set(line.id, result.sort((a, b) => a.dir.localeCompare(b.dir)));
    }));
    if (token !== state.token) return;
    state.boarding = out;
  }

  // ---------------------------------------------------------------------------
  // Station information: facilities, disruption notices, Santander Cycles nearby
  // ---------------------------------------------------------------------------
  const BIKE_RADIUS_M = 800;
  const BIKE_LIMIT = 5;

  /** The "Station information" toggle (off by default): when off, the section is hidden and not fetched. */
  function showStationInfo() {
    return $('#show-station-info').checked;
  }

  async function onStationInfoToggle() {
    const on = showStationInfo();
    store.set('tfl.showStationInfo', on ? '1' : null);
    if (!state.station) return;
    if (!on) {
      $('#station-info').hidden = true;
      return;
    }
    const token = state.token;
    if (!state.info.loaded) await loadStationInfo(token);
    if (token === state.token && showStationInfo()) renderStationInfo();
  }

  /** Once per station: distances to nearby bike docks (static), then the live parts. */
  async function loadStationInfo(token) {
    const stop = state.station.stop;
    const ids = T.nearbyBikePointIds(stop);
    const places = ids.length && stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lon)
      ? await settle(state.client.getBikePointsNear(stop.lat, stop.lon, BIKE_RADIUS_M))
      : null;
    if (token !== state.token) return;
    // Without distances the docks are still shown, in TfL's listed order.
    state.info.bikePlaces = places instanceof Error ? null : places;
    await loadStationInfoLive(token);
  }

  /** Refreshed with the live data: station disruption notices and bike availability. */
  async function loadStationInfoLive(token) {
    const s = state.station;
    const ids = T.nearbyBikePointIds(s.stop);
    const [notices, occupancy] = await Promise.all([
      settle(state.client.getStationDisruptions(s.id)),
      ids.length ? settle(state.client.getBikeOccupancy(ids)) : Promise.resolve([]),
    ]);
    if (token !== state.token) return;
    state.info.loaded = true;
    state.info.notices = notices;
    state.info.bikes = occupancy instanceof Error ? occupancy : T.nearestBikePoints(occupancy, state.info.bikePlaces, BIKE_LIMIT);
  }

  async function loadLive(token) {
    const s = state.station;
    const [live, arrivals, statuses, lifts] = await Promise.all([
      Promise.all(s.naptans.map(async (n) => [n.id, await settle(state.client.getLiveCrowding(n.id))])),
      Promise.all(s.naptans.map(async (n) => [n.id, await settle(state.client.getArrivals(n.id))])),
      settle(state.client.getLineStatuses(s.lines.map((l) => l.id))),
      settle(state.client.getLiftDisruptions()),
    ]);
    if (token !== state.token) return;
    state.live = new Map(live);
    state.arrivals = new Map(arrivals);
    state.statusError = statuses instanceof Error ? statuses : null;
    state.statuses = statuses instanceof Error ? new Map() : statuses;
    state.lifts = lifts instanceof Error ? lifts : T.liftDisruptionsFor(lifts, [s.id, ...s.naptans.map((n) => n.id)]);
    state.updatedAt = new Date();
  }

  async function refresh() {
    if (!state.station || state.busy) return;
    state.busy = true;
    const token = state.token;
    $('#content').classList.add('is-refreshing');
    try {
      const tasks = [loadLive(token)];
      if (showStationInfo()) tasks.push(state.info.loaded ? loadStationInfoLive(token) : loadStationInfo(token));
      if (T.londonNow().day !== state.profileDay) tasks.push(loadProfiles(token));
      await Promise.all(tasks);
      if (token === state.token) render();
    } finally {
      state.busy = false;
      $('#content').classList.remove('is-refreshing');
    }
  }

  function startTimer() {
    stopTimer();
    if ($('#auto-refresh').checked) state.timer = setInterval(refresh, REFRESH_MS);
  }
  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function showMessage(text, kind) {
    $('#station-view').hidden = true;
    const box = $('#message');
    box.hidden = false;
    box.className = `message message-${kind || 'info'}`;
    box.textContent = text;
  }

  function levelBadge(value) {
    const level = T.crowdingLevel(value);
    const pips = [1, 2, 3, 4].map((i) => `<span class="pip${i <= level.pips ? ' on' : ''}"></span>`).join('');
    return `<span class="level level-${level.key}"><span class="pips" aria-hidden="true">${pips}</span>${esc(level.label)}</span>`;
  }

  function typicalNow(naptan) {
    const p = state.profiles.get(naptan);
    if (!p || p instanceof Error || !p.found) return null;
    const band = T.bandAt(p.bands, T.londonNow().minutes);
    return band ? band.value : null;
  }

  function deltaText(live, typical) {
    if (live === null || typical === null) return '';
    const d = Math.round((live - typical) * 100);
    if (Math.abs(d) < 3) return '<span class="delta delta-flat">About usual for this time</span>';
    return d > 0
      ? `<span class="delta delta-up">▲ ${d} pts busier than usual</span>`
      : `<span class="delta delta-down">▼ ${-d} pts quieter than usual</span>`;
  }

  /** True when TfL has no crowding data at all for this NaPTAN (e.g. Network Rail-run and DLR stations). */
  function notCovered(naptan) {
    const p = state.profiles.get(naptan);
    const live = state.live.get(naptan);
    const profileMissing = (p instanceof Error && p.status === 404) || (p && !(p instanceof Error) && !p.found && !p.alwaysQuiet);
    const liveMissing = (live instanceof Error && live.status === 404) || (live && !(live instanceof Error) && !live.available);
    return Boolean(profileMissing && liveMissing);
  }

  function liveFor(naptan) {
    const live = state.live.get(naptan);
    if (!live || live instanceof Error || !live.available) return null;
    return live.value;
  }

  function render() {
    const s = state.station;
    $('#message').hidden = true;
    $('#station-view').hidden = false;

    $('#station-name').textContent = s.name;
    const meta = [];
    if (s.zone) meta.push(`Zone ${s.zone}`);
    meta.push(s.modes.map((m) => T.MODE_LABELS[m] || m).join(' · '));
    meta.push(`${s.lines.length} line${s.lines.length === 1 ? '' : 's'}`);
    $('#station-meta').textContent = meta.join(' — ');
    $('#updated').textContent = state.updatedAt
      ? `Updated ${state.updatedAt.toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })}`
      : '';
    $('#demo-banner').hidden = !DEMO;

    renderLifts();
    renderTiles();
    if (showStationInfo() && state.info.loaded) renderStationInfo();
    else $('#station-info').hidden = true;
    renderChart();
    renderLines();
  }

  function renderLifts() {
    const box = $('#lift-status');
    const lifts = state.lifts;
    if (!lifts || lifts instanceof Error) {
      // The lift feed is unofficial; if it fails, say nothing rather than imply lifts are fine.
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (!lifts.length) {
      box.className = 'lift-status lift-ok';
      box.innerHTML = '<span class="lift-icon" aria-hidden="true">✓</span><span>No lift faults reported at this station.</span>';
      return;
    }
    const count = lifts.reduce((n, l) => n + l.lifts, 0);
    box.className = 'lift-status lift-alert';
    box.innerHTML = `
      <span class="lift-icon" aria-hidden="true">!</span>
      <div>
        <strong>Step-free access affected${count ? ` — ${count} lift${count === 1 ? '' : 's'} out of service` : ''}</strong>
        ${lifts.map((l) => `<p>${esc(l.message)}</p>`).join('')}
      </div>`;
  }

  function renderStationInfo() {
    const s = state.station;
    const facilities = T.stationFacilities(s.stop);
    renderNotices();
    renderFacilities(facilities);
    renderBikes();
    $('#station-info').hidden = false;
  }

  const londonDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function formatNoticeDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : londonDate.format(d).replace(',', '');
  }

  function noticeClass(type) {
    if (/clos|suspen/i.test(type || '')) return 'serious';
    if (/information|message/i.test(type || '')) return 'info';
    return 'warning';
  }

  const APPEARANCE_LABELS = { PlannedWork: 'Planned work', RealTime: 'Live incident' };
  const NOTICE_MODE_LABELS = { ...T.MODE_LABELS, 'national-rail': 'National Rail' };

  function renderNotices() {
    const box = $('#station-notices');
    const notices = state.info.notices;
    if (notices instanceof Error) {
      box.hidden = false;
      box.className = 'card notices';
      box.innerHTML = `<h3 class="card-title">Station notices</h3><p class="muted small">Station notices unavailable: ${esc(notices.message)}</p>`;
      return;
    }
    // No notices: hide the card rather than show an empty list.
    if (!notices || !notices.length) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.className = 'card notices';
    const items = notices.map((n) => {
      const cls = noticeClass(n.type);
      const from = formatNoticeDate(n.fromDate);
      const to = formatNoticeDate(n.toDate);
      const when = n.upcoming
        ? `<strong>Starts ${esc(from)}</strong>${to ? ` · until ${esc(to)}` : ''}`
        : `<strong>In force now</strong>${to ? ` · until ${esc(to)}` : ''}${from ? ` <span class="muted">(since ${esc(from)})</span>` : ''}`;
      const where = [
        n.stations.map((st) => st.name).join(', '),
        n.modes.map((m) => NOTICE_MODE_LABELS[m] || m).join(', '),
      ].filter(Boolean).join(' · ');
      return `
        <li class="notice">
          <div class="notice-top">
            <span class="status status-${cls}"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[cls]}</span>${esc(n.type || 'Notice')}</span>
            ${n.appearance ? `<span class="notice-kind">${esc(APPEARANCE_LABELS[n.appearance] || n.appearance)}</span>` : ''}
          </div>
          <div class="small notice-when">${when}</div>
          <p class="notice-text">${esc(n.description)}</p>
          ${where ? `<div class="small muted">${esc(where)}</div>` : ''}
          ${n.additionalInformation ? `<details class="notice-more"><summary>More information</summary><p>${esc(n.additionalInformation)}</p></details>` : ''}
        </li>`;
    }).join('');
    box.innerHTML = `
      <h3 class="card-title">Station notices <span class="muted small">(${notices.length})</span></h3>
      <ul class="notice-list">${items}</ul>`;
  }

  const FACILITY_ICONS = { yes: '✓', no: '✕' };

  function renderFacilities(groups) {
    const box = $('#facilities');
    if (!groups.length) {
      box.innerHTML = '<h3 class="card-title">Facilities</h3><p class="muted small">TfL doesn’t list facilities for this station.</p>';
      return;
    }
    const html = groups.map((g) => {
      const items = g.items.map((i) => `
        <div class="fac-item fac-${esc(i.kind)}">
          <dt>${esc(i.label)}</dt>
          <dd>${FACILITY_ICONS[i.kind] ? `<span class="fac-icon" aria-hidden="true">${FACILITY_ICONS[i.kind]}</span>` : ''}${esc(i.value)}</dd>
        </div>`).join('');
      const extras = [
        g.visitorCentre ? `<div class="small">Visitor centre: ${esc(g.visitorCentre)}</div>` : '',
        g.phone ? `<div class="small muted">Phone: ${esc(g.phone)}</div>` : '',
      ].join('');
      const same = g.ids.length > 1 ? ' · TfL lists the same figures for each' : '';
      return `
        <div class="fac-group">
          <h4 class="fac-title">${esc(g.label)}</h4>
          <div class="small muted">${esc(g.names.join(', '))}${esc(same)}</div>
          ${items ? `<dl class="fac-list">${items}</dl>` : ''}
          ${extras}
        </div>`;
    }).join('');
    box.innerHTML = `<h3 class="card-title">Facilities</h3>${html}`;
  }

  function renderBikes() {
    const box = $('#bikes');
    const bikes = state.info.bikes;
    const title = '<h3 class="card-title">Santander Cycles nearby</h3>';
    if (bikes instanceof Error) {
      box.innerHTML = `${title}<p class="muted small">Bike availability unavailable: ${esc(bikes.message)}</p>`;
      return;
    }
    if (!bikes || !bikes.length) {
      box.innerHTML = `${title}<p class="muted small">TfL doesn’t list any Santander Cycles docks near this station.</p>`;
      return;
    }
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const rows = bikes.map((b) => {
      const bikesText = b.bikes === null ? 'Bikes unknown'
        : b.bikes === 0 ? 'No bikes'
        : `${plural(b.bikes, 'bike', 'bikes')}${b.eBikes ? ` <span class="muted">(${plural(b.eBikes, 'e-bike', 'e-bikes')})</span>` : ''}`;
      const docksText = b.emptyDocks === null ? '' : b.emptyDocks === 0 ? 'No free docks' : plural(b.emptyDocks, 'free dock', 'free docks');
      return `
        <li class="bike">
          <div class="bike-top"><span class="bike-name">${esc(b.name)}</span>${b.distance !== null ? `<span class="bike-dist">${esc(b.distance)} m</span>` : ''}</div>
          <div class="bike-counts small">
            <span class="${b.bikes === 0 ? 'bike-none' : ''}">${b.bikes === 0 ? '<span aria-hidden="true">✕ </span>' : ''}${bikesText}</span>
            ${docksText ? `<span class="${b.emptyDocks === 0 ? 'bike-none' : ''}">${b.emptyDocks === 0 ? '<span aria-hidden="true">✕ </span>' : ''}${esc(docksText)}</span>` : ''}
          </div>
        </li>`;
    }).join('');
    const ranked = bikes.some((b) => b.distance !== null);
    box.innerHTML = `${title}
      <p class="muted small">${ranked ? 'Nearest docks, straight-line distance' : 'Docks TfL lists near this station'}. Live availability.</p>
      <ul class="bike-list">${rows}</ul>`;
  }

  function hintHtml(naptan, liveValue) {
    const p = state.profiles.get(naptan);
    if (!p || p instanceof Error || !p.found) return '';
    const h = T.quieterTimeHint(p.bands, T.londonNow().minutes, liveValue);
    if (!h) return '';
    const text = {
      quieter: () => `Usually quieter from <strong>${T.formatClock(h.start)}</strong> (about ${pct(h.value)})`,
      stays: () => 'Usually stays this busy for the next 3 hours',
      busier: () => `Usually gets busier from <strong>${T.formatClock(h.start)}</strong> (about ${pct(h.value)})`,
      calm: () => 'Usually stays quiet for the next 3 hours',
    }[h.kind]();
    return `<div class="tile-hint"><span class="hint-icon" aria-hidden="true">◷</span><span>${text}</span></div>`;
  }

  function renderTiles() {
    const s = state.station;
    const html = s.naptans.map((n) => {
      const live = state.live.get(n.id);
      const typical = typicalNow(n.id);
      const swatches = n.lineIds
        .map((id) => s.lines.find((l) => l.id === id))
        .map((l) => `<span class="mini-line"><span class="swatch" style="--line:${esc(l.colour)}"></span>${esc(l.name)}</span>`)
        .join('');
      let body;
      if (notCovered(n.id)) {
        body = '<p class="tile-empty">TfL doesn’t publish crowding data for these entrances.</p>';
      } else if (live instanceof Error) {
        body = `<p class="tile-empty">${esc(live.message)}</p>`;
      } else if (!live || !live.available) {
        body = `<p class="tile-empty">No live reading right now. The feed can pause overnight.</p>${hintHtml(n.id, null)}`;
      } else {
        // timeLocal is London time without an offset (e.g. "2026-09-26 21:46:00"), so show its clock time as-is.
        const when = /[T ](\d{2}:\d{2})/.exec(live.timeLocal || '');
        body = `
          <div class="tile-value">${pct(live.value)}<span class="tile-unit">of baseline</span></div>
          <div class="tile-level">${levelBadge(live.value)}</div>
          <div class="tile-delta">${deltaText(live.value, typical)}${typical !== null ? `<span class="muted"> · usual now ${pct(typical)}</span>` : ''}</div>
          ${when ? `<div class="muted small">Reading at ${esc(when[1])}</div>` : ''}
          ${hintHtml(n.id, live.value)}`;
      }
      return `
        <article class="tile">
          <header class="tile-head"><h3>${esc(n.label)}</h3><code class="naptan">${esc(n.id)}</code></header>
          ${body}
          <div class="tile-lines">${swatches}</div>
        </article>`;
    }).join('');
    $('#tiles').innerHTML = html;
  }

  function renderChart() {
    const s = state.station;
    const series = [];
    const skipped = [];
    for (const n of s.naptans) {
      const p = state.profiles.get(n.id);
      if (!p || p instanceof Error || !p.found) { skipped.push(n.label); continue; }
      if (series.length >= SERIES_VARS.length) { skipped.push(n.label); continue; }
      const liveValue = liveFor(n.id);
      series.push({ label: n.label, colorVar: SERIES_VARS[series.length], bands: p.bands, live: liveValue !== null ? { value: liveValue } : null, profile: p });
    }
    const card = $('#chart-card');
    if (!series.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const dayNames = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
    $('#chart-sub').textContent = `Typical ${dayNames[state.profileDay] || ''} profile in 15-minute bands, as % of each station entrance group’s baseline. Dot = live reading now.`;

    const legend = $('#chart-legend');
    legend.textContent = '';
    if (series.length > 1) {
      for (const s2 of series) {
        const item = document.createElement('span');
        item.className = 'legend-item';
        const key = document.createElement('span');
        key.className = 'legend-key';
        key.style.background = `var(${s2.colorVar})`;
        item.append(key, document.createTextNode(s2.label));
        legend.appendChild(item);
      }
    }
    const peaks = series
      .map((s2) => {
        const parts = [s2.profile.amPeak && `AM peak ${s2.profile.amPeak}`, s2.profile.pmPeak && `PM peak ${s2.profile.pmPeak}`].filter(Boolean);
        return parts.length ? `${s2.label}: ${parts.join(', ')}` : '';
      })
      .filter(Boolean);
    $('#chart-peaks').textContent = [peaks.join(' · '), skipped.length ? `No typical profile for: ${skipped.join(', ')}` : ''].filter(Boolean).join(' — ');

    const nowX = T.serviceMinutes(T.londonNow().minutes);
    window.TflChart.renderProfileChart($('#chart'), series, nowX);
    renderTable(series);
  }

  function renderTable(series) {
    const xs = [...new Set(series.flatMap((s) => s.bands.map((b) => b.x)))].sort((a, b) => a - b);
    const table = document.createElement('table');
    const thead = table.createTHead().insertRow();
    ['Time', ...series.map((s) => s.label)].forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      thead.appendChild(th);
    });
    const tbody = table.createTBody();
    for (const x of xs) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = `${T.formatClock(x + 240)}–${T.formatClock(x + 255)}`;
      for (const s of series) {
        const b = s.bands.find((bb) => bb.x === x);
        tr.insertCell().textContent = b ? pct(b.value) : '—';
      }
    }
    const wrap = $('#chart-table');
    wrap.textContent = '';
    wrap.appendChild(table);
  }

  const STATUS_ICONS = { good: '✓', info: 'ℹ', warning: '!', serious: '!!', critical: '✕' };

  /** Heuristic per-line platform outlook: station busyness adjusted for disruption and service gaps. */
  function platformOutlook(stationValue, status, platforms) {
    if (stationValue === null) return null;
    let score = T.crowdingLevel(stationValue).pips;
    const reasons = [];
    if (status && (status.cls === 'critical' || status.cls === 'serious')) { score += 1.5; reasons.push('disruption on the line'); }
    else if (status && status.cls === 'warning') { score += 0.75; reasons.push('minor delays'); }
    const gaps = platforms.map((p) => (p.trains[0] ? p.trains[0].minutes : null)).filter((m) => m !== null);
    if (gaps.length && Math.max(...gaps) >= 8) { score += 0.5; reasons.push('long wait for the next train'); }
    const pips = Math.max(1, Math.min(4, Math.round(score)));
    const value = [0.1, 0.35, 0.6, 0.9][pips - 1];
    return { value, reasons };
  }

  const BOARD_ICONS = { board: '✓', tight: '~', wait1: '!', wait2: '!!' };

  /** Per-direction boarding estimate for a line card, or null when there's no loading data. */
  function boardingHtml(line, status, platforms, arrivalsRaw, minutes) {
    const dirs = state.boarding.get(line.id);
    if (!dirs || !dirs.length) return null;
    const label = '<div class="section-label" title="Estimate made by this dashboard from TfL typical train loadings and live busyness">Boarding estimate<sup>*</sup></div>';
    const running = Array.isArray(arrivalsRaw) && arrivalsRaw.some((a) => a.lineId === line.id);
    if (!running && status && (status.cls === 'critical' || status.cls === 'info') && /clos|suspend|not running/i.test(status.description)) {
      return `<div class="boarding">${label}<p class="small muted">No trains running right now, so there’s nothing to estimate.</p></div>`;
    }
    const live = liveFor(line.naptan);
    const typical = typicalNow(line.naptan);
    const liveFactor = live !== null && typical !== null && typical >= 0.05 ? live / typical : 1;
    const rows = dirs.map((d) => {
      const dirName = T.DIRECTION_NAMES[d.dir] || d.dir;
      const depart = T.loadingAt(d.ownRows, minutes);
      let arrive = null;
      for (const rows of d.arriveRows) {
        const v = T.loadingAt(rows, minutes);
        if (v !== null) arrive = Math.max(arrive === null ? 0 : arrive, v);
      }
      const reasons = [];
      let serviceFactor = 1;
      if (status && (status.cls === 'serious' || status.cls === 'critical')) { serviceFactor *= 1.5; reasons.push('disruption on the line'); }
      else if (status && status.cls === 'warning') { serviceFactor *= 1.2; reasons.push('minor delays'); }
      const platform = platforms.find((p) => p.platform.toLowerCase().startsWith(dirName.toLowerCase()));
      if (platform && platform.trains[0] && platform.trains[0].minutes >= 8) { serviceFactor *= 1.2; reasons.push(`next train in ${platform.trains[0].minutes} min`); }
      const e = T.boardingEstimate({ depart, arrive, origin: d.origin, liveFactor, serviceFactor });
      const head = `<div class="board-dir">${esc(dirName)} <span class="muted">to ${esc(d.toName)}</span></div>`;
      if (!e) return `<div class="board-row">${head}<div class="small muted">No typical loading data for this time.</div></div>`;
      const pts = Math.round((liveFactor - 1) * 100);
      if (Math.abs(pts) >= 5 && live !== null) reasons.unshift(`station ${Math.abs(pts)}% ${pts > 0 ? 'busier' : 'quieter'} than usual`);
      const arriveText = d.origin
        ? 'Starts here, so trains arrive empty'
        : e.arriveKnown ? `Arrives about ${e.arrivePct}% full from ${esc(d.prevNames.join(' / '))}` : 'Arrival load unknown';
      return `
        <div class="board-row">
          <div class="board-top">${head}<span class="board-badge board-${e.band.key}"><span class="board-icon" aria-hidden="true">${BOARD_ICONS[e.band.key]}</span>${esc(e.band.label)}</span></div>
          <div class="small muted">${arriveText} · usually leaves ${e.saturated ? 'full' : `${e.departPct}% full`}${reasons.length ? ` · ${esc(reasons.join(', '))}` : ''}</div>
        </div>`;
    }).join('');
    return `<div class="boarding">${label}${rows}</div>`;
  }

  function renderLines() {
    const s = state.station;
    const minutes = T.londonNow().minutes;
    const html = s.lines.map((line) => {
      const status = state.statuses.get(line.id);
      const naptan = s.naptans.find((n) => n.id === line.naptan);
      const stationValue = liveFor(line.naptan);
      const typical = typicalNow(line.naptan);
      const arrivalsRaw = state.arrivals.get(line.naptan);
      const platforms = Array.isArray(arrivalsRaw) ? T.summarizeArrivals(arrivalsRaw, line.id, 3) : [];
      const loadings = state.loadings.has(line.id) ? T.summarizeTrainLoadings(state.loadings.get(line.id), line, minutes) : [];
      const boarding = boardingHtml(line, status, platforms, arrivalsRaw, minutes);
      // The boarding estimate supersedes the station-level outlook and the relative loading bars.
      const outlook = boarding ? null : platformOutlook(stationValue, status, platforms);

      const statusHtml = status
        ? `<span class="status status-${status.cls}"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[status.cls]}</span>${esc(status.description)}</span>`
        : `<span class="status status-info"><span class="status-icon" aria-hidden="true">ℹ</span>${state.statusError ? 'Status unavailable' : 'No status'}</span>`;

      const crowdHtml = stationValue === null
        ? `<p class="muted small">${notCovered(line.naptan)
            ? `TfL doesn’t publish crowding data for the ${esc(naptan ? naptan.label : '')} entrances here.`
            : `No live crowding reading for ${esc(naptan ? naptan.label : 'this station')} right now.`}</p>`
        : `
          <div class="crowd-row">
            <span class="crowd-label">Station busyness</span>
            ${levelBadge(stationValue)}
          </div>
          <div class="meter meter-${T.crowdingLevel(stationValue).key}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(stationValue * 100)}" aria-label="Live station busyness">
            <div class="meter-fill" style="width:${Math.min(100, stationValue * 100).toFixed(1)}%"></div>
            ${typical !== null ? `<div class="meter-typical" style="left:${Math.min(100, typical * 100).toFixed(1)}%" title="Usual for this time: ${pct(typical)}"></div>` : ''}
          </div>
          <div class="small muted">${pct(stationValue)} of baseline${typical !== null ? ` · usual now ${pct(typical)} (tick)` : ''} · ${esc(naptan ? naptan.label : '')} entrances</div>`;

      const outlookHtml = outlook
        ? `<div class="crowd-row outlook"><span class="crowd-label" title="Estimate: station busyness, adjusted for this line's disruption and gap to the next train">Platform outlook<sup>*</sup></span>${levelBadge(outlook.value)}</div>
           ${outlook.reasons.length ? `<div class="small muted">Raised by ${esc(outlook.reasons.join(' and '))}</div>` : ''}`
        : '';

      const flows = state.loadings.has(line.id) ? T.summarizePassengerFlows(state.loadings.get(line.id), line) : null;
      let flowHtml = '';
      if (flows) {
        const nowBand = flows.bands.find((b) => b.x <= T.serviceMinutes(minutes) && T.serviceMinutes(minutes) < b.x + 15);
        const fmt = (v) => Math.round(v).toLocaleString('en-GB');
        flowHtml = `
          <div class="flows">
            <div class="section-label">Typical passenger flow on this line here</div>
            <div class="small">${nowBand ? `<strong>${fmt(nowBand.value)}</strong> per 15 min now · ` : ''}<span class="muted">peak ${T.formatClock(flows.peak.start)}–${T.formatClock(flows.peak.start + 15)} (${fmt(flows.peak.value)})</span></div>
            <div class="flow-chart" data-line="${esc(line.id)}"></div>
            ${['SAT', 'SUN'].includes(T.londonNow().day) ? '<div class="small muted">TfL publishes one profile for every day, and it follows a weekday commute pattern, so it may not match today.</div>' : ''}
          </div>`;
      }

      const loadingHtml = !boarding && loadings.length
        ? `<div class="loadings"><div class="section-label">Typical train loading now</div>${loadings.map((l) => `
            <div class="loading-row"><span class="loading-dir">${esc(l.direction)}</span>
              <span class="loading-bar"><span style="width:${(l.relative * 100).toFixed(0)}%"></span></span>
              <span class="loading-val">${pct(l.relative)} of peak</span></div>`).join('')}</div>`
        : '';

      let arrivalsHtml;
      if (arrivalsRaw instanceof Error) arrivalsHtml = `<p class="muted small">Arrivals unavailable: ${esc(arrivalsRaw.message)}</p>`;
      else if (!platforms.length) arrivalsHtml = '<p class="muted small">No trains currently predicted.</p>';
      else arrivalsHtml = platforms.slice(0, 4).map((p) => `
          <div class="platform">
            <div class="platform-name">${esc(p.platform)}</div>
            <ol class="trains">${p.trains.map((t) => `<li><span class="dest">${esc(t.destination)}</span><span class="mins">${t.minutes === 0 ? 'Due' : `${t.minutes} min`}</span></li>`).join('')}</ol>
          </div>`).join('');

      const reasons = status && status.reasons.length ? `<p class="reason">${esc(status.reasons[0])}</p>` : '';

      return `
        <article class="line-card" data-line="${esc(line.id)}" style="--line:${esc(line.colour)}">
          <header class="line-head">
            <div class="line-title"><h3>${esc(line.name)}</h3><span class="muted small">${esc(T.MODE_LABELS[line.mode] || line.mode)}</span></div>
            ${statusHtml}
          </header>
          ${reasons}
          <div class="crowd">${crowdHtml}${outlookHtml}</div>
          ${boarding || ''}
          ${loadingHtml}
          ${flowHtml}
          <div class="arrivals"><div class="section-label">Next trains</div>${arrivalsHtml}</div>
          ${lineStripHtml(line)}
        </article>`;
    }).join('');
    const stripFocus = focusKey(document.activeElement);
    $('#lines').innerHTML = html;
    restoreLineStrips(stripFocus);
    renderFlowCharts();
  }

  function renderFlowCharts() {
    const nowX = T.serviceMinutes(T.londonNow().minutes);
    for (const el of document.querySelectorAll('.flow-chart')) {
      const line = state.station.lines.find((l) => l.id === el.dataset.line);
      const flows = line && T.summarizePassengerFlows(state.loadings.get(line.id), line);
      if (flows) window.TflChart.renderFlowSparkline(el, flows.bands, nowX, `Typical passenger flow per 15 minutes on the ${line.name} line at this station, peaking at ${T.formatClock(flows.peak.start)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Live crowding along a whole line (on demand, one /crowding/{naptan}/Live request per station)
  // ---------------------------------------------------------------------------
  const LINE_LIVE_TTL_MS = 60 * 1000;
  const LINE_CONCURRENCY = 3;
  const lineLiveCache = new Map(); // naptan → {at, promise of normalized live | Error}
  const strips = { stationId: null, views: new Map() }; // lineId → {open, branch, branches, names, readings, loading, limited, error, at, seq, scroll}

  /** Live reading for one station, cached for about a minute and shared by every strip. */
  function lineLive(naptan) {
    const hit = lineLiveCache.get(naptan);
    if (hit && Date.now() - hit.at < LINE_LIVE_TTL_MS) return hit.promise;
    // The open station's own reading is already loaded by the main refresh.
    const own = state.live.get(naptan);
    if (own && !(own instanceof Error) && state.updatedAt && Date.now() - state.updatedAt < LINE_LIVE_TTL_MS) return Promise.resolve(own);
    const entry = { at: Date.now() };
    entry.promise = settle(state.client.getLiveCrowding(naptan)).then((r) => {
      // Keep answers (including 404 "no data"); forget failures so the next try asks again.
      if (r instanceof Error && r.status !== 404 && lineLiveCache.get(naptan) === entry) lineLiveCache.delete(naptan);
      return r;
    });
    lineLiveCache.set(naptan, entry);
    return entry.promise;
  }

  function stripView(lineId) {
    const id = state.station ? state.station.id : null;
    if (strips.stationId !== id) { strips.stationId = id; strips.views = new Map(); }
    if (!strips.views.has(lineId)) {
      strips.views.set(lineId, { open: false, branch: null, branches: null, names: null, readings: new Map(), loading: false, limited: 0, error: null, at: null, seq: 0, scroll: null });
    }
    return strips.views.get(lineId);
  }

  /** Placeholder on each line card; TfL publishes live crowding only for Underground stations. */
  function lineStripHtml(line) {
    if (line.mode !== 'tube') return '';
    const view = stripView(line.id);
    return `
      <div class="line-strip" data-line="${esc(line.id)}">
        <button type="button" class="ghost strip-toggle" aria-expanded="${view.open}" aria-controls="strip-${esc(line.id)}">${view.open ? 'Hide whole line' : 'Show whole line'}</button>
        <div class="strip-body" id="strip-${esc(line.id)}"${view.open ? '' : ' hidden'}>${view.open ? stripBodyHtml(line, view) : ''}</div>
      </div>`;
  }

  function stripStopHtml(row, loading) {
    let badge;
    if (row.state === 'live') badge = `${levelBadge(row.value)}<span class="strip-pct">${pct(row.value)}</span>`;
    else if (row.state === 'nodata') badge = `${levelBadge(null)}`;
    else if (row.state === 'error') badge = `<span class="strip-note">${row.error.status === 429 ? 'Not loaded' : 'Unavailable'}</span>`;
    else badge = `<span class="strip-note">${loading ? 'Loading…' : 'Not loaded'}</span>`;
    return `
      <span class="strip-dot" aria-hidden="true"></span>
      <span class="strip-name">${esc(row.name)}${row.selected ? ' <span class="strip-here">This station</span>' : ''}</span>
      <span class="strip-level">${badge}</span>`;
  }

  function stripSummaryText(view, rows) {
    if (view.loading) return `Loading live busyness for ${rows.length} station${rows.length === 1 ? '' : 's'}…`;
    const sum = T.lineCrowdingSummary(rows);
    const c = sum.counts;
    const parts = [
      c['very-busy'] && `${c['very-busy']} very busy`, c.busy && `${c.busy} busy`,
      c.moderate && `${c.moderate} moderately busy`, c.quiet && `${c.quiet} quiet`,
      c.nodata && `${c.nodata} no data`, (c.error + c.pending) && `${c.error + c.pending} not loaded`,
    ].filter(Boolean);
    const time = /[T ](\d{2}:\d{2})/.exec(sum.latest || '');
    return `${rows.length} station${rows.length === 1 ? '' : 's'}: ${parts.join(', ')}.`
      + (sum.busiest ? ` Busiest: ${sum.busiest.name} (${sum.busiest.level.label.toLowerCase()}, ${pct(sum.busiest.value)}).` : '')
      + (time ? ` Readings from ${time[1]}.` : '');
  }

  function stripBodyHtml(line, view) {
    if (view.error) return `<p class="small muted">Couldn’t load the ${esc(line.name)} line’s stations: ${esc(view.error.message)}</p><button type="button" class="link strip-refresh">Try again</button>`;
    if (!view.branches) return '<p class="small muted" role="status">Loading the line’s stations…</p>';
    const branch = view.branches.find((b) => b.key === view.branch);
    if (!branch) return `<p class="small muted">TfL’s route list for the ${esc(line.name)} line doesn’t include this station.</p>`;
    const rows = T.lineCrowdingRows(branch.ids, view.names, view.readings, line.naptan);
    const picker = view.branches.length > 1
      ? `<label class="strip-branch small">Branch <select data-line="${esc(line.id)}">${view.branches.map((b) =>
          `<option value="${esc(b.key)}"${b.key === branch.key ? ' selected' : ''}>${esc(b.name)} (${b.ids.length})</option>`).join('')}</select></label>`
      : `<div class="small muted">${esc(branch.name)}</div>`;
    const warn = view.limited
      ? `<p class="strip-warn small" role="alert">TfL’s rate limit was reached, so ${view.limited} station${view.limited === 1 ? ' wasn’t' : 's weren’t'} loaded. ${DEMO ? '' : '<button type="button" class="link strip-settings">Add an app key in Settings</button> or '}try again in a minute.</p>`
      : '';
    const items = rows.map((r) => `<li class="strip-stop strip-${r.state === 'live' ? r.level.key : r.state}${r.selected ? ' is-here' : ''}" data-stop="${esc(r.id)}"${r.selected ? ' aria-current="location"' : ''}>${stripStopHtml(r, view.loading)}</li>`).join('');
    const status = state.statuses.get(line.id);
    const notRunning = status && (status.cls === 'critical' || status.cls === 'info') && /clos|suspend|not running/i.test(status.description)
      ? `<p class="small muted">${esc(line.name)} line: ${esc(status.description)}. The station readings below are still live.</p>`
      : '';
    return `
      ${picker}
      ${notRunning}
      <p class="strip-summary small" role="status">${esc(stripSummaryText(view, rows))}</p>
      ${warn}
      <ol class="strip-list" tabindex="0" aria-label="Live busyness at each station, ${esc(branch.name)}">${items}</ol>
      <div class="strip-foot small muted">
        <span>Live station busyness, not how full trains are. Not refreshed automatically.</span>
        ${view.loading ? '' : '<button type="button" class="link strip-refresh">Refresh</button>'}
      </div>`;
  }

  function stripEl(lineId) {
    return [...document.querySelectorAll('#lines .line-strip')].find((el) => el.dataset.line === lineId) || null;
  }

  function renderLineStrip(line, view) {
    const el = stripEl(line.id);
    if (!el) return;
    const body = el.querySelector('.strip-body');
    const list = body.querySelector('.strip-list');
    const scroll = list ? list.scrollTop : null;
    const focused = body.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    body.innerHTML = stripBodyHtml(line, view);
    const newList = body.querySelector('.strip-list');
    if (newList && scroll !== null) newList.scrollTop = scroll;
    if (focused) restoreFocus(body, focused);
  }

  /** Update one station's row in place as its reading arrives, so the list doesn't jump. */
  function renderStripStop(line, view, id) {
    const el = stripEl(line.id);
    const branch = view.branches && view.branches.find((b) => b.key === view.branch);
    if (!el || !branch) return;
    const li = [...el.querySelectorAll('.strip-stop')].find((x) => x.dataset.stop === id);
    if (!li) return;
    const [row] = T.lineCrowdingRows([id], view.names, view.readings, line.naptan);
    li.className = `strip-stop strip-${row.state === 'live' ? row.level.key : row.state}${row.selected ? ' is-here' : ''}`;
    li.innerHTML = stripStopHtml(row, view.loading);
  }

  /** Scroll the list (not the page) so the open station is in view. */
  function centreStripOnStation(lineId) {
    const el = stripEl(lineId);
    const list = el && el.querySelector('.strip-list');
    const here = list && list.querySelector('.is-here');
    if (here) list.scrollTop = Math.max(0, here.offsetTop - (list.clientHeight - here.offsetHeight) / 2);
  }

  async function loadLineStrip(line) {
    const view = stripView(line.id);
    const seq = ++view.seq;
    const current = () => strips.views.get(line.id) === view && view.seq === seq && view.open;
    view.loading = true;
    view.error = null;
    view.limited = 0;
    const firstTime = !view.branches;
    if (firstTime) renderLineStrip(line, view);
    const route = await cached(`route:${line.id}`, () => state.client.getRouteSequence(line.id));
    if (!current()) return;
    if (route instanceof Error) {
      staticCache.delete(`route:${line.id}`);
      view.loading = false;
      view.error = route;
      renderLineStrip(line, view);
      return;
    }
    view.branches = T.lineBranches(route, line.naptan);
    view.names = T.routeStationNames(route);
    const branch = view.branches.find((b) => b.key === view.branch) || view.branches[0];
    view.branch = branch ? branch.key : null;
    renderLineStrip(line, view);
    if (firstTime) centreStripOnStation(line.id);
    if (!branch) { view.loading = false; return; }

    // A few requests at a time, nearest stations first; stop asking once TfL says we're rate limited.
    let limited = false;
    await T.mapLimit(T.outwardOrder(branch.ids, branch.index), LINE_CONCURRENCY, async (id) => {
      if (limited || !current()) return;
      const r = await lineLive(id);
      if (!current()) return;
      if (r instanceof Error && r.status === 429) limited = true;
      view.readings.set(id, r);
      renderStripStop(line, view, id);
    });
    if (!current()) return;
    view.loading = false;
    view.at = new Date();
    view.limited = limited
      ? branch.ids.filter((id) => { const r = view.readings.get(id); return !r || (r instanceof Error && r.status === 429); }).length
      : 0;
    renderLineStrip(line, view);
  }

  function onLineStripClick(e) {
    const btn = e.target.closest('button');
    const wrap = btn && btn.closest('.line-strip');
    if (!wrap || !state.station) return;
    const line = state.station.lines.find((l) => l.id === wrap.dataset.line);
    if (!line) return;
    const view = stripView(line.id);
    if (btn.classList.contains('strip-toggle')) {
      view.open = !view.open;
      btn.setAttribute('aria-expanded', String(view.open));
      btn.textContent = view.open ? 'Hide whole line' : 'Show whole line';
      const body = wrap.querySelector('.strip-body');
      body.hidden = !view.open;
      if (!view.open) { view.seq += 1; view.loading = false; body.textContent = ''; return; }
      renderLineStrip(line, view);
      if (view.branches) centreStripOnStation(line.id);
      loadLineStrip(line);
    } else if (btn.classList.contains('strip-refresh')) {
      loadLineStrip(line);
    } else if (btn.classList.contains('strip-settings')) {
      openSettings();
    }
  }

  function onLineStripChange(e) {
    const select = e.target.closest('.strip-branch select');
    if (!select || !state.station) return;
    const line = state.station.lines.find((l) => l.id === select.dataset.line);
    if (!line) return;
    const view = stripView(line.id);
    view.branch = select.value;
    renderLineStrip(line, view);
    centreStripOnStation(line.id);
    loadLineStrip(line);
  }

  /** Remember the strips' scroll positions so a full re-render of the line cards keeps them. */
  function onLineStripScroll(e) {
    const list = e.target;
    if (!(list instanceof Element) || !list.classList.contains('strip-list')) return;
    const wrap = list.closest('.line-strip');
    if (wrap) stripView(wrap.dataset.line).scroll = list.scrollTop;
  }

  /** A selector-ish key for the focused control inside #lines, so it can be focused again after a re-render. */
  function focusKey(el) {
    const wrap = el && el.closest && el.closest('.line-strip');
    if (!wrap) return null;
    const cls = ['strip-toggle', 'strip-refresh', 'strip-settings', 'strip-list'].find((c) => el.classList.contains(c));
    return { line: wrap.dataset.line, cls: cls || (el.tagName === 'SELECT' ? 'select' : null) };
  }
  function restoreFocus(scope, key) {
    if (!key || !key.cls) return;
    const target = key.cls === 'select' ? scope.querySelector('select') : scope.querySelector(`.${key.cls}`);
    if (target) target.focus({ preventScroll: true });
  }

  /** After renderLines replaces the cards: put back strip scroll positions and keyboard focus. */
  function restoreLineStrips(focused) {
    for (const [lineId, view] of strips.views) {
      const el = stripEl(lineId);
      const list = el && el.querySelector('.strip-list');
      if (list && view.scroll !== null) list.scrollTop = view.scroll;
    }
    if (focused) {
      const el = stripEl(focused.line);
      if (el) restoreFocus(el, focused);
    }
  }

  // ---------------------------------------------------------------------------
  // Network status strip (all lines) and planned closures for this station's lines
  // ---------------------------------------------------------------------------
  const CLOSURE_DAYS = 14;
  const CLOSURE_REFRESH_MS = 30 * 60 * 1000;
  const network = {
    lines: null, // [{id, name, mode, colour, cls, description, reasons}]
    error: null,
    updatedAt: null,
    selected: null, // line id whose details are open
    timer: null,
    seq: 0,
  };
  const closures = {
    list: null, // upcomingClosures() result | Error | null while loading
    stationId: null,
    loadedAt: 0,
    seq: 0,
  };

  async function loadNetworkStatus() {
    const seq = ++network.seq;
    try {
      const lines = await state.client.getNetworkStatus();
      if (seq !== network.seq) return;
      network.lines = lines;
      network.error = null;
      network.updatedAt = new Date();
    } catch (e) {
      if (seq !== network.seq) return;
      network.error = e;
    }
    renderNetworkStatus();
  }

  function renderNetworkStatus() {
    const list = $('#network-lines');
    const summary = $('#network-summary');
    const lines = network.lines || [];
    const disrupted = lines.filter((l) => l.cls !== 'good');
    const time = network.updatedAt ? network.updatedAt.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : '';
    if (network.error && !lines.length) summary.textContent = `Line status unavailable: ${network.error.message}`;
    else if (!lines.length) summary.textContent = 'Loading line status…';
    else {
      const head = disrupted.length
        ? `${disrupted.length} of ${lines.length} lines not running a good service`
        : `Good service on all ${lines.length} lines`;
      summary.textContent = `${head} · updated ${time}${network.error ? ' (latest refresh failed)' : ''}`;
    }

    let goodLabelDone = false;
    list.innerHTML = lines.map((l) => {
      const swatch = `<span class="swatch" style="--line:${esc(l.colour)}" aria-hidden="true"></span>`;
      const icon = `<span class="status-icon" aria-hidden="true">${STATUS_ICONS[l.cls]}</span>`;
      if (l.cls === 'good') {
        const label = goodLabelDone ? '' : `<li class="net-group" aria-hidden="true">${icon.replace('status-icon', 'status-icon net-group-icon')}Good service</li>`;
        goodLabelDone = true;
        return `${label}<li class="net-line net-good status-good">${swatch}<span class="net-name">${esc(l.name)}</span><span class="visually-hidden">: ${esc(l.description)}</span></li>`;
      }
      const open = network.selected === l.id;
      return `<li><button type="button" class="net-line status-${l.cls}${open ? ' open' : ''}" data-line="${esc(l.id)}" aria-expanded="${open}" aria-controls="network-detail">
          ${swatch}<span class="net-name">${esc(l.name)}</span>${icon}<span class="net-desc">${esc(l.description)}</span></button></li>`;
    }).join('');
    renderNetworkDetail();
  }

  function renderNetworkDetail() {
    const box = $('#network-detail');
    const line = network.selected && (network.lines || []).find((l) => l.id === network.selected && l.cls !== 'good');
    if (!line) {
      network.selected = null;
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.dataset.line = line.id;
    box.style.setProperty('--line', line.colour);
    box.innerHTML = `<strong>${esc(line.name)}: ${esc(line.description)}</strong>${line.reasons.length
      ? line.reasons.map((r) => `<p>${esc(r)}</p>`).join('')
      : '<p>TfL gave no further details.</p>'}`;
  }

  function onNetworkClick(e) {
    const btn = e.target.closest('button.net-line');
    if (!btn) return;
    network.selected = network.selected === btn.dataset.line ? null : btn.dataset.line;
    for (const b of document.querySelectorAll('#network-lines button.net-line')) {
      const open = b.dataset.line === network.selected;
      b.classList.toggle('open', open);
      b.setAttribute('aria-expanded', String(open));
    }
    renderNetworkDetail();
  }

  /** Planned closures for the station's lines; called when a station loads (and every 30 min after). */
  async function loadClosures(station) {
    const seq = ++closures.seq;
    if (closures.stationId !== station.id) closures.list = null;
    closures.stationId = station.id;
    renderClosures();
    const result = await settle(state.client.getUpcomingClosures(station.lines.map((l) => l.id), CLOSURE_DAYS));
    if (seq !== closures.seq || state.station !== station) return;
    // Keep the last good list if a background refresh fails.
    if (!(result instanceof Error) || !Array.isArray(closures.list)) closures.list = result;
    closures.loadedAt = Date.now();
    renderClosures();
  }

  function renderClosures() {
    const box = $('#closures');
    const list = closures.list;
    const station = state.station;
    if (list === null) { box.innerHTML = '<p class="muted small">Loading planned closures…</p>'; return; }
    if (list instanceof Error) { box.innerHTML = `<p class="muted small">Couldn’t load planned closures: ${esc(list.message)}</p>`; return; }
    if (!list.length) {
      box.innerHTML = `<p class="closures-none"><span class="status-icon" aria-hidden="true">${STATUS_ICONS.good}</span>No planned closures announced for these lines in the next ${CLOSURE_DAYS} days.</p>`;
      return;
    }
    const groups = new Map();
    for (const c of list) {
      if (!groups.has(c.lineId)) groups.set(c.lineId, []);
      groups.get(c.lineId).push(c);
    }
    const lineName = (id, fallback) => ((station && station.lines.find((l) => l.id === id)) || {}).name || fallback;
    // Drop the "JUBILEE LINE:" style prefix TfL puts on reasons; the group heading already names the line.
    const tidy = (r) => r.replace(/^[A-Z][A-Z&'. -]+:\s*/, '');
    const unaffected = station ? station.lines.filter((l) => !groups.has(l.id)).map((l) => l.name) : [];
    box.innerHTML = [...groups.entries()].map(([id, items]) => `
      <article class="closure-line" data-line="${esc(id)}" style="--line:${esc(items[0].colour)}">
        <h3><span class="swatch" aria-hidden="true"></span>${esc(lineName(id, items[0].lineName))}</h3>
        <ul>${items.map((c) => `
          <li class="closure">
            <div class="closure-top">
              <span class="closure-when">${c.current ? '<span class="closure-now">In progress</span>' : ''}${esc(T.formatPeriod(c.from, c.to))}</span>
              <span class="status status-${c.cls}"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[c.cls]}</span>${esc(c.description)}</span>
            </div>
            ${c.reason ? `<p class="closure-reason">${esc(tidy(c.reason))}</p>` : ''}
          </li>`).join('')}
        </ul>
      </article>`).join('')
      + (unaffected.length ? `<p class="muted small closures-clear">Nothing announced for: ${esc(unaffected.join(', '))}.</p>` : '');
  }

  function networkTick() {
    if (document.visibilityState === 'hidden') return;
    // With a station open, follow its auto-refresh switch; otherwise always keep the strip fresh.
    if (state.station && !$('#auto-refresh').checked) return;
    loadNetworkStatus();
    if (state.station && Date.now() - closures.loadedAt > CLOSURE_REFRESH_MS) loadClosures(state.station);
  }

  function initNetworkStatus() {
    $('#network-lines').addEventListener('click', onNetworkClick);
    $('#refresh-now').addEventListener('click', loadNetworkStatus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!network.updatedAt || Date.now() - network.updatedAt > REFRESH_MS)) loadNetworkStatus();
    });
    network.timer = setInterval(networkTick, REFRESH_MS);
    loadNetworkStatus();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function openSettings() {
    $('#app-key').value = store.get('tfl.appKey') || '';
    $('#settings').showModal();
  }
  function saveSettings(e) {
    e.preventDefault();
    const key = $('#app-key').value.trim();
    store.set('tfl.appKey', key || null);
    $('#settings').close();
    makeClient();
    if (state.station) loadStation(state.station.id);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    applyTheme(store.get('tfl.theme') || 'auto');
    makeClient();

    const picks = $('#quick-picks');
    for (const [id, name] of QUICK_PICKS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = name;
      b.addEventListener('click', () => { $('#station-search').value = name; loadStation(id); });
      picks.appendChild(b);
    }

    const input = $('#station-search');
    input.addEventListener('input', onSearchInput);
    input.addEventListener('keydown', onSearchKey);
    input.addEventListener('blur', () => setTimeout(closeResults, 150));
    $('#search-form').addEventListener('submit', (e) => e.preventDefault());
    $('#theme-toggle').addEventListener('click', cycleTheme);
    $('#settings-open').addEventListener('click', openSettings);
    $('#settings-form').addEventListener('submit', saveSettings);
    $('#settings-cancel').addEventListener('click', () => $('#settings').close());
    $('#refresh-now').addEventListener('click', refresh);
    $('#auto-refresh').addEventListener('change', startTimer);
    $('#show-station-info').checked = store.get('tfl.showStationInfo') === '1';
    $('#show-station-info').addEventListener('change', onStationInfoToggle);
    if (DEMO) $('#settings-open').hidden = true;
    $('#lines').addEventListener('click', onLineStripClick);
    $('#lines').addEventListener('change', onLineStripChange);
    $('#lines').addEventListener('scroll', onLineStripScroll, true);
    initNetworkStatus();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!state.station) return;
        renderChart();
        renderFlowCharts();
      }, 150);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.station && state.updatedAt && Date.now() - state.updatedAt > REFRESH_MS) refresh();
    });

    const initial = params.get('station');
    if (initial) loadStation(initial);
    else showMessage('Search for a station, or pick one above, to see live crowding for every line that serves it.', 'info');
  }

  init();
})();
