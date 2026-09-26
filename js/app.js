(function () {
  'use strict';

  const T = window.TflApi;
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const REFRESH_MS = 60 * 1000;
  const SERIES_VARS = ['--series-1', '--series-2', '--series-3'];

  const QUICK_PICKS = DEMO
    ? [['940GZZLUKSX', "King's Cross"], ['940GZZLUOXC', 'Oxford Circus'], ['940GZZLUSTD', 'Stratford'], ['940GZZLUBNK', 'Bank']]
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
    loadings: new Map(), // lineId → raw train-loading response
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
    document.title = `${station.name} · Live station crowding`;

    await Promise.all([loadProfiles(token), loadLive(token), loadTrainLoadings(token)]);
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
  }

  async function loadLive(token) {
    const s = state.station;
    const [live, arrivals, statuses] = await Promise.all([
      Promise.all(s.naptans.map(async (n) => [n.id, await settle(state.client.getLiveCrowding(n.id))])),
      Promise.all(s.naptans.map(async (n) => [n.id, await settle(state.client.getArrivals(n.id))])),
      settle(state.client.getLineStatuses(s.lines.map((l) => l.id))),
    ]);
    if (token !== state.token) return;
    state.live = new Map(live);
    state.arrivals = new Map(arrivals);
    state.statusError = statuses instanceof Error ? statuses : null;
    state.statuses = statuses instanceof Error ? new Map() : statuses;
    state.updatedAt = new Date();
  }

  async function refresh() {
    if (!state.station || state.busy) return;
    state.busy = true;
    const token = state.token;
    $('#content').classList.add('is-refreshing');
    try {
      const tasks = [loadLive(token)];
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

    renderTiles();
    renderChart();
    renderLines();
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
      if (live instanceof Error) {
        body = `<p class="tile-empty">${live.status === 404 ? 'TfL doesn’t publish live crowding for this station.' : esc(live.message)}</p>`;
      } else if (!live || !live.available) {
        body = '<p class="tile-empty">No live reading right now (the feed may be paused overnight or for this station).</p>';
      } else {
        // timeLocal is London time without an offset, so show its clock time as-is.
        const when = /T(\d{2}:\d{2})/.exec(live.timeLocal || '');
        body = `
          <div class="tile-value">${pct(live.value)}<span class="tile-unit">of baseline</span></div>
          <div class="tile-level">${levelBadge(live.value)}</div>
          <div class="tile-delta">${deltaText(live.value, typical)}${typical !== null ? `<span class="muted"> · usual now ${pct(typical)}</span>` : ''}</div>
          ${when ? `<div class="muted small">Reading at ${esc(when[1])}</div>` : ''}`;
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
      const outlook = platformOutlook(stationValue, status, platforms);

      const statusHtml = status
        ? `<span class="status status-${status.cls}"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[status.cls]}</span>${esc(status.description)}</span>`
        : `<span class="status status-info"><span class="status-icon" aria-hidden="true">ℹ</span>${state.statusError ? 'Status unavailable' : 'No status'}</span>`;

      const crowdHtml = stationValue === null
        ? `<p class="muted small">No live crowding reading for ${esc(naptan ? naptan.label : 'this station')} right now.</p>`
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

      const loadingHtml = loadings.length
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
        <article class="line-card" style="--line:${esc(line.colour)}">
          <header class="line-head">
            <div class="line-title"><h3>${esc(line.name)}</h3><span class="muted small">${esc(T.MODE_LABELS[line.mode] || line.mode)}</span></div>
            ${statusHtml}
          </header>
          ${reasons}
          <div class="crowd">${crowdHtml}${outlookHtml}</div>
          ${loadingHtml}
          <div class="arrivals"><div class="section-label">Next trains</div>${arrivalsHtml}</div>
        </article>`;
    }).join('');
    $('#lines').innerHTML = html;
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
    if (DEMO) $('#settings-open').hidden = true;

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => state.station && renderChart(), 150);
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
