/*
 * SWR tab, package S3: service status (items SWR-4, SWR-5, SWR-6). Renders into <section id="swr-status">.
 *
 *   SWR-4 headline (live)       TfL  GET /Line/south-western-railway/Status   (ctx.tfl.getLineStatuses)
 *   SWR-5 status by route group snapshot data/swr/status.json → liveInformationBoard + rainbowBoard
 *   SWR-6 incident details      snapshot data/swr/status.json → overallstatus.LineUpdates[]
 *         + station messages    Huxley2 GET /departures/{CRS}/… → nrccMessages (SwrApi.huxleyDepartures, shared with S1)
 *
 * The SWR website API sends no CORS headers, so its three boards come from the snapshot that package S7
 * publishes (format: {fetchedAt, errors, overallstatus, liveInformationBoard, rainbowBoard}). Without it
 * (opened from disk, or before S7) the section shows the TfL headline and the Huxley messages only.
 *
 * Incident Details/FurtherInfo and nrccMessages are untrusted HTML: they're kept raw in the normalised data
 * (`detailsHtml`, `html`) and turned into plain paragraphs at render time by htmlParagraphs(), then escaped.
 *
 * Classic script; the pure helpers are also exported for Node tests.
 */
(function (root) {
  'use strict';

  const T = root.TflApi || (typeof require === 'function' ? require('./tfl-api.js') : null);

  const LINE_ID = 'south-western-railway';
  const STALE_MINUTES = 45;
  const HEADLINE_TTL_MS = 55 * 1000;
  const SNAPSHOT_TTL_MS = 55 * 1000;
  const OTHER_GROUP = 'Other routes';

  const STATUS_RANK = { good: 0, info: 1, warning: 2, serious: 3, critical: 4 };
  const STATUS_ICONS = { good: '✓', info: 'ℹ', warning: '!', serious: '!!', critical: '✕' };

  // /api/LiveInformationBoard StatusId → status class. 0, 2 and 4 were seen with those texts; 1 (Minor
  // Disruption) and 3 (Planned Closure) on the same evening. Any other id is mapped by its text.
  const ROUTE_STATUS_IDS = { 0: 'good', 1: 'warning', 2: 'critical', 3: 'serious', 4: 'info' };

  /*
   * /api/RainbowBoard Lines[].Description → /api/LiveInformationBoard RouteName.
   * SWR doesn't publish this link; it's this dashboard's own grouping by where each service runs.
   * Built from the full list of 49 descriptions fetched on 2026-09-27. Anything not listed here goes
   * into "Other routes", so a renamed or new service still shows up.
   */
  const ROUTE_GROUPS = {
    'Kingston/Shepperton': [
      'Waterloo to Shepperton', 'Shepperton to Waterloo',
      'Waterloo to London Waterloo via Kingston and Twickenham', 'Waterloo to London Waterloo via Twickenham and Kingston',
    ],
    'Chessington/Epsom': [
      'Waterloo to Chessington South', 'Chessington South to Waterloo',
      'Waterloo to Dorking', 'Dorking to Waterloo',
      'Waterloo to Guildford via Epsom', 'Guildford to Waterloo via Epsom',
    ],
    // All-stations trains on the main line through the suburbs (Surbiton, Esher, Walton, Woking…).
    'Suburban Lines': [
      'Woking to Waterloo (Stopping)', 'Waterloo to Basingstoke (Stopping)', 'Basingstoke to Waterloo (Stopping)',
    ],
    // Both branches leave the main line just past Surbiton.
    'Surbiton/Cobham': [
      'Waterloo to Guildford via Cobham', 'Guildford to Waterloo via Cobham',
      'Waterloo to Hampton Court', 'Hampton Court to Waterloo',
    ],
    'Hounslow Loop': [
      'Waterloo to London Waterloo via Richmond and Brentford', 'Waterloo to London Waterloo via Brentford and Richmond',
    ],
    'Reading/Windsor Lines': [
      'Waterloo to Reading via Richmond', 'Reading to Waterloo via Richmond',
      'Waterloo to Windsor & Eton Riverside', 'Windsor & Eton Riverside to Waterloo',
      'Waterloo to Weybridge via Staines', 'Weybridge to Waterloo via Staines',
    ],
    'South Western Mainline': [
      'Waterloo to Weymouth', 'Weymouth to Waterloo',
      'Waterloo to Portsmouth Harbour via Basingstoke', 'Portsmouth Harbour to Waterloo via Basingstoke',
      'Waterloo to Alton', 'Alton to Waterloo',
    ],
    'West of England': [
      'Waterloo to Salisbury/Yeovil/Exeter St Davids', 'Salisbury/Yeovil/Exeter St Davids to Waterloo',
    ],
    'Portsmouth Direct': [
      'Waterloo to Portsmouth via Guildford', 'Portsmouth to Waterloo via Guildford',
    ],
    'South Hampshire Locals': [
      'Southampton Central to Portsmouth & Southsea', 'Portsmouth & Southsea to Southampton Central',
      'Winchester to Southampton Central/Bournemouth', 'Southampton Central/Bournemouth to Winchester',
      'Lymington Branch',
    ],
    'Romsey/Salisbury': ['Romsey Rounders'],
    'Ascot/Guildford': [
      'Waterloo to Aldershot via Ascot', 'Aldershot to Waterloo via Ascot',
      'Ascot to Aldershot', 'Aldershot to Ascot',
      'Guildford to Farnham', 'Farnham to Guildford',
    ],
    'Island Line': ['Island Line'],
  };

  const normKey = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const GROUP_BY_DESCRIPTION = new Map();
  for (const [group, list] of Object.entries(ROUTE_GROUPS)) for (const d of list) GROUP_BY_DESCRIPTION.set(normKey(d), group);

  // Hosts whose links are kept (https only), matching SwrApi.htmlToText's rule.
  const LINK_HOSTS = ['southwesternrailway.com', 'nationalrail.co.uk', 'networkrail.co.uk', 'tfl.gov.uk'];

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------------------
  // Status classes
  // ---------------------------------------------------------------------------

  /** Status text from any SWR board → one of the TfL status classes (good/info/warning/serious/critical). */
  function statusClassFromText(text) {
    const t = clean(text).toLowerCase();
    if (!t) return 'info';
    if (/good service|normal service|running normally/.test(t)) return 'good';
    if (/closure|closed|part suspended/.test(t)) return 'serious';
    if (/major|severe|suspend|no service|cancel/.test(t)) return 'critical';
    if (/minor|delay|disrupt|alter/.test(t)) return 'warning';
    return 'info';
  }

  function routeStatusClass(statusId, text) {
    const id = String(statusId == null ? '' : statusId).trim();
    if (id !== '' && Object.prototype.hasOwnProperty.call(ROUTE_STATUS_IDS, id)) return ROUTE_STATUS_IDS[id];
    return statusClassFromText(text);
  }

  const worse = (a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);

  // ---------------------------------------------------------------------------
  // SWR-5: status by route group
  // ---------------------------------------------------------------------------

  /** /api/RainbowBoard → [{description, statusText, cls, incident}], exact duplicates dropped. */
  function normalizeRainbowRows(rainbowBoard) {
    const lines = rainbowBoard && Array.isArray(rainbowBoard.Lines) ? rainbowBoard.Lines : Array.isArray(rainbowBoard) ? rainbowBoard : [];
    const seen = new Set();
    const out = [];
    for (const l of lines) {
      if (!l) continue;
      const description = clean(l.Description);
      if (!description) continue;
      const statusText = clean(l.Status) || 'Status unknown';
      const incident = clean(l.Incidents); // " " means none
      const key = [description, statusText, incident].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ description, statusText, cls: statusClassFromText(statusText), incident });
    }
    return out;
  }

  /**
   * /api/LiveInformationBoard + /api/RainbowBoard →
   *   [{name, statusText, statusId, cls, rows: [{description, statusText, cls, incident}], disrupted, other}]
   * One entry per RouteName (13 on the day), worst status first then SWR's own order, plus "Other routes"
   * at the end for directional rows the mapping table doesn't know. Either input may be missing.
   */
  function normalizeRouteGroups(liveInformationBoard, rainbowBoard) {
    const board = Array.isArray(liveInformationBoard) ? liveInformationBoard : [];
    const groups = [];
    const byName = new Map();
    for (const g of board) {
      if (!g) continue;
      const name = clean(g.RouteName);
      if (!name || byName.has(normKey(name))) continue;
      const statusText = clean(g.StatusText) || null;
      const idNum = Number(g.StatusId);
      const statusId = g.StatusId === undefined || g.StatusId === null || g.StatusId === '' || !Number.isFinite(idNum) ? null : idNum;
      const group = { name, statusText, statusId, cls: routeStatusClass(g.StatusId, statusText), rows: [], disrupted: 0, other: false };
      byName.set(normKey(name), group);
      groups.push(group);
    }

    const derived = !groups.length; // no LiveInformationBoard: build the groups from the rows alone
    let other = null;
    for (const row of normalizeRainbowRows(rainbowBoard)) {
      const mapped = GROUP_BY_DESCRIPTION.get(normKey(row.description));
      let group = mapped ? byName.get(normKey(mapped)) : null;
      if (!group && mapped && derived) {
        group = { name: mapped, statusText: null, statusId: null, cls: 'good', rows: [], disrupted: 0, other: false };
        byName.set(normKey(mapped), group);
        groups.push(group);
      }
      if (!group) {
        if (!other) other = { name: OTHER_GROUP, statusText: null, statusId: null, cls: 'good', rows: [], disrupted: 0, other: true };
        group = other;
      }
      group.rows.push(row);
      if (row.cls !== 'good') group.disrupted++;
    }
    if (other) groups.push(other);

    // Groups without their own status (derived ones and "Other routes") take their worst row's.
    for (const g of groups) {
      if (g.statusText) continue;
      let worst = null;
      for (const r of g.rows) if (!worst || STATUS_RANK[r.cls] > STATUS_RANK[worst.cls]) worst = r;
      g.cls = worst ? worst.cls : 'info';
      g.statusText = worst ? worst.statusText : null;
    }

    const order = new Map(groups.map((g, i) => [g, i]));
    return groups.sort((a, b) => (a.other - b.other) || STATUS_RANK[b.cls] - STATUS_RANK[a.cls] || order.get(a) - order.get(b));
  }

  // ---------------------------------------------------------------------------
  // SWR-6: incidents
  // ---------------------------------------------------------------------------

  const LONDON_PARTS = typeof Intl !== 'undefined'
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  /** Offset of Europe/London from UTC at this instant, in ms (0 in winter, 3 600 000 in summer). */
  function londonOffsetMs(utcMs) {
    if (!LONDON_PARTS) return 0;
    const p = {};
    for (const part of LONDON_PARTS.formatToParts(new Date(utcMs))) p[part.type] = Number(part.value);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  }

  /**
   * "19:18:22 27/09/2026" (SWR's UpdatedTime, London local time) → Date. Also takes "19:18 27/09/2026"
   * and ISO strings. Returns null when it can't be read.
   */
  function parseSwrDateTime(text) {
    const s = clean(text);
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const [h, mi, sec, d, mo, y] = [m[1], m[2], m[3] || '0', m[4], m[5], m[6]].map(Number);
      if (h > 23 || mi > 59 || sec > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
      const first = guess - londonOffsetMs(guess);
      return new Date(guess - londonOffsetMs(first));
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const t = Date.parse(s);
      return Number.isNaN(t) ? null : new Date(t);
    }
    return null;
  }

  const INCIDENT_COLOURS = {
    'code red': { severity: 'major', cls: 'critical', label: 'Major disruption' },
    'code amber': { severity: 'moderate', cls: 'serious', label: 'Disruption' },
    'code yellow': { severity: 'minor', cls: 'warning', label: 'Minor disruption' },
    'code green': { severity: 'info', cls: 'info', label: 'Information' },
  };
  const SEVERITY_RANK = { major: 3, moderate: 2, minor: 1, info: 0, unknown: 0 };

  /** "MajorDisruption" → "Major disruption". */
  function humanizeStatus(text) {
    const s = clean(String(text == null ? '' : text).replace(/([a-z])([A-Z])/g, '$1 $2'));
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
  }

  /**
   * /api/overallstatus →
   *   {status, statusLabel, cls, summary, incidents: [{id, summary, detailsHtml, furtherInfoHtml,
   *    updated: Date|null, updatedText, colour, severity, severityLabel, cls}]}
   * Incidents are most severe first, then most recently updated. Returns null for an unusable input.
   */
  function normalizeIncidents(overallstatus) {
    if (!overallstatus || typeof overallstatus !== 'object') return null;
    const status = clean(overallstatus.Status) || null;
    const statusLabel = humanizeStatus(status) || null;
    const incidents = [];
    const seen = new Set();
    for (const u of Array.isArray(overallstatus.LineUpdates) ? overallstatus.LineUpdates : []) {
      if (!u) continue;
      const summary = clean(u.Summary);
      const detailsHtml = String(u.Details || '').trim();
      if (!summary && !detailsHtml) continue;
      const id = clean(u.IncidentId) || null;
      const key = id || summary;
      if (seen.has(key)) continue;
      seen.add(key);
      const colour = clean(u.Colour) || null;
      const sev = INCIDENT_COLOURS[normKey(colour)] || { severity: 'unknown', cls: 'info', label: 'Update' };
      incidents.push({
        id,
        summary: summary || 'Service update',
        detailsHtml,
        furtherInfoHtml: String(u.FurtherInfo || '').trim(),
        updated: parseSwrDateTime(u.UpdatedTime),
        updatedText: clean(u.UpdatedTime) || null,
        colour,
        severity: sev.severity,
        severityLabel: sev.label,
        cls: sev.cls,
      });
    }
    incidents.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.updated ? b.updated.getTime() : 0) - (a.updated ? a.updated.getTime() : 0));
    const cls = statusClassFromText(statusLabel);
    return { status, statusLabel, cls, summary: clean(overallstatus.Summary) || null, incidents };
  }

  // ---------------------------------------------------------------------------
  // Station messages (Huxley2 nrccMessages)
  // ---------------------------------------------------------------------------

  const roughText = (html) => clean(String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')).toLowerCase();

  /** Huxley departures → [{html}] (raw HTML, for htmlParagraphs at render time), blanks and repeats dropped. */
  function normalizeNrccMessages(huxley) {
    const list = huxley && Array.isArray(huxley.nrccMessages) ? huxley.nrccMessages : [];
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const html = String((m && (m.value ?? m.Value)) || '').trim();
      const key = roughText(html);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ html });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Snapshot age
  // ---------------------------------------------------------------------------

  /** → {date: Date|null, minutes: number|null, stale: bool}. Stale when older than 45 minutes or unreadable. */
  function snapshotAge(fetchedAt, now) {
    const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(fetchedAt);
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    if (!fetchedAt || Number.isNaN(t)) return { date: null, minutes: null, stale: true };
    const minutes = Math.max(0, Math.round((n - t) / 60000));
    return { date: new Date(t), minutes, stale: minutes > STALE_MINUTES };
  }

  // ---------------------------------------------------------------------------
  // SWR-4: TfL headline
  // ---------------------------------------------------------------------------

  /**
   * An https link to an allowed host, or null. Repairs "http://https://…" and upgrades http:// on those hosts.
   */
  function safeHref(href) {
    let s = String(href == null ? '' : href).trim().replace(/&amp;/g, '&');
    s = s.replace(/^https?:\/\/(?=https?:\/\/)/i, '');
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    if (!LINK_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return null;
    if (u.username || u.password) return null;
    u.protocol = 'https:';
    return u.href;
  }

  /**
   * TfL status for south-western-railway → {cls, description, reasons: [text], links: [{text, href}]}.
   * Takes the Map from TflApi's getLineStatuses(), the raw /Line/…/Status array, or one normalised entry.
   * A reason that is only a URL (as on 2026-09-27) becomes a "National Rail details" link.
   */
  function swrHeadline(input) {
    let entry = null;
    if (input instanceof Map) entry = input.get(LINE_ID) || input.values().next().value || null;
    else if (Array.isArray(input)) {
      const map = T.normalizeStatuses(input);
      entry = map.get(LINE_ID) || map.values().next().value || null;
    } else if (input && typeof input === 'object') entry = input;
    if (!entry) return null;
    const reasons = [];
    const links = [];
    for (const r of entry.reasons || []) {
      const text = clean(r);
      if (!text) continue;
      if (/^\S+$/.test(text) && /^(https?:\/\/|www\.)/i.test(text)) {
        const href = safeHref(/^www\./i.test(text) ? 'https://' + text : text);
        const label = /nationalrail\.co\.uk/i.test(href || '') ? 'National Rail details' : 'More details';
        if (href && !links.some((l) => l.href === href)) links.push({ text: label, href });
        else if (!href) reasons.push(text);
      } else reasons.push(text);
    }
    return { cls: entry.cls || 'info', description: entry.description || 'Status unavailable', reasons, links };
  }

  // ---------------------------------------------------------------------------
  // HTML → paragraphs (the one adapter onto SwrApi.htmlToText)
  // ---------------------------------------------------------------------------

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', pound: '£', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      const v = ENTITIES[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  /** Regex fallback for Node and for before SwrApi.htmlToText exists → [{text, links: [{text, href}]}]. */
  function fallbackHtmlToText(html) {
    const src = String(html == null ? '' : html)
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    const chunks = src.split(/(?:<br\s*\/?>\s*){2,}|<\/?(?:p|div|ul|ol|h[1-6])\b[^>]*>|<\/li\s*>/i);
    const out = [];
    for (const chunk of chunks) {
      const links = [];
      const withText = chunk.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (m, attrs, inner) => {
        const hm = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const label = clean(decodeEntities(inner.replace(/<[^>]*>/g, ' ')));
        const href = hm ? safeHref(decodeEntities(hm[2] ?? hm[3] ?? hm[4] ?? '')) : null;
        if (href) links.push({ text: label || href, href });
        return label;
      });
      const text = decodeEntities(withText.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
        .split('\n').map((line) => line.replace(/[ \t \r\f\v]+/g, ' ').trim()).filter(Boolean).join('\n');
      if (text || links.length) out.push({ text, links });
    }
    return out;
  }

  /** Accepts whatever htmlToText returns (string, [string] or [{text, links}]) → [{text, links: [{text, href}]}]. */
  function adaptParagraphs(result) {
    let list = result;
    if (typeof list === 'string') list = list.split(/\n\s*\n/);
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const p of list) {
      const para = typeof p === 'string' ? { text: p, links: [] } : p && typeof p === 'object' ? p : null;
      if (!para) continue;
      const text = String(para.text == null ? '' : para.text).trim();
      const links = [];
      for (const l of Array.isArray(para.links) ? para.links : []) {
        const href = l && safeHref(l.href);
        if (href && !links.some((x) => x.href === href)) links.push({ text: clean(l.text) || href, href });
      }
      if (text || links.length) out.push({ text, links });
    }
    return out;
  }

  /** Untrusted HTML → safe paragraphs. Uses SwrApi.htmlToText when S0 provides it. */
  function htmlParagraphs(html) {
    const swr = root.SwrApi;
    if (swr && typeof swr.htmlToText === 'function') {
      try {
        return adaptParagraphs(swr.htmlToText(html));
      } catch (e) {
        /* fall through to the local parser */
      }
    }
    return adaptParagraphs(fallbackHtmlToText(html));
  }

  // ---------------------------------------------------------------------------
  // Rendering (pure: state in, HTML string out; every API string escaped)
  // ---------------------------------------------------------------------------

  function fmtClock(date) {
    return date.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  }
  function fmtWhen(date, now) {
    const day = (d) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
    return day(date) === day(now) ? fmtClock(date) : `${fmtClock(date)} ${day(date)}`;
  }
  function fmtAge(minutes) {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 48 * 60) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `${h} h${m ? ` ${m} min` : ''} ago`;
    }
    return `${Math.round(minutes / 1440)} days ago`;
  }

  function pill(cls, text, esc, extra) {
    return `<span class="status status-${cls}${extra ? ' ' + extra : ''}"><span class="status-icon" aria-hidden="true">${STATUS_ICONS[cls] || STATUS_ICONS.info}</span>${esc(text)}</span>`;
  }

  function linkHtml(l, esc) {
    return `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.text.replace(/[.\s]+$/, '') || l.href)}</a>`;
  }

  function paragraphsHtml(paras, esc) {
    return paras.map((p) => {
      const links = p.links.length ? ` <span class="swr-st-links">${p.links.map((l) => linkHtml(l, esc)).join(' · ')}</span>` : '';
      return `<p>${esc(p.text)}${links}</p>`;
    }).join('');
  }

  function headlineHtml(state, incidents, esc) {
    const h = state.headline;
    let tfl;
    if (h) {
      const reasons = h.reasons.map((r) => `<p class="swr-st-reason">${esc(r)}</p>`).join('');
      const links = h.links.length ? `<p class="swr-st-reason">${h.links.map((l) => linkHtml(l, esc)).join(' · ')}</p>` : '';
      tfl = `<div class="swr-st-headrow">${pill(h.cls, h.description, esc)}<span class="swr-st-src">TfL, live${state.headlineError ? ' (latest refresh failed)' : ''}</span></div>${reasons}${links}`;
    } else if (state.headlineError) {
      tfl = `<div class="swr-st-headrow">${pill('info', 'Status unavailable', esc)}<span class="swr-st-src">TfL didn't respond: ${esc(state.headlineError.message || state.headlineError)}</span></div>`;
    } else {
      tfl = `<div class="swr-st-headrow"><span class="swr-st-src">Loading status from TfL…</span></div>`;
    }
    let swr = '';
    if (incidents && (incidents.statusLabel || incidents.summary)) {
      const label = incidents.statusLabel || 'Status';
      swr = `<div class="swr-st-headrow">${pill(incidents.cls, label, esc)}<span class="swr-st-src">SWR website, snapshot</span></div>`
        + (incidents.summary ? `<p class="swr-st-reason">${esc(incidents.summary)}</p>` : '');
    }
    return `<div class="card swr-st-headline"><h3 class="card-title">South Western Railway</h3>${tfl}${swr}</div>`;
  }

  function groupsHtml(groups, esc) {
    if (!groups.length) return '<p class="muted small">The snapshot has no route status.</p>';
    return `<ul class="swr-st-groups">${groups.map((g) => {
      const key = 'grp-' + normKey(g.name).replace(/[^a-z0-9]+/g, '-');
      const hint = g.rows.length
        ? g.disrupted
          ? `${g.disrupted} of ${g.rows.length} ${g.rows.length === 1 ? 'service' : 'services'} not running normally`
          : `${g.rows.length} ${g.rows.length === 1 ? 'service' : 'services'}, all good service`
        : 'No details by service';
      const rows = g.rows.map((r) => `<li class="swr-st-row">
          <div class="swr-st-rowtop"><span class="swr-st-dir">${esc(r.description)}</span>${pill(r.cls, r.statusText, esc, 'swr-st-small')}</div>
          ${r.incident ? `<p class="swr-st-incident-text">${esc(r.incident)}</p>` : ''}</li>`).join('');
      const head = `<span class="swr-st-gname">${esc(g.name)}</span>${pill(g.cls, g.statusText || 'Status unknown', esc)}<span class="swr-st-hint">${esc(hint)}</span>`;
      return `<li>${g.rows.length
        ? `<details class="swr-st-group" data-key="${esc(key)}"><summary>${head}</summary><ul class="swr-st-rows">${rows}</ul></details>`
        : `<div class="swr-st-group swr-st-norows"><div class="swr-st-ghead">${head}</div></div>`}</li>`;
    }).join('')}</ul>`;
  }

  function incidentsHtml(incidents, now, esc) {
    if (!incidents.incidents.length) return '<p class="muted small">SWR lists no incidents.</p>';
    return `<ul class="swr-st-incidents">${incidents.incidents.map((i, n) => {
      const details = htmlParagraphs(i.detailsHtml);
      const further = htmlParagraphs(i.furtherInfoHtml);
      const when = i.updated ? `Updated ${fmtWhen(i.updated, now)}` : i.updatedText ? `Updated ${i.updatedText}` : '';
      const body = (details.length ? paragraphsHtml(details, esc) : '<p class="muted">No further details.</p>')
        + (further.length ? `<h4 class="swr-st-more">More information</h4>${paragraphsHtml(further, esc)}` : '');
      return `<li><details class="swr-st-incident" data-key="${esc('inc-' + (i.id || n))}">
          <summary>${pill(i.cls, i.severityLabel, esc)}<span class="swr-st-isum">${esc(i.summary)}</span>${when ? `<span class="swr-st-hint">${esc(when)}</span>` : ''}</summary>
          <div class="swr-st-body">${body}</div></details></li>`;
    }).join('')}</ul>`;
  }

  function messagesHtml(state, esc) {
    const name = state.station ? state.station.name || state.station.crs : '';
    const title = `<h3 class="swr-st-sub">National Rail messages for ${esc(name)}</h3>`;
    if (state.messages === null && state.messagesError) {
      return `${title}<p class="muted small">Station messages are unavailable: Huxley2 didn't respond.</p>`;
    }
    if (state.messages === null) return `${title}<p class="muted small">Loading station messages…</p>`;
    if (!state.messages.length) return `${title}<p class="muted small">No National Rail messages for this station.</p>`;
    return `${title}<ul class="swr-st-messages">${state.messages.map((m) => `<li class="swr-st-message">${paragraphsHtml(htmlParagraphs(m.html), esc)}</li>`).join('')}</ul>`;
  }

  function aboutHtml(age, snapshotMissing, now, esc) {
    const snap = snapshotMissing
      ? 'not available here (it is published with the site every 15 minutes, so it is missing when the page is opened from disk or before snapshots are set up)'
      : age.date ? `taken at ${esc(fmtWhen(age.date, now))} (${esc(fmtAge(age.minutes))})` : 'of unknown age';
    return `<details class="swr-st-about"><summary>About this data</summary><ul>
      <li><strong>Headline:</strong> TfL Unified API, <code>/Line/south-western-railway/Status</code>, live. TfL gives one status for all of SWR, often just a link to National Rail.</li>
      <li><strong>Status by route group and incidents:</strong> South Western Railway's website (<code>/api/LiveInformationBoard</code>, <code>/api/RainbowBoard</code>, <code>/api/overallstatus</code>). This is unofficial and undocumented, and browsers can't call it, so this site shows a snapshot of it: ${snap}. Which services sit under which route group is this dashboard's own mapping; services it doesn't know go under "${OTHER_GROUP}".</li>
      <li><strong>Station messages:</strong> National Rail's messages for the station, via Huxley2, an unofficial community service run by a volunteer. Live, from the same request as the departures board.</li>
      <li>Incident text arrives as HTML. It's shown as plain text, keeping only links to SWR, National Rail, Network Rail and TfL.</li>
    </ul></details>`;
  }

  /**
   * state: {headline, headlineError, snapshot, snapshotLoaded, station, messages, messagesError}
   * (snapshot is the parsed status.json or null). → HTML for #swr-status.
   */
  function renderStatusHtml(state, now, escFn) {
    const esc = escFn || escHtml;
    const nowDate = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const snap = state.snapshot && typeof state.snapshot === 'object' ? state.snapshot : null;
    const snapshotMissing = state.snapshotLoaded && !snap;
    const incidents = snap ? normalizeIncidents(snap.overallstatus) : null;
    const groups = snap ? normalizeRouteGroups(snap.liveInformationBoard, snap.rainbowBoard) : [];
    const age = snapshotAge(snap && snap.fetchedAt, nowDate);

    let html = `<h2 class="section-title">Service status</h2>${headlineHtml(state, incidents, esc)}`;

    if (snap) {
      const asOf = age.date ? `Snapshot of SWR's website as of ${fmtWhen(age.date, nowDate)} (${fmtAge(age.minutes)}).` : "Snapshot of SWR's website, time unknown.";
      const stale = age.stale ? `<p class="swr-st-stale">${pill('warning', 'May be out of date', esc)} <span>SWR's own status may have changed since then.</span></p>` : '';
      const failed = snap.errors && typeof snap.errors === 'object' ? Object.keys(snap.errors) : [];
      const failedNote = failed.length ? `<p class="muted small">Missing from this snapshot: ${esc(failed.join(', '))}.</p>` : '';
      html += `<h3 class="swr-st-sub">Status by route group</h3><p class="muted small swr-st-asof">${esc(asOf)} Open a group to see each service.</p>${stale}${failedNote}`;
      html += groupsHtml(groups, esc);
      if (incidents) html += `<h3 class="swr-st-sub">Incidents</h3>${incidentsHtml(incidents, nowDate, esc)}`;
    } else if (snapshotMissing) {
      html += `<p class="swr-st-nosnap muted small">Status by route group and SWR's incident details aren't available here. They come from a snapshot of SWR's website that this site publishes; it's missing when the page is opened from disk or before snapshots are set up.</p>`;
    } else {
      html += '<p class="muted small">Loading SWR route status…</p>';
    }

    if (state.station) html += messagesHtml(state, esc);
    html += aboutHtml(age, snapshotMissing || !snap, nowDate, esc);
    return html;
  }

  // ---------------------------------------------------------------------------
  // Demo fixture: data/swr/status.json in the S7 snapshot format, from real samples (2026-09-27, trimmed)
  // ---------------------------------------------------------------------------

  // GET https://www.southwesternrailway.com/api/LiveInformationBoard (all 13 groups, 2026-09-27 19:20 BST)
  const DEMO_LIVE_BOARD = [
    ['Kingston/Shepperton', 'Good Service', '0'], ['Chessington/Epsom', 'Good Service', '0'],
    ['Suburban Lines', 'Major Disruption', '2'], ['Surbiton/Cobham', 'Good Service', '0'],
    ['Hounslow Loop', 'Special Timetable', '4'], ['Reading/Windsor Lines', 'Special Timetable', '4'],
    ['South Western Mainline', 'Special Timetable', '4'], ['West of England', 'Major Disruption', '2'],
    ['Portsmouth Direct', 'Major Disruption', '2'], ['South Hampshire Locals', 'Special Timetable', '4'],
    ['Romsey/Salisbury', 'Special Timetable', '4'], ['Ascot/Guildford', 'Planned Closure', '3'],
    ['Island Line', 'Good Service', '0'],
  ].map(([RouteName, StatusText, StatusId]) => ({ RouteName, StatusText, StatusId }));

  // GET https://www.southwesternrailway.com/api/RainbowBoard (same evening, all 49 rows in SWR's order; rows
  // with Good Service and no incident ("Incidents": " ") are listed by description only)
  const DEMO_RAINBOW_DISRUPTED = {
    'Portsmouth to Waterloo via Guildford': ['Minor Disruption', 'Services may be disrupted due to a passenger being taken ill on a train between Godalming and Guildford.'],
    'Woking to Waterloo (Stopping)': ['Minor Disruption', ' '],
    'Waterloo to Salisbury/Yeovil/Exeter St Davids': ['Good Service', 'Services may be disrupted due to a broken down train between Salisbury and Yeovil Junctio.'],
    'Salisbury/Yeovil/Exeter St Davids to Waterloo': ['Minor Disruption', 'Services may be disrupted due to a broken down train between Salisbury and Yeovil Junctio.'],
    'Waterloo to Weymouth': ['Minor Disruption', ' '],
    'Weymouth to Waterloo': ['Good Service', 'Services may be disrupted due to a passenger being taken ill on a train between Godalming and Guildford.'],
  };
  const DEMO_RAINBOW_ORDER = [
    'Waterloo to Alton', 'Alton to Waterloo', 'Winchester to Southampton Central/Bournemouth', 'Southampton Central/Bournemouth to Winchester',
    'Waterloo to Portsmouth via Guildford', 'Portsmouth to Waterloo via Guildford', 'Waterloo to Reading via Richmond', 'Reading to Waterloo via Richmond',
    'Waterloo to Dorking', 'Dorking to Waterloo', 'Waterloo to Guildford via Epsom', 'Guildford to Waterloo via Epsom',
    'Southampton Central to Portsmouth & Southsea', 'Portsmouth & Southsea to Southampton Central', 'Woking to Waterloo (Stopping)',
    'Waterloo to Guildford via Cobham', 'Guildford to Waterloo via Cobham', 'Waterloo to Shepperton', 'Shepperton to Waterloo',
    'Waterloo to Hampton Court', 'Hampton Court to Waterloo', 'Waterloo to London Waterloo via Kingston and Twickenham',
    'Waterloo to London Waterloo via Twickenham and Kingston', 'Waterloo to Salisbury/Yeovil/Exeter St Davids',
    'Salisbury/Yeovil/Exeter St Davids to Waterloo', 'Waterloo to Basingstoke (Stopping)', 'Basingstoke to Waterloo (Stopping)',
    'Waterloo to Chessington South', 'Chessington South to Waterloo', 'Waterloo to Weybridge via Staines', 'Weybridge to Waterloo via Staines',
    'Waterloo to Windsor & Eton Riverside', 'Windsor & Eton Riverside to Waterloo', 'Waterloo to London Waterloo via Richmond and Brentford',
    'Waterloo to London Waterloo via Brentford and Richmond', 'Waterloo to Weymouth', 'Weymouth to Waterloo',
    'Waterloo to Portsmouth Harbour via Basingstoke', 'Portsmouth Harbour to Waterloo via Basingstoke', 'Waterloo to Aldershot via Ascot',
    'Aldershot to Waterloo via Ascot', 'Ascot to Aldershot', 'Aldershot to Ascot', 'Guildford to Farnham', 'Farnham to Guildford',
    'Romsey Rounders', 'Lymington Branch', 'Lymington Branch', 'Island Line',
  ];

  // GET https://www.southwesternrailway.com/api/overallstatus (Details trimmed)
  const DEMO_OVERALL = {
    IsOverwriteFeedStatus: false,
    Status: 'MajorDisruption',
    Summary: 'Alterations to services at Yeovil Junction',
    LineUpdates: [
      {
        Summary: 'Alterations to services at Yeovil Junction',
        Details: "Following a broken down train earlier today at Yeovil Junction all lines have now reopened.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What's Going On:</strong></span><br />Train services running through this station may be delayed by up to 30 minutes or revised. Disruption is expected until the end of the day.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What We're Doing About It:</strong></span><br />After engineers attended the incident and rectified the fault to allow the broken down train to move and continue in it's journey, all lines have now opened and trains are running through this station.<br /><br />Your ticket can be used, at no extra cost, on the following services:<br /><br />Rail Services:<br />Great Western Railway train services between Weymouth, Maiden Newton, Yeovil Pen Mill, Castle Cary, Westbury, Exeter St Davids, Basingstoke, Reading and London Paddington<br /><br />Replacement buses<br />We have rail replacement buses in place to run between Exeter St Davids and Yeovil Junction. Please note, due to the last minute nature of these they are not running to a scheduled timetable.<br /><br />We are very sorry for any disruption to your journey.",
        FurtherInfo: 'An update will follow within the next 2 hours.If you would prefer to use local buses to continue your journey please check Traveline (http://www.traveline.info/) - South Western Railway tickets are not valid on local buses unless stated above.  Have you been delayed? Please see https://www.southwesternrailway.com/contact-and-help/refunds-and-compensation for our compensation policy.',
        MarketingInfo: '',
        OperatorCode: 'SW',
        UpdateType: 'line',
        UpdatedTime: '19:18:22 27/09/2026',
        IncidentId: '1297592241',
        Colour: 'Code Red',
      },
      {
        Summary: 'Cancellations to services at Godalming',
        Details: "Following a passenger being taken ill on a train earlier today at Godalming all lines have now reopened.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What's Going On:</strong></span><br />Train services running through this station are returning to normal but some services may still be cancelled, delayed by up to 60 minutes or revised. Disruption is expected until the end of the day.<br /><br /><span style='color: #0092cb;'><strong class='margin-bottom-0'>What We're Doing About It:</strong></span><br />Long Distance &amp; Mainline Services<br />Some services between London Waterloo and Portsmouth stations via Guildford will still be subject to delay, alteration or cancellation while we work to return services to normal this evening. <br /><br />We are very sorry for any disruption to your journey.",
        FurtherInfo: 'An update will follow within the next 2 hours.',
        MarketingInfo: '',
        OperatorCode: 'SW',
        UpdateType: 'line',
        UpdatedTime: '19:13:05 27/09/2026',
        IncidentId: '1297592328',
        Colour: 'Code Yellow',
      },
    ],
  };

  function londonStamp(date) {
    if (!LONDON_PARTS) return '';
    const p = {};
    for (const part of LONDON_PARTS.formatToParts(date)) p[part.type] = part.value;
    return `${p.hour}:${p.minute}:${p.second} ${p.day}/${p.month}/${p.year}`;
  }

  /** The demo status.json, with times moved to just before `now` so it reads as fresh. */
  function demoStatusSnapshot(now) {
    const n = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
    const rows = DEMO_RAINBOW_ORDER.map((d) => {
      const [Status, Incidents] = DEMO_RAINBOW_DISRUPTED[d] || ['Good Service', ' '];
      return { Description: d, Status, Incidents };
    });
    const overall = JSON.parse(JSON.stringify(DEMO_OVERALL));
    overall.LineUpdates[0].UpdatedTime = londonStamp(new Date(n - 20 * 60000));
    overall.LineUpdates[1].UpdatedTime = londonStamp(new Date(n - 26 * 60000));
    return {
      fetchedAt: new Date(n - 6 * 60000).toISOString(),
      errors: {},
      overallstatus: overall,
      liveInformationBoard: DEMO_LIVE_BOARD.map((g) => ({ ...g })),
      rainbowBoard: { LastUpdated: new Date(n - 8 * 60000).toISOString(), Lines: rows },
    };
  }

  /** SwrApi.demoRoutes entry: answers data/swr/status.json, nothing else. */
  function demoRoute(url) {
    return /(^|\/)data\/swr\/status\.json(?:[?#]|$)/.test(String(url)) ? demoStatusSnapshot() : null;
  }

  // ---------------------------------------------------------------------------
  // Controller (browser only)
  // ---------------------------------------------------------------------------

  const ctl = {
    ctx: null,
    token: null,
    station: null,
    headline: null,
    headlineError: null,
    headlineAt: 0,
    headlineSeq: 0,
    snapshot: null,
    snapshotLoaded: false,
    snapshotAt: 0,
    snapshotSeq: 0,
    messages: null,
    messagesError: null,
    messagesCrs: null,
  };

  function render() {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('swr-status');
    if (!box) return;
    // Keep open <details> open across re-renders (refreshes every 60 s).
    const open = new Set([...box.querySelectorAll('details[open][data-key]')].map((d) => d.dataset.key));
    const aboutOpen = !!box.querySelector('details.swr-st-about[open]');
    const esc = (ctl.ctx && ctl.ctx.esc) || escHtml;
    box.innerHTML = renderStatusHtml(ctl, new Date(), esc);
    for (const d of box.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = true;
    if (aboutOpen) { const a = box.querySelector('details.swr-st-about'); if (a) a.open = true; }
    box.hidden = false;
  }

  async function loadHeadline(ctx) {
    if (!ctx || !ctx.tfl || typeof ctx.tfl.getLineStatuses !== 'function') return;
    const seq = ++ctl.headlineSeq;
    try {
      const statuses = await ctx.tfl.getLineStatuses([LINE_ID]);
      if (seq !== ctl.headlineSeq) return;
      ctl.headline = swrHeadline(statuses) || ctl.headline;
      ctl.headlineError = ctl.headline ? null : new Error('No status for South Western Railway');
    } catch (e) {
      if (seq !== ctl.headlineSeq) return;
      ctl.headlineError = e; // keep the last good headline
    }
    ctl.headlineAt = Date.now();
    render();
  }

  async function loadSnapshot(ctx) {
    if (!ctx || !ctx.api || typeof ctx.api.snapshot !== 'function') {
      ctl.snapshotLoaded = true;
      return;
    }
    const seq = ++ctl.snapshotSeq;
    let snap = null;
    try { snap = await ctx.api.snapshot('status.json'); } catch (e) { snap = null; }
    if (seq !== ctl.snapshotSeq) return;
    const usable = snap && typeof snap === 'object' && (snap.overallstatus || snap.liveInformationBoard || snap.rainbowBoard);
    if (usable || !ctl.snapshot) ctl.snapshot = usable ? snap : null; // a failed refresh keeps the last good one
    ctl.snapshotLoaded = true;
    ctl.snapshotAt = Date.now();
    render();
  }

  async function loadMessages(ctx, station, token) {
    if (!ctx || !ctx.api || typeof ctx.api.huxleyDepartures !== 'function' || !station || !station.crs) return;
    try {
      const huxley = await ctx.api.huxleyDepartures(station.crs);
      if (token !== ctl.token || !ctl.station || ctl.station.crs !== station.crs) return;
      ctl.messages = normalizeNrccMessages(huxley);
      ctl.messagesError = null;
    } catch (e) {
      if (token !== ctl.token || !ctl.station || ctl.station.crs !== station.crs) return;
      ctl.messagesError = e; // keep the last good messages for this station
    }
    render();
  }

  function load(force) {
    const ctx = ctl.ctx;
    const now = Date.now();
    const jobs = [];
    if (force || now - ctl.headlineAt > HEADLINE_TTL_MS) jobs.push(loadHeadline(ctx));
    if (force || now - ctl.snapshotAt > SNAPSHOT_TTL_MS) jobs.push(loadSnapshot(ctx));
    if (ctl.station) jobs.push(loadMessages(ctx, ctl.station, ctl.token));
    return Promise.all(jobs);
  }

  function setContext(station, ctx) {
    ctl.ctx = ctx || ctl.ctx;
    ctl.token = ctx ? ctx.token : ctl.token;
    const crs = station && station.crs ? station.crs : null;
    if (crs !== ctl.messagesCrs) {
      ctl.messages = null;
      ctl.messagesError = null;
      ctl.messagesCrs = crs;
    }
    ctl.station = station || null;
  }

  const moduleDef = {
    id: 'status',
    /** A station was chosen (or null before one is): the headline shows either way. */
    onStation(station, ctx) {
      setContext(station, ctx);
      render();
      return load(false);
    },
    /** Every 60 s while the SWR tab is visible, and on "Refresh now". */
    refresh(station, ctx) {
      setContext(station, ctx);
      return load(true);
    },
  };

  const api = {
    LINE_ID,
    STALE_MINUTES,
    ROUTE_GROUPS,
    ROUTE_STATUS_IDS,
    OTHER_GROUP,
    statusClassFromText,
    routeStatusClass,
    normalizeRainbowRows,
    normalizeRouteGroups,
    parseSwrDateTime,
    humanizeStatus,
    normalizeIncidents,
    normalizeNrccMessages,
    snapshotAge,
    safeHref,
    swrHeadline,
    fallbackHtmlToText,
    adaptParagraphs,
    htmlParagraphs,
    renderStatusHtml,
    demoStatusSnapshot,
    demoRoute,
    module: moduleDef,
  };

  root.SwrStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.SwrApi && Array.isArray(window.SwrApi.demoRoutes)) window.SwrApi.demoRoutes.push(demoRoute);
  if (typeof window !== 'undefined' && window.SwrApp) window.SwrApp.register(moduleDef);
})(typeof window !== 'undefined' ? window : globalThis);
