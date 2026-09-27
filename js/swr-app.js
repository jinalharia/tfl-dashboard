/*
 * The TfL / SWR tab bar and the South Western Railway tab: station picker, station header,
 * refresh timer and the module lifecycle the SWR packages plug into.
 *
 * Each package file (js/swr-departures.js, …) ends with:
 *
 *   if (typeof window !== 'undefined' && window.SwrApp) SwrApp.register({
 *     id: 'departures',               // renders into <section id="swr-departures">, hidden until shown
 *     init(ctx) {},                   // optional: once, when the SWR tab is first opened (before any station)
 *     onStation(station, ctx) {},     // a station was chosen; show the section if there's something to show
 *     refresh(station, ctx) {},       // every 60 s while the SWR tab is visible and Auto-refresh is on,
 *                                     // and on "Refresh now"
 *   });
 *
 * station is an SWR_STATIONS entry, never null. Return a promise from onStation/refresh so the
 * "Updated …" time is set once every module has finished. A module that throws or rejects is
 * logged and doesn't affect the others.
 *
 * ctx = {api: SwrApi, tfl: TflApi client (reads the Settings app key), esc, demo: bool, token,
 *        isStale(): true once the station has changed since this ctx was made}
 * token changes whenever the station changes; drop late responses whose token is stale, like
 * loadStation() does in js/app.js.
 *
 * Nothing on the SWR tab makes a request until the tab is first opened. The tab choice is
 * applied as soon as this script runs, so js/app.js (which starts on DOMContentLoaded) can see
 * whether the TfL tab is hidden and hold back its requests.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const A = window.SwrApi;
  const REFRESH_MS = 60 * 1000;
  const QUICK_PICKS = ['WAT', 'VXH', 'CLJ', 'WIM', 'SUR', 'RMD', 'WOK', 'GLD'];
  const TAGLINES = {
    tfl: 'Every line at a London station, from the TfL API',
    swr: 'South Western Railway trains at a station, from SWR and National Rail',
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  const initial = A.tabState(location.search, store.get('tfl.tab'));
  const DEMO = initial.demo;
  if (DEMO) A.configure({ demo: true });

  const modules = [];
  const state = {
    tab: null,
    ready: false, // DOMContentLoaded has run: every module has registered
    opened: false, // the SWR tab has been shown at least once
    pendingCrs: initial.swr, // station to open when the SWR tab is first shown
    station: null,
    token: 0,
    busy: false,
    updatedAt: null,
    tflTitle: null,
    results: [],
    activeIdx: -1,
    tfl: null,
    tflKey: undefined,
  };

  // ---------------------------------------------------------------------------
  // Module registry and lifecycle
  // ---------------------------------------------------------------------------

  function register(mod) {
    if (!mod || typeof mod.id !== 'string' || !mod.id) throw new Error('SwrApp.register needs an id');
    const existing = modules.findIndex((m) => m.id === mod.id);
    if (existing >= 0) modules.splice(existing, 1, mod);
    else modules.push(mod);
    // A module registered after the tab opened (e.g. added in the console) catches up.
    if (state.opened) {
      call(mod, 'init', makeCtx());
      if (state.station) call(mod, 'onStation', state.station, makeCtx());
    }
    return mod;
  }

  /** A TfL client for the SWR modules, with the Settings app key (and the demo data in ?demo). */
  function tflClient() {
    const key = DEMO ? null : store.get('tfl.appKey');
    if (!state.tfl || key !== state.tflKey) {
      state.tflKey = key;
      state.tfl = window.TflApi.createClient({
        appKey: key,
        // In demo mode, SwrApi.demoRoutes answer first (e.g. /Line/south-western-railway/Status), then the TfL demo.
        fetch: DEMO ? A.createDemoFetch(window.TflDemo ? window.TflDemo.createFetch() : null) : undefined,
      });
    }
    return state.tfl;
  }

  function makeCtx() {
    const token = state.token;
    return { api: A, tfl: tflClient(), esc, demo: DEMO, token, isStale: () => token !== state.token };
  }

  function call(mod, hook, ...args) {
    if (typeof mod[hook] !== 'function') return Promise.resolve();
    try {
      return Promise.resolve(mod[hook](...args)).catch((e) => console.error(`SWR module "${mod.id}" ${hook}() failed:`, e));
    } catch (e) {
      console.error(`SWR module "${mod.id}" ${hook}() failed:`, e);
      return Promise.resolve();
    }
  }

  async function runModules(hook) {
    const token = state.token;
    const ctx = makeCtx();
    await Promise.all(modules.map((m) => call(m, hook, state.station, ctx)));
    if (token !== state.token) return;
    state.updatedAt = new Date();
    renderUpdated();
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  function tabButtons() {
    return [...document.querySelectorAll('#tabs [role="tab"]')];
  }

  function setUrl(changes) {
    const search = A.tabSearch(location.search, changes);
    if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash);
  }

  /** Show a tab. Remembered as localStorage 'tfl.tab' and in the URL (?tab=swr). */
  function selectTab(tab, options) {
    const opts = options || {};
    if (tab !== 'swr') tab = 'tfl';
    const changed = tab !== state.tab;
    const previous = state.tab;
    state.tab = tab;
    for (const btn of tabButtons()) {
      const on = btn.dataset.tab === tab;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on && opts.focus) btn.focus();
    }
    $('#tab-tfl').hidden = tab !== 'tfl';
    $('#tab-swr').hidden = tab !== 'swr';
    $('#search-form').hidden = tab !== 'tfl';
    $('#swr-search-form').hidden = tab !== 'swr';
    const tagline = $('.tagline');
    if (tagline) tagline.textContent = TAGLINES[tab];
    store.set('tfl.tab', tab === 'swr' ? 'swr' : null);
    if (!opts.keepUrl) setUrl({ tab });

    if (!changed) return;
    if (tab === 'swr') {
      state.tflTitle = document.title;
      updateTitle();
    } else if (previous === 'swr' && state.tflTitle !== null) {
      document.title = state.tflTitle;
    }
    if (state.ready) {
      document.dispatchEvent(new CustomEvent('dashboard:tabchange', { detail: { tab } }));
      if (tab === 'swr') onSwrShown();
    }
  }

  function onTabKey(e) {
    const tabs = tabButtons();
    const i = tabs.indexOf(e.target);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next.dataset.tab, { focus: true });
  }

  /** The SWR tab became visible: first time, start the modules; later, catch up if stale. */
  function onSwrShown() {
    if (!state.opened) {
      state.opened = true;
      const ctx = makeCtx();
      for (const m of modules) call(m, 'init', ctx);
      const crs = state.pendingCrs;
      state.pendingCrs = null;
      if (crs) chooseStation(crs);
      return;
    }
    if (state.station && autoRefresh() && isStale()) refresh();
  }

  // ---------------------------------------------------------------------------
  // Station choice and refresh
  // ---------------------------------------------------------------------------

  function autoRefresh() {
    return $('#swr-auto-refresh').checked;
  }

  function isStale() {
    return !state.updatedAt || Date.now() - state.updatedAt.getTime() >= REFRESH_MS;
  }

  function updateTitle() {
    if (state.tab !== 'swr') return;
    document.title = state.station ? `${state.station.name} (${state.station.crs}) · SWR trains` : 'South Western Railway · Live station crowding';
  }

  function chooseStation(crs) {
    const station = A.stationByCrs(crs);
    if (!station) {
      showMessage(`There's no South Western Railway station with the code ${String(crs).toUpperCase()}. Search for one above.`, 'error');
      return;
    }
    state.token += 1;
    state.station = station;
    state.updatedAt = null;
    $('#swr-search').value = station.name;
    setUrl({ swr: station.crs });
    updateTitle();
    renderHeader();
    runModules('onStation');
  }

  async function refresh() {
    if (!state.station || state.busy) return;
    state.busy = true;
    const view = $('#swr-main');
    view.classList.add('is-refreshing');
    try {
      await runModules('refresh');
    } finally {
      state.busy = false;
      view.classList.remove('is-refreshing');
    }
  }

  function tick() {
    if (state.tab !== 'swr' || document.visibilityState === 'hidden' || !state.station || !autoRefresh()) return;
    refresh();
  }

  /** Switch to the SWR tab at a station (the TfL tab's "SWR trains from here" uses this). */
  function open(crs) {
    const station = A.stationByCrs(crs);
    if (!station) return false;
    if (state.opened) {
      if (!state.station || state.station.crs !== station.crs) chooseStation(station.crs);
    } else {
      state.pendingCrs = station.crs;
    }
    selectTab('swr');
    window.scrollTo({ top: 0 });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function showMessage(text, kind) {
    const box = $('#swr-message');
    box.hidden = false;
    box.className = `message message-${kind || 'info'}`;
    box.textContent = text;
    $('#swr-station-head').hidden = true;
  }

  function renderUpdated() {
    $('#swr-updated').textContent = state.updatedAt
      ? `Updated ${state.updatedAt.toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })}`
      : 'Loading…';
  }

  function renderHeader() {
    const s = state.station;
    $('#swr-message').hidden = true;
    $('#swr-station-head').hidden = false;
    $('#swr-demo-banner').hidden = !DEMO;
    $('#swr-station-name').textContent = s.name;
    const meta = $('#swr-station-meta');
    meta.textContent = '';
    const code = document.createElement('span');
    code.textContent = 'Station code ';
    const abbr = document.createElement('code');
    abbr.className = 'swr-crs';
    abbr.textContent = s.crs;
    code.appendChild(abbr);
    meta.appendChild(code);
    if (s.tflHub || s.naptan) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link swr-to-tfl';
      b.textContent = 'Open in TfL tab';
      b.addEventListener('click', () => openInTfl(s));
      meta.appendChild(b);
    }
    if (s.url && s.url.startsWith('/')) {
      const a = document.createElement('a');
      a.href = `https://www.southwesternrailway.com${s.url}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Station page on southwesternrailway.com';
      meta.appendChild(a);
    }
    renderUpdated();
  }

  function openInTfl(s) {
    const id = s.tflHub || s.naptan;
    if (window.TflApp && typeof window.TflApp.openStation === 'function') window.TflApp.openStation(id);
    selectTab('tfl');
    window.scrollTo({ top: 0 });
  }

  function renderQuickPicks() {
    const nav = $('#swr-quick-picks');
    nav.textContent = '';
    for (const crs of QUICK_PICKS) {
      const s = A.stationByCrs(crs);
      if (!s) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = s.name;
      b.addEventListener('click', () => chooseStation(s.crs));
      nav.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------------
  // Station picker (same keyboard behaviour as the TfL search)
  // ---------------------------------------------------------------------------

  function renderResults(message) {
    const list = $('#swr-search-results');
    const input = $('#swr-search');
    list.textContent = '';
    if (message) {
      const li = document.createElement('li');
      li.className = 'result-msg';
      li.textContent = message;
      list.appendChild(li);
    }
    state.results.forEach((s, i) => {
      const li = document.createElement('li');
      li.id = `swr-result-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === state.activeIdx));
      li.className = 'result' + (i === state.activeIdx ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = s.name;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = [s.crs, s.tflHub ? 'Also on the TfL tab' : ''].filter(Boolean).join(' — ');
      li.append(name, meta);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); chooseResult(i); });
      list.appendChild(li);
    });
    const open = Boolean(message) || state.results.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    input.setAttribute('aria-activedescendant', state.activeIdx >= 0 ? `swr-result-${state.activeIdx}` : '');
  }

  function closeResults() {
    state.results = [];
    state.activeIdx = -1;
    renderResults();
  }

  function chooseResult(i) {
    const s = state.results[i];
    if (!s) return;
    closeResults();
    if (!state.opened) { state.pendingCrs = s.crs; selectTab('swr'); return; }
    chooseStation(s.crs);
  }

  function onSearchInput() {
    const q = $('#swr-search').value.trim();
    if (q.length < 2) return closeResults();
    state.results = A.searchStations(q, null, 10);
    state.activeIdx = state.results.length ? 0 : -1;
    renderResults(state.results.length ? null : 'No South Western Railway stations match');
  }

  function onSearchKey(e) {
    const n = state.results.length;
    if (e.key === 'ArrowDown' && n) { state.activeIdx = (state.activeIdx + 1) % n; renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && n) { state.activeIdx = (state.activeIdx - 1 + n) % n; renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (state.activeIdx >= 0) chooseResult(state.activeIdx); }
    else if (e.key === 'Escape') closeResults();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  // Apply the tab straight away (before js/app.js starts), so the hidden tab makes no requests.
  selectTab(initial.tab, { keepUrl: true });

  function init() {
    state.ready = true;
    for (const btn of tabButtons()) {
      btn.addEventListener('click', () => selectTab(btn.dataset.tab));
      btn.addEventListener('keydown', onTabKey);
    }
    renderQuickPicks();
    const input = $('#swr-search');
    input.addEventListener('input', onSearchInput);
    input.addEventListener('keydown', onSearchKey);
    input.addEventListener('blur', () => setTimeout(closeResults, 150));
    $('#swr-search-form').addEventListener('submit', (e) => e.preventDefault());

    const auto = $('#swr-auto-refresh');
    auto.checked = store.get('swr.autoRefresh') !== '0';
    auto.addEventListener('change', () => {
      store.set('swr.autoRefresh', auto.checked ? null : '0');
      if (auto.checked && state.tab === 'swr' && state.station && isStale()) refresh();
    });
    $('#swr-refresh-now').addEventListener('click', refresh);
    setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.tab === 'swr' && state.station && autoRefresh() && isStale()) refresh();
    });

    showMessage('Search for a South Western Railway station, or pick one above.', 'info');
    if (state.tab === 'swr') onSwrShown();
  }

  window.SwrApp = {
    register,
    open,
    selectTab,
    refresh,
    /** The chosen SWR station, or null. */
    station: () => state.station,
    /** The current station token (see ctx.token). */
    token: () => state.token,
    /** 'tfl' or 'swr'. */
    tab: () => state.tab,
    modules,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
