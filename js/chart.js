/*
 * Busyness profile chart: typical % of baseline across today's 15-minute bands
 * for each station NaPTAN, with a "now" rule and the live reading as a dot.
 * Plain SVG, no dependencies. Hover/focus shows a crosshair + tooltip.
 */
(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HEIGHT = 260;
  const M = { top: 20, right: 64, bottom: 30, left: 44 };

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function pct(v) {
    return Math.round(v * 100) + '%';
  }

  /**
   * series: [{ label, colorVar, bands: [{x, start, value}], live: {value} | null }]
   * nowX:   service-day minutes for "now"
   */
  function renderProfileChart(container, series, nowX) {
    const { formatClock } = root.TflApi;
    container.textContent = '';
    const width = Math.max(300, container.clientWidth || 640);
    const innerW = width - M.left - M.right;
    const innerH = HEIGHT - M.top - M.bottom;

    const allBands = series.flatMap((s) => s.bands);
    const minX = Math.min(...allBands.map((b) => b.x), nowX);
    const maxX = Math.max(...allBands.map((b) => b.x + 15), nowX);
    const maxY = Math.max(1, ...allBands.map((b) => b.value), ...series.map((s) => (s.live ? s.live.value : 0)));
    const yMax = Math.ceil(maxY * 4) / 4;

    const sx = (x) => M.left + ((x - minX) / (maxX - minX || 1)) * innerW;
    const sy = (v) => M.top + innerH - (v / yMax) * innerH;
    // Plot each band at its midpoint so the live dot lines up with the band it belongs to.
    const bx = (b) => sx(b.x + 7.5);

    const svg = el('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, class: 'profile-svg', role: 'img' });
    svg.setAttribute('aria-label', 'Typical busyness today by time of day, with the live reading marked at the current time');

    // Gridlines + y ticks
    const grid = el('g', { class: 'grid' }, svg);
    for (let v = 0; v <= yMax + 1e-9; v += 0.25) {
      el('line', { x1: M.left, x2: width - M.right, y1: sy(v), y2: sy(v), class: v === 0 ? 'baseline' : 'gridline' }, grid);
      const t = el('text', { x: M.left - 8, y: sy(v) + 4, class: 'tick', 'text-anchor': 'end' }, grid);
      t.textContent = pct(v);
    }
    // x ticks every 3 hours on the clock
    const step = innerW < 420 ? 360 : 180;
    const firstTick = Math.ceil((minX + 240) / step) * step - 240;
    for (let x = firstTick; x <= maxX; x += step) {
      const t = el('text', { x: sx(x), y: HEIGHT - 8, class: 'tick', 'text-anchor': 'middle' }, grid);
      t.textContent = formatClock(x + 240);
    }

    // Series: area wash + 2px line
    for (const s of series) {
      if (!s.bands.length) continue;
      const pts = s.bands.map((b) => `${bx(b).toFixed(1)},${sy(b.value).toFixed(1)}`);
      const first = s.bands[0];
      const last = s.bands[s.bands.length - 1];
      el('path', { d: `M${bx(first)},${sy(0)} L${pts.join(' L')} L${bx(last)},${sy(0)} Z`, class: 'area', style: `fill: var(${s.colorVar})` }, svg);
      el('path', { d: `M${pts.join(' L')}`, class: 'series-line', style: `stroke: var(${s.colorVar})` }, svg);
    }

    // Now rule
    const nx = sx(nowX);
    el('line', { x1: nx, x2: nx, y1: M.top - 6, y2: M.top + innerH, class: 'now-rule' }, svg);
    const nowLabel = el('text', { x: nx, y: M.top - 9, class: 'now-label', 'text-anchor': 'middle' }, svg);
    nowLabel.textContent = 'Now ' + formatClock(nowX + 240);

    // Live dots + direct labels. A label goes right of the dot, else left; if both
    // sides are taken it is skipped (never stacked) and the legend, tiles and tooltip carry it.
    const placed = { right: [], left: [] };
    const live = series.filter((s) => s.live);
    for (const s of live) {
      const y = sy(s.live.value);
      const side = ['right', 'left'].find((k) => !placed[k].some((py) => Math.abs(py - y) < 14));
      if (!side) continue;
      placed[side].push(y);
      const label = el('text', { x: nx + (side === 'right' ? 10 : -10), y: y + 4, class: 'live-label', 'text-anchor': side === 'right' ? 'start' : 'end' }, svg);
      label.textContent = (live.length > 1 ? '' : 'Live ') + pct(s.live.value);
    }
    for (const s of live) {
      el('circle', { cx: nx, cy: sy(s.live.value), r: 5, class: 'live-dot', style: `fill: var(${s.colorVar})` }, svg);
    }

    // Hover layer
    const cross = el('line', { y1: M.top, y2: M.top + innerH, class: 'crosshair', visibility: 'hidden' }, svg);
    const hit = el('rect', { x: M.left, y: M.top, width: innerW, height: innerH, class: 'hit', tabindex: 0 }, svg);
    hit.setAttribute('aria-label', 'Chart hover area — use left and right arrow keys to read values');

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(svg);
    container.appendChild(tip);

    const xs = [...new Set(allBands.map((b) => b.x))].sort((a, b) => a - b);
    let idx = xs.findIndex((x) => x <= nowX && nowX < x + 15);
    if (idx < 0) idx = 0;

    function show(i) {
      idx = Math.max(0, Math.min(xs.length - 1, i));
      const x = xs[idx];
      const px = sx(x + 7.5);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      const head = document.createElement('div');
      head.className = 'tip-head';
      head.textContent = `${formatClock(x + 240)}–${formatClock(x + 255)} typical`;
      tip.appendChild(head);
      for (const s of series) {
        const b = s.bands.find((bb) => bb.x === x);
        const row = document.createElement('div');
        row.className = 'tip-row';
        const key = document.createElement('span');
        key.className = 'tip-key';
        key.style.background = `var(${s.colorVar})`;
        const val = document.createElement('strong');
        val.textContent = b ? pct(b.value) : '—';
        const name = document.createElement('span');
        name.className = 'tip-name';
        name.textContent = s.label;
        row.append(key, val, name);
        tip.appendChild(row);
      }
      if (x <= nowX && nowX < x + 15) {
        for (const s of series.filter((ss) => ss.live)) {
          const row = document.createElement('div');
          row.className = 'tip-row tip-live';
          row.textContent = `Live now: ${pct(s.live.value)} · ${s.label}`;
          tip.appendChild(row);
        }
      }
      tip.hidden = false;
      const tipW = tip.offsetWidth || 180;
      const left = px + 12 + tipW > width ? px - 12 - tipW : px + 12;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${M.top}px`;
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }

    hit.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const scale = width / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const x = minX + ((px - M.left) / innerW) * (maxX - minX) - 7.5;
      let best = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
      show(best);
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(idx));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); }
      if (e.key === 'Escape') hide();
    });
  }

  root.TflChart = { renderProfileChart };
})(typeof window !== 'undefined' ? window : globalThis);
