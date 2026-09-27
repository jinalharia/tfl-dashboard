/*
 * South Western Railway (SWR) client and shared pure helpers for the SWR tab.
 *
 * Endpoints (all send Access-Control-Allow-Origin: *):
 *   GET  https://railinfo.southwesternrailway.com/journey/departures/{CRS}   SWR live departures board
 *   POST https://railinfo.southwesternrailway.com/journey/services           calling points, body {"ServiceId": id}
 *   GET  https://huxley2.azurewebsites.net/departures/{CRS}/40               National Rail live departures
 *                                                                            (community wrapper; optional)
 *   GET  https://huxley2.azurewebsites.net/service/{serviceID}               National Rail service details
 *   GET  data/swr/{path}                                                     snapshots published by the site
 *
 * Every fetch wrapper returns parsed JSON or throws an Error (with .status for HTTP errors),
 * except snapshot(), which returns null on any failure. With ?demo in the URL, every request
 * goes through SwrApi.demoRoutes instead of the network (see createDemoFetch).
 *
 * Everything these sources send is untrusted, and several fields are HTML. Never put it into
 * innerHTML: use htmlToText() + renderParagraphs(), esc() or textContent.
 *
 * Classic script (no modules) so index.html also works when opened from disk; also exported
 * for Node so the pure helpers can be unit-tested.
 */
(function (root) {
  'use strict';

  const RAILINFO_BASE = 'https://railinfo.southwesternrailway.com';
  const HUXLEY_BASE = 'https://huxley2.azurewebsites.net';
  const SNAPSHOT_BASE = 'data/swr/';
  const HUXLEY_ROWS = 40;
  const LIVE_TTL_MS = 30 * 1000;
  const SNAPSHOT_TTL_MS = 60 * 1000;
  const TIMEOUT_MS = 20 * 1000;
  const SAFE_LINK_DOMAINS = ['southwesternrailway.com', 'nationalrail.co.uk', 'networkrail.co.uk', 'tfl.gov.uk'];
  const SWR_LINE_ID = 'south-western-railway';
  const TABS = ['tfl', 'swr'];

  // ---------------------------------------------------------------------------
  // Stations
  // ---------------------------------------------------------------------------

  let stationList = null;
  let stationIndex = null;

  /** The generated SWR_STATIONS list (js/swr-stations.js), in the browser or in Node. */
  function stations() {
    let list = root.SWR_STATIONS;
    if (!Array.isArray(list) && typeof module !== 'undefined' && typeof require === 'function') {
      try { list = require('./swr-stations.js'); } catch (e) { list = null; }
    }
    return Array.isArray(list) ? list : [];
  }

  /** stationByCrs('wat') → {crs: 'WAT', name: 'London Waterloo', …} | null */
  function stationByCrs(crs) {
    const list = stations();
    if (list !== stationList) {
      stationList = list;
      stationIndex = new Map(list.map((s) => [s.crs, s]));
    }
    return stationIndex.get(String(crs || '').trim().toUpperCase()) || null;
  }

  const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /**
   * Picker search over the station list by name or CRS code, best first: exact CRS code, then
   * names starting with the query, then a word starting with it, then containing it.
   */
  function searchStations(query, list, limit) {
    const q = fold(query);
    if (!q) return [];
    const upper = String(query).trim().toUpperCase();
    const scored = [];
    for (const s of list || stations()) {
      const name = fold(s.name);
      let score = -1;
      if (s.crs === upper) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if ((' ' + name).includes(' ' + q)) score = 2;
      else if (name.includes(q)) score = 3;
      if (score >= 0) scored.push({ s, score });
    }
    scored.sort((a, b) => a.score - b.score || a.s.name.localeCompare(b.s.name, 'en-GB'));
    return scored.slice(0, limit || 10).map((x) => x.s);
  }

  /**
   * The SWR station for a TfL /StopPoint/{id} response (the TfL tab keeps it as station.stop),
   * when the stop or one of its children lists the south-western-railway line. Matched on the
   * child's NaPTAN (910GWATRLMN) or the hub id (HUBWAT). → station | null
   */
  function swrStationForTflStop(stop, list) {
    if (!stop || typeof stop !== 'object') return null;
    const all = list || stations();
    const byNaptan = new Map();
    const byHub = new Map();
    for (const s of all) {
      if (s.naptan) byNaptan.set(s.naptan, s);
      if (s.tflHub && !byHub.has(s.tflHub)) byHub.set(s.tflHub, s);
    }
    const nodes = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      nodes.push(n);
      (n.children || []).forEach(walk);
    })(stop);
    const servesSwr = (n) => (n.lines || []).some((l) => l && (l.id === SWR_LINE_ID || l === SWR_LINE_ID));
    const served = nodes.filter(servesSwr);
    for (const n of served) {
      const hit = byNaptan.get(n.naptanId || n.id);
      if (hit) return hit;
    }
    for (const n of served) {
      const hit = byHub.get(n.hubNaptanCode) || byHub.get(n.naptanId || n.id);
      if (hit) return hit;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Tab and URL state
  // ---------------------------------------------------------------------------

  /** A CRS code from user input or the URL, or null. */
  function normalizeCrs(value) {
    const crs = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(crs) ? crs : null;
  }

  /**
   * Which tab to open and with what, from location.search and the remembered tab
   * (localStorage 'tfl.tab'). ?tab= wins; otherwise ?swr= alone means SWR and ?station= alone
   * means TfL; otherwise the remembered tab, else TfL.
   * → {tab: 'tfl'|'swr', swr: 'WAT'|null, station: '940GZZLUWLO'|null, demo: bool}
   */
  function tabState(search, storedTab) {
    const p = new URLSearchParams(search || '');
    const asked = String(p.get('tab') || '').toLowerCase();
    const swr = normalizeCrs(p.get('swr'));
    const station = p.get('station') || null;
    let tab;
    if (TABS.includes(asked)) tab = asked;
    else if (p.has('swr') && !station) tab = 'swr';
    else if (station && !p.has('swr')) tab = 'tfl';
    else tab = TABS.includes(storedTab) ? storedTab : 'tfl';
    return { tab, swr, station, demo: p.has('demo') };
  }

  /**
   * location.search with the tab and/or SWR station changed, keeping every other parameter
   * (demo, station). tab 'tfl' is the default, so it drops ?tab=. swr: null removes it.
   */
  function tabSearch(search, changes) {
    const p = new URLSearchParams(search || '');
    const c = changes || {};
    if ('tab' in c) {
      if (c.tab === 'swr') p.set('tab', 'swr');
      else p.delete('tab');
    }
    if ('swr' in c) {
      const crs = normalizeCrs(c.swr);
      if (crs) p.set('swr', crs);
      else p.delete('swr');
    }
    // URLSearchParams writes a bare flag as "demo="; keep it as "demo".
    const qs = p.toString().replace(/(^|&)demo=(?=&|$)/, '$1demo');
    return qs ? `?${qs}` : '';
  }

  // ---------------------------------------------------------------------------
  // Times
  // ---------------------------------------------------------------------------

  const londonParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });

  function londonFields(ms) {
    const out = {};
    for (const p of londonParts.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
    return out;
  }

  /** Minutes London is ahead of UTC at this instant (0 or 60). */
  function londonOffsetMinutes(ms) {
    const f = londonFields(ms);
    return Math.round((Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000) / 60000);
  }

  /** A London wall-clock time → Date. */
  function fromLondon(y, mo, d, h, mi, s) {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    let ms = guess - londonOffsetMinutes(guess) * 60000;
    ms = guess - londonOffsetMinutes(ms) * 60000; // settle across a clock change
    return new Date(ms);
  }

  /**
   * Parses the time formats SWR and National Rail send → Date, or null for anything else
   * ("On time", "Cancelled", "Delayed", null).
   *   "19:21"                   London time on the day of `now` (default: now), moved a day
   *                             forward or back when that puts it more than 12 hours away, so
   *                             "00:10" on a board read at 23:50 is tomorrow
   *   "19:18:22 27/09/2026"     London date and time (SWR's UpdatedTime)
   *   ISO 8601                  with an offset as given; without one, London time
   */
  function parseUkTime(str, now) {
    if (str instanceof Date) return Number.isNaN(str.getTime()) ? null : str;
    const text = String(str === null || str === undefined ? '' : str).trim();
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (m) {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h > 23 || mi > 59) return null;
      const ref = now instanceof Date ? now.getTime() : (Number.isFinite(now) ? now : Date.now());
      const f = londonFields(ref);
      let d = fromLondon(f.year, f.month, f.day, h, mi, Number(m[3] || 0));
      const HALF_DAY = 12 * 3600 * 1000;
      if (d.getTime() - ref > HALF_DAY) {
        const y = londonFields(ref - 24 * 3600 * 1000);
        d = fromLondon(y.year, y.month, y.day, h, mi, Number(m[3] || 0));
      } else if (ref - d.getTime() > HALF_DAY) {
        const t = londonFields(ref + 24 * 3600 * 1000);
        d = fromLondon(t.year, t.month, t.day, h, mi, Number(m[3] || 0));
      }
      return d;
    }
    m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (m) {
      const [h, mi, s, d, mo, y] = [m[1], m[2], m[3] || 0, m[4], m[5], m[6]].map(Number);
      if (h > 23 || mi > 59 || s > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return fromLondon(y, mo, d, h, mi, s);
    }
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
    if (m) {
      if (!m[7]) return fromLondon(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
      // Trim fractions beyond milliseconds (.NET sends 7 digits) before handing it to Date.
      const iso = text.replace(/(\.\d{3})\d+/, '$1').replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // HTML → safe paragraphs
  // ---------------------------------------------------------------------------

  /**
   * An href we're willing to link to: https on southwesternrailway.com, nationalrail.co.uk,
   * networkrail.co.uk or tfl.gov.uk (or their subdomains), with no credentials. Repairs the
   * doubled scheme seen in real National Rail messages ("http://https://www.nationalrail…").
   * → the normalised URL string, or null.
   */
  function safeHref(raw) {
    let href = String(raw === null || raw === undefined ? '' : raw).trim();
    href = href.replace(/^https?:\/\/+(?=https?:\/\/)/i, '');
    if (!/^https:\/\//i.test(href)) return null;
    let url;
    try { url = new URL(href); } catch (e) { return null; }
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!SAFE_LINK_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) return null;
    return url.href;
  }

  const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', copy: '©',
  };
  function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      const v = ENTITIES[code.toLowerCase()];
      return v === undefined ? all : v;
    });
  }

  const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
  const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'head', 'title', 'iframe', 'object', 'embed', 'svg', 'math', 'select', 'textarea', 'button']);

  /** Collects text, line breaks and links into paragraphs; fed by the DOM walker or the regex tokenizer. */
  function paragraphBuilder() {
    const paras = [];
    let parts = [];
    let href = null;
    const lastText = () => (parts.length ? parts[parts.length - 1].text : '');
    const atLineStart = () => !parts.length || /\n$/.test(lastText());
    function add(text, link) {
      if (!text) return;
      const prev = parts[parts.length - 1];
      if (prev && (prev.href || null) === (link || null)) prev.text += text;
      else parts.push(link ? { text, href: link } : { text });
    }
    function trimEnd() {
      while (parts.length) {
        const p = parts[parts.length - 1];
        p.text = p.text.replace(/[ \t]+$/, '');
        if (p.text) break;
        parts.pop();
      }
    }
    return {
      text(raw) {
        let t = String(raw).replace(/\s+/g, ' ');
        if (atLineStart()) t = t.replace(/^ /, '');
        else if (/ $/.test(lastText()) && t[0] === ' ') t = t.slice(1);
        add(t, href);
      },
      br() {
        trimEnd();
        if (!parts.length) return;
        if (/\n$/.test(lastText())) {
          // A blank line (<br><br>) ends the paragraph.
          const p = parts[parts.length - 1];
          p.text = p.text.replace(/\n$/, '');
          this.block();
          return;
        }
        add('\n', href);
      },
      block() {
        trimEnd();
        while (parts.length && /^\n*$/.test(parts[parts.length - 1].text)) parts.pop();
        const last = parts[parts.length - 1];
        if (last) last.text = last.text.replace(/\n+$/, '');
        const clean = parts.filter((p) => p.text);
        if (clean.length) paras.push(clean);
        parts = [];
      },
      linkStart(raw) { href = safeHref(raw); },
      linkEnd() { href = null; },
      done() {
        this.block();
        return paras.map(finishParagraph);
      },
    };
  }

  // Bare https URLs in text (e.g. SWR's FurtherInfo) become links when they're on a safe domain.
  const BARE_URL = /https?:\/\/(?:https?:\/\/)?[^\s<>"']+/gi;
  function linkifyParts(parts) {
    const out = [];
    const push = (text, href) => {
      if (!text) return;
      const prev = out[out.length - 1];
      if (prev && !prev.href && !href) prev.text += text;
      else out.push(href ? { text, href } : { text });
    };
    for (const p of parts) {
      if (p.href) { push(p.text, p.href); continue; }
      let last = 0;
      p.text.replace(BARE_URL, (match, offset) => {
        const url = match.replace(/[.,;:!?)\]]+$/, '');
        const href = safeHref(url);
        if (href) {
          push(p.text.slice(last, offset));
          push(url, href);
          last = offset + url.length;
        }
        return match;
      });
      push(p.text.slice(last));
    }
    return out;
  }

  function finishParagraph(rawParts) {
    const parts = linkifyParts(rawParts.map((p) => ({ ...p })));
    if (parts.length) {
      parts[0].text = parts[0].text.replace(/^\s+/, '');
      parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, '');
    }
    const kept = parts.filter((p) => p.text);
    return {
      text: kept.map((p) => p.text).join(''),
      parts: kept,
      links: kept.filter((p) => p.href).map((p) => ({ text: p.text, href: p.href })),
    };
  }

  function walkDom(node, b) {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { b.text(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.nodeName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === 'br') { b.br(); continue; }
      if (tag === 'img') { if (n.getAttribute('alt')) b.text(n.getAttribute('alt')); continue; }
      const block = BLOCK_TAGS.has(tag);
      if (block) b.block();
      if (tag === 'li') b.text('• ');
      if (tag === 'a') b.linkStart(n.getAttribute('href'));
      walkDom(n, b);
      if (tag === 'a') b.linkEnd();
      if (block) b.block();
    }
  }

  function walkRegex(html, b) {
    const src = String(html).replace(/<!--[\s\S]*?-->/g, '');
    // As in HTML, "<" starts a tag only when a letter (or "/" and a letter) follows it.
    const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let last = 0;
    let skip = null;
    let m;
    while ((m = TAG.exec(src))) {
      const between = src.slice(last, m.index);
      last = TAG.lastIndex;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      if (skip) {
        if (closing && tag === skip) skip = null;
        continue;
      }
      if (between) b.text(decodeEntities(between));
      if (SKIP_TAGS.has(tag)) {
        if (!closing && !/\/\s*$/.test(m[3])) skip = tag;
        continue;
      }
      if (tag === 'br') { b.br(); continue; }
      if (tag === 'img') {
        const alt = /\balt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
        if (alt && !closing) b.text(decodeEntities(alt[2] || alt[3] || alt[4] || ''));
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        b.block();
        if (tag === 'li' && !closing) b.text('• ');
      }
      if (tag === 'a') {
        if (closing) b.linkEnd();
        else {
          const h = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
          b.linkStart(h ? decodeEntities(h[2] !== undefined ? h[2] : h[3] !== undefined ? h[3] : h[4]) : null);
        }
      }
    }
    if (!skip) b.text(decodeEntities(src.slice(last)));
  }

  /**
   * SWR and National Rail HTML (incident Details, nrccMessages) → plain paragraphs that are
   * safe to render. Uses DOMParser in the browser (inert: no scripts run, nothing loads) and a
   * regex tokenizer in Node; both give the same result.
   *
   * Returns [{text, parts, links}], one per paragraph:
   *   text   the paragraph as plain text; "\n" marks a single <br>
   *   parts  [{text}, {text, href}, …] in order, to build DOM from (renderParagraphs does this)
   *   links  [{text, href}], the parts that are links
   * Paragraphs come from block elements (<p>, <div>, <li> …) and blank lines (<br><br>).
   * Links are kept only when safeHref() accepts them; otherwise their text stays as plain text.
   * Bare safe https URLs in the text are made links too.
   */
  function htmlToText(html) {
    if (html === null || html === undefined) return [];
    const src = String(html);
    if (!src.trim()) return [];
    const b = paragraphBuilder();
    if (typeof root.DOMParser === 'function') {
      const doc = new root.DOMParser().parseFromString(src, 'text/html');
      walkDom(doc.body, b);
    } else {
      walkRegex(src, b);
    }
    return b.done();
  }

  /**
   * htmlToText() paragraphs → a DocumentFragment of <p> elements, built with textContent and
   * <a> elements only (links re-checked with safeHref, opened in a new tab). Browser only.
   */
  function renderParagraphs(paragraphs, doc) {
    const d = doc || root.document;
    const frag = d.createDocumentFragment();
    for (const para of paragraphs || []) {
      const p = d.createElement('p');
      for (const part of para.parts || [{ text: para.text }]) {
        const href = part.href ? safeHref(part.href) : null;
        const target = href ? d.createElement('a') : p;
        if (href) {
          target.href = href;
          target.target = '_blank';
          target.rel = 'noopener noreferrer';
          p.appendChild(target);
        }
        String(part.text || '').split('\n').forEach((line, i) => {
          if (i) target.appendChild(d.createElement('br'));
          if (line) target.appendChild(d.createTextNode(line));
        });
      }
      frag.appendChild(p);
    }
    return frag;
  }

  // ---------------------------------------------------------------------------
  // Fetching, caching and demo mode
  // ---------------------------------------------------------------------------

  /**
   * Demo fixtures, added by each package from its own file:
   *   SwrApi.demoRoutes.push((url, options) => body | null)
   * A route returns a JSON-able body when it handles the URL (url is the full request URL, or
   * 'data/swr/…' for snapshots; options is the fetch init, e.g. {method: 'POST', body}), or
   * null when it doesn't. The first non-null answer wins; a URL no route handles is a 404.
   */
  const demoRoutes = [];

  const config = {
    fetch: null,
    demo: Boolean(root.location && typeof root.location.search === 'string' && new URLSearchParams(root.location.search).has('demo')),
  };

  /** Override the fetch implementation or demo mode (used by tests). */
  function configure(options) {
    const o = options || {};
    if ('fetch' in o) config.fetch = o.fetch;
    if ('demo' in o) config.demo = Boolean(o.demo);
  }

  function isDemo() { return config.demo; }

  /**
   * A fetch that answers from demoRoutes, then from `fallback` (another fetch, e.g. the TfL
   * demo's), else 404. Responses arrive after a short delay, like the TfL demo.
   */
  function createDemoFetch(fallback) {
    return async function demoFetch(url, options) {
      const u = String(url);
      for (const routeFn of demoRoutes) {
        const body = routeFn(u, options || {});
        if (body !== null && body !== undefined) {
          await new Promise((r) => setTimeout(r, 80 + Math.random() * 160));
          const copy = JSON.parse(JSON.stringify(body));
          return { ok: true, status: 200, json: async () => copy };
        }
      }
      if (fallback) return fallback(url, options);
      await new Promise((r) => setTimeout(r, 80));
      return { ok: false, status: 404, json: async () => null };
    };
  }

  let demoFetchImpl = null;
  function fetchImpl() {
    if (config.demo) return demoFetchImpl || (demoFetchImpl = createDemoFetch(null));
    if (config.fetch) return config.fetch;
    return (...args) => root.fetch(...args);
  }

  async function request(url, init, source) {
    const opts = { ...(init || {}) };
    let timer = null;
    if (!config.demo && typeof AbortController === 'function') {
      const ac = new AbortController();
      opts.signal = ac.signal;
      timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    }
    let res;
    try {
      res = await fetchImpl()(url, opts);
    } catch (e) {
      const err = new Error(`Couldn't reach ${source}`);
      err.cause = e;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const err = new Error(`${source} returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const cache = new Map();

  /**
   * Shares one call to fn() per key for ttlMs: callers within that time get the same promise
   * (including one still in flight). A rejected promise is forgotten, so the next call retries.
   */
  function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    const entry = { at: Date.now() };
    entry.promise = Promise.resolve().then(fn);
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    cache.set(key, entry);
    return entry.promise;
  }

  function clearCache() { cache.clear(); }

  function crsOrThrow(crs) {
    const c = normalizeCrs(crs);
    if (!c) throw new Error(`Not a station code: ${crs}`);
    return c;
  }

  /** SWR live departures for a station (CRS code only), cached for 30 s. */
  function departures(crs) {
    return Promise.resolve().then(() => {
      const c = crsOrThrow(crs);
      return cached(`departures:${c}`, LIVE_TTL_MS, () =>
        request(`${RAILINFO_BASE}/journey/departures/${c}`, { headers: { Accept: 'application/json' } }, 'SWR live train info'));
    });
  }

  /** Calling points for a railinfo departure Id (the same value as Huxley's serviceID). Not cached. */
  function service(id) {
    return request(`${RAILINFO_BASE}/journey/services`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ServiceId: String(id) }),
    }, 'SWR live train info');
  }

  /** National Rail departures via Huxley2 (40 rows), cached for 30 s and shared by S1 and S3. */
  function huxleyDepartures(crs) {
    return Promise.resolve().then(() => {
      const c = crsOrThrow(crs);
      return cached(`huxley:${c}`, LIVE_TTL_MS, () =>
        request(`${HUXLEY_BASE}/departures/${c}/${HUXLEY_ROWS}`, { headers: { Accept: 'application/json' } }, 'Huxley2 (National Rail live data)'));
    });
  }

  /** National Rail service details via Huxley2. Not cached. */
  function huxleyService(id) {
    return request(`${HUXLEY_BASE}/service/${encodeURIComponent(String(id))}`, { headers: { Accept: 'application/json' } }, 'Huxley2 (National Rail live data)');
  }

  /**
   * A file the site publishes under data/swr/ (e.g. 'status.json', 'seats/WOK.json'), cached
   * for 60 s. Returns null on any failure, including opening index.html from disk.
   */
  function snapshot(path) {
    const p = String(path || '');
    if (!p || /^[/\\]|\.\.|:/.test(p)) return Promise.resolve(null);
    // Opened from disk: browsers refuse fetch() of file: URLs (and log an error), so don't try.
    // Demo mode still answers from demoRoutes.
    if (!config.demo && root.location && root.location.protocol === 'file:') return Promise.resolve(null);
    return cached(`snapshot:${p}`, SNAPSHOT_TTL_MS, async () => {
      try {
        const res = await fetchImpl()(SNAPSHOT_BASE + p, { headers: { Accept: 'application/json' } });
        if (!res || !res.ok) return null;
        return await res.json();
      } catch (e) {
        return null;
      }
    });
  }

  const api = {
    // fetch wrappers
    departures,
    service,
    huxleyDepartures,
    huxleyService,
    snapshot,
    cached,
    // shared helpers
    htmlToText,
    renderParagraphs,
    safeHref,
    parseUkTime,
    stationByCrs,
    stations,
    searchStations,
    swrStationForTflStop,
    normalizeCrs,
    tabState,
    tabSearch,
    // demo mode
    demoRoutes,
    createDemoFetch,
    isDemo,
    configure,
    clearCache,
    // constants
    RAILINFO_BASE,
    HUXLEY_BASE,
    SNAPSHOT_BASE,
    HUXLEY_ROWS,
    SAFE_LINK_DOMAINS,
    SWR_LINE_ID,
  };

  root.SwrApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
