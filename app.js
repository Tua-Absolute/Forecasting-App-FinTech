// Stealth Forecast front end — no framework, no build step.
import * as dash from './store.js';

const $ = (s) => document.querySelector(s);
const COLORS = { history: '#e6e6e9', drift: '#ee3a3a', holt: '#4a7ff0', linear: '#13a3a0' };
const NS = 'http://www.w3.org/2000/svg';

const state = {
  symbol: null,
  range: 'all',
  table: false,
  plan: 'free',
  stock: null,
  fc: null,
};

// ---------- formatting ----------
const money = (v, cur = 'USD') =>
  v == null || !isFinite(v) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v);
const num = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (v, d = 2, signed = true) => (v == null || !isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const big = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return num(v, 0);
};
const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '■');
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
}

function flash(msg, kind = 'ok') {
  const el = $('#flash');
  el.className = `flash ${kind}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (el.hidden = true), 8000);
}

// ---------- plan & checkout ----------
async function handleCheckoutReturn() {
  const p = new URLSearchParams(location.search);
  const status = p.get('checkout');
  if (!status) return;
  const sid = p.get('session_id');
  history.replaceState(null, '', location.pathname + (state.symbol ? `?s=${state.symbol}` : ''));
  if (status === 'cancelled') return flash('Checkout cancelled. You are still on your current plan.', 'err');
  try {
    const { plan } = await api(`/api/verify?session_id=${encodeURIComponent(sid)}`);
    flash(`Payment confirmed. Welcome to ${plan.toUpperCase()}. Your forecast has been upgraded.`);
  } catch (e) {
    flash(e.message, 'err');
  }
}

async function loadPlan() {
  try {
    state.plan = (await api('/api/plan')).plan;
  } catch {
    state.plan = 'free';
  }
  renderPlan();
}

function renderPlan() {
  const badge = $('#planBadge');
  badge.dataset.plan = state.plan;
  badge.textContent = state.plan.toUpperCase();
  document.querySelectorAll('.plan').forEach((card) => {
    const id = card.dataset.plan;
    const btn = card.querySelector('button');
    card.classList.toggle('is-current', id === state.plan);
    if (id === state.plan) {
      btn.textContent = 'Current plan';
      btn.disabled = true;
      btn.className = 'btn btn-ghost';
    } else if (id === 'free') {
      btn.textContent = 'Downgrade to Free';
      btn.disabled = false;
      btn.className = 'btn btn-ghost';
    } else {
      btn.textContent = state.plan === 'free' ? `Get ${id === 'max' ? 'Max' : 'Premium'}` : `Switch to ${id === 'max' ? 'Max' : 'Premium'}`;
      btn.disabled = false;
      btn.className = 'btn btn-red';
    }
  });
}

document.querySelectorAll('[data-choose]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const plan = btn.dataset.choose;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Opening…';
    try {
      if (plan === 'free') {
        await api('/api/plan', { method: 'DELETE' });
        state.plan = 'free';
        renderPlan();
        flash('Test subscription cancelled. You are on the Free plan.');
        loadForecast(state.symbol);
        return;
      }
      const { url } = await api('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      location.href = url;
    } catch (e) {
      flash(e.message, 'err');
      btn.textContent = label;
      btn.disabled = false;
    }
  })
);

// ---------- ticker tape ----------
async function loadTape() {
  try {
    const { quotes } = await api('/api/market');
    const html = quotes
      .filter((q) => q.price)
      .map(
        (q) => `<button class="tick" data-sym="${esc(q.symbol)}">
          <span class="t-label">${esc(q.label)}</span>
          <span class="t-price">${num(q.price)}</span>
          <span class="t-price ${tone(q.changePercent)}">${arrow(q.changePercent)} ${num(Math.abs(q.changePercent))}%</span>
        </button>`
      )
      .join('');
    $('#tape').innerHTML = html + html; // doubled for a seamless loop
  } catch {
    $('.tape').hidden = true;
  }
}
$('#tape').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sym]');
  if (b) selectSymbol(b.dataset.sym);
});

// ---------- search ----------
const input = $('#searchInput');
const list = $('#searchResults');
let results = [];
let active = -1;
let searchTimer;

function renderResults(msg) {
  if (msg) {
    list.innerHTML = `<li class="r-empty">${esc(msg)}</li>`;
  } else {
    list.innerHTML = results
      .map((r, i) => `<li role="option" aria-selected="${i === active}" data-i="${i}"><span class="r-sym">${esc(r.symbol)}</span><span class="r-name">${esc(r.name)}</span></li>`)
      .join('');
  }
  list.hidden = false;
}

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (!q) return (list.hidden = true);
  searchTimer = setTimeout(async () => {
    try {
      results = (await api(`/api/search?q=${encodeURIComponent(q)}`)).results;
      active = results.length ? 0 : -1;
      results.length ? renderResults() : renderResults('No US stocks match. Press Enter to try it as a ticker.');
    } catch (e) {
      renderResults(e.message);
    }
  }, 220);
});
input.addEventListener('keydown', (e) => {
  if (list.hidden || !results.length) return;
  if (e.key === 'ArrowDown') active = (active + 1) % results.length;
  else if (e.key === 'ArrowUp') active = (active - 1 + results.length) % results.length;
  else if (e.key === 'Escape') return (list.hidden = true);
  else return;
  e.preventDefault();
  renderResults();
});
list.addEventListener('mousedown', (e) => {
  const li = e.target.closest('[data-i]');
  if (!li) return;
  e.preventDefault();
  selectSymbol(results[+li.dataset.i].symbol);
});
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pick = !list.hidden && results[active] ? results[active].symbol : input.value.trim();
  if (pick) selectSymbol(pick);
});
input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  }
});

function selectSymbol(sym) {
  sym = sym.toUpperCase().trim();
  input.value = '';
  list.hidden = true;
  input.blur();
  history.replaceState(null, '', `?s=${encodeURIComponent(sym)}`);
  try { localStorage.setItem('mr_last', sym); } catch {}
  load(sym);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- dashboard button ----------
function renderDash() {
  const n = dash.load().stocks.length;
  const badge = $('#dashCount');
  badge.hidden = n === 0;
  badge.textContent = n;
  const btn = $('#dashBtn');
  const on = state.symbol && dash.has(state.symbol);
  btn.setAttribute('aria-pressed', on);
  btn.querySelector('span').textContent = on ? 'On your dashboard' : 'Add to dashboard';
  btn.title = on ? 'Click to remove from your dashboard' : `Save ${state.symbol || 'this stock'} to your dashboard`;
}
$('#dashBtn').addEventListener('click', () => {
  const sym = state.symbol;
  if (!sym) return;
  if (dash.has(sym)) {
    dash.removeStock(sym);
    flash(`${sym} removed from your dashboard.`);
  } else {
    const r = dash.addStock(sym);
    if (r === 'full') {
      const el = $('#flash');
      el.className = 'flash err';
      el.innerHTML = `Your dashboard already holds ${dash.MAX_STOCKS} stocks. <a href="/dashboard">Open the dashboard</a> to remove one first.`;
      el.hidden = false;
      return;
    }
    const el = $('#flash');
    el.className = 'flash ok';
    el.innerHTML = `${esc(sym)} saved to your dashboard. <a href="/dashboard">Compare it now →</a>`;
    el.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => (el.hidden = true), 8000);
  }
  renderDash();
});
addEventListener('sf-dashboard', renderDash);

// ---------- loading ----------
function load(sym) {
  state.symbol = sym;
  renderDash();
  document.title = `${sym} forecast — Stealth Forecast`;
  loadStock(sym);
  loadForecast(sym);
  loadNews(sym);
}

async function loadStock(sym) {
  $('#coSymbol').textContent = sym;
  $('#coName').textContent = 'Loading…';
  $('#price').textContent = '—';
  $('#change').textContent = '';
  $('#stats').innerHTML = '';
  try {
    const s = await api(`/api/stock?symbol=${encodeURIComponent(sym)}`);
    if (state.symbol !== sym) return;
    state.stock = s;
    renderStock(s);
  } catch (e) {
    if (state.symbol !== sym) return;
    $('#coName').textContent = e.message;
  }
}

async function loadForecast(sym) {
  $('#chart').innerHTML = '<div class="skeleton"></div>';
  $('#chartError').hidden = true;
  $('#milestones').innerHTML = '';
  try {
    const fc = await api(`/api/forecast?symbol=${encodeURIComponent(sym)}`);
    if (state.symbol !== sym) return;
    state.fc = fc;
    if (fc.plan !== state.plan) {
      state.plan = fc.plan;
      renderPlan();
    }
    renderAllForecast();
  } catch (e) {
    if (state.symbol !== sym) return;
    state.fc = null;
    $('#chart').innerHTML = '';
    $('#legend').innerHTML = '';
    $('#chartError').hidden = false;
    $('#chartError').textContent = e.message;
    $('#histStats').innerHTML = '';
    $('#modelsBody').innerHTML = '';
  }
}

async function loadNews(sym) {
  const ul = $('#news');
  ul.innerHTML = '<li class="meta">Loading headlines…</li>';
  try {
    const { items } = await api(`/api/news?symbol=${encodeURIComponent(sym)}`);
    if (state.symbol !== sym) return;
    ul.innerHTML = items.length
      ? items
          .map(
            (n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.headline)}</a>
              <div class="meta">${esc(n.source)} · ${new Date(n.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></li>`
          )
          .join('')
      : '<li class="meta">No headlines in the last two weeks.</li>';
  } catch (e) {
    ul.innerHTML = `<li class="meta">${esc(e.message)}</li>`;
  }
}

// ---------- hero + stats ----------
function shortExchange(x) {
  if (!x) return '';
  if (/nasdaq/i.test(x)) return 'NASDAQ';
  if (/new york/i.test(x)) return 'NYSE';
  if (/arca/i.test(x)) return 'NYSE Arca';
  if (/american|amex/i.test(x)) return 'NYSE American';
  return x.split(/\s+-\s+/)[0];
}
function renderStock(s) {
  const { quote: q, profile: p, metrics: m } = s;
  const cur = p.currency;
  $('#coName').textContent = p.name;
  $('#coExchange').textContent = shortExchange(p.exchange);
  $('#coIndustry').textContent = p.industry || '';
  const logo = $('#coLogo');
  if (p.logo) {
    logo.className = 'logo has-img';
    logo.style.backgroundImage = `url("${p.logo}")`;
    logo.textContent = '';
  } else {
    logo.className = 'logo';
    logo.style.backgroundImage = '';
    logo.textContent = s.symbol.slice(0, 2);
  }
  $('#price').textContent = money(q.price, cur);
  $('#change').className = `change ${tone(q.change)}`;
  $('#change').textContent = `${arrow(q.change)} ${q.change > 0 ? '+' : ''}${num(q.change)} (${q.changePercent > 0 ? '+' : ''}${num(q.changePercent)}%) today`;
  $('#asof').textContent = q.time ? `Last trade ${new Date(q.time * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · Finnhub` : '';

  const rangePos = m.week52High && m.week52Low ? Math.min(1, Math.max(0, (q.price - m.week52Low) / (m.week52High - m.week52Low))) : null;
  const pctPlain = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${num(v)}%`);
  const items = [
    ['Open', money(q.open, cur)],
    ['Day high', money(q.high, cur)],
    ['Day low', money(q.low, cur)],
    ['Prev close', money(q.previousClose, cur)],
    ['Market cap', big(p.marketCap)],
    ['P/E (TTM)', num(m.pe)],
    ['EPS (TTM)', money(m.eps, cur)],
    ['Beta', num(m.beta)],
    ['Div. yield', m.dividendYield ? `${num(m.dividendYield)}%` : '—'],
    ['Avg vol (10D)', big(m.avgVolume10d)],
    ['YTD return', `<span class="${tone(m.ytdReturn)}">${pctPlain(m.ytdReturn)}</span>`],
    ['52W return', `<span class="${tone(m.week52Return)}">${pctPlain(m.week52Return)}</span>`],
    ['Price / book', num(m.priceToBook)],
    ['Net margin', m.netMargin == null ? '—' : `${num(m.netMargin)}%`],
    [
      '52W range',
      `${money(m.week52Low, cur)} – ${money(m.week52High, cur)}${rangePos == null ? '' : `<div class="range-bar" title="Current price within 52-week range"><i style="left:calc(${(rangePos * 100).toFixed(1)}% - 1px)"></i></div>`}`,
    ],
  ];
  $('#stats').innerHTML = items.map(([k, v]) => `<dl class="stat${k === '52W range' ? ' wide' : ''}"><dt>${k}</dt><dd>${v}</dd></dl>`).join('');
}

// ---------- forecast rendering ----------
function renderAllForecast() {
  renderLegend();
  if (state.table) renderTable();
  else renderChart();
  renderMilestones();
  renderHistory();
  renderModels();
}

function seriesFor(range) {
  const fc = state.fc;
  const hist = fc.history.map((p) => ({ t: Date.parse(p.date), date: p.date, close: p.close }));
  if (range === '1y') return { hist: hist.slice(-53), fut: [], models: [] };
  if (range === '5y') return { hist, fut: [], models: [] };
  const fut = fc.forecast.map((p) => ({ t: Date.parse(p.date), ...p }));
  const models = (fc.models || []).map((m) => ({ ...m, points: m.points.map((p) => ({ t: Date.parse(p.date), ...p })) }));
  return { hist, fut, models };
}

function renderLegend() {
  const fc = state.fc;
  const parts = [`<span><i style="background:${COLORS.history}"></i>Price (weekly)</span>`];
  if (state.range === 'all') {
    if (fc.models) {
      fc.models.forEach((m) =>
        parts.push(`<span style="color:${COLORS[m.key]}"><i class="${m.key === 'drift' ? '' : 'dash'}" style="background:${COLORS[m.key]}"></i><span style="color:var(--ink-2)">${esc(m.name)}${m.key === 'drift' ? ' (main)' : ''}</span></span>`)
      );
    } else {
      parts.push(`<span><i style="background:${COLORS.drift}"></i>Forecast (most likely)</span>`);
    }
    parts.push(`<span><i class="band" style="background:rgba(238,58,58,.32)"></i>80% range</span>`);
    parts.push(`<span><i class="band" style="background:rgba(238,58,58,.13)"></i>95% range</span>`);
  }
  $('#legend').innerHTML = parts.join('');
  const sub = $('#chartSub');
  sub.textContent =
    state.range === 'all'
      ? `Weekly closes adjusted for splits and dividends, plus a ${fc.horizonWeeks / 52}-year forecast. Log scale, so equal heights mean equal % moves.`
      : 'Weekly closes, adjusted for splits and dividends.';
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(min, max, count, log) {
  if (log) {
    const out = [];
    const steps = [1, 2, 5];
    for (let e = Math.floor(Math.log10(min)) - 1; e <= Math.ceil(Math.log10(max)) + 1; e++)
      for (const s of steps) {
        const v = s * 10 ** e;
        if (v >= min && v <= max) out.push(v);
      }
    if (out.length > count + 2) return out.filter((_, i) => i % Math.ceil(out.length / count) === 0);
    if (out.length >= 3) return out;
    // narrow range on a log axis: fall back to linear-spaced ticks
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function renderChart() {
  const box = $('#chart');
  box.innerHTML = '';
  $('#chartTable').hidden = true;
  box.hidden = false;
  const { hist, fut, models } = seriesFor(state.range);
  const fc = state.fc;
  const showFuture = state.range === 'all';
  const lockedFuture = showFuture && fc.locked.fiveYear;

  const W = box.clientWidth || 900;
  const H = box.clientHeight || 420;
  const M = { l: 8, r: showFuture ? 78 : 60, t: 14, b: 28 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;

  const t0 = hist[0].t;
  const lastHist = hist[hist.length - 1];
  let t1 = fut.length ? fut[fut.length - 1].t : lastHist.t;
  if (lockedFuture) t1 = lastHist.t + 5 * 365.25 * 864e5; // reserve the locked 2–5 year area

  let vals = hist.map((p) => p.close);
  fut.forEach((p) => vals.push(p.lo95, p.hi95));
  models.forEach((m) => m.points.forEach((p) => vals.push(p.median)));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const log = showFuture;
  if (log) {
    lo *= 0.92;
    hi *= 1.06;
  } else {
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }

  const x = (t) => M.l + ((t - t0) / (t1 - t0)) * iw;
  const y = log
    ? (v) => M.t + ih - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * ih
    : (v) => M.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, box);
  const defs = el('defs', {}, svg);
  const pat = el('pattern', { id: 'lockHatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 8, height: 8, fill: 'rgba(238,58,58,0.03)' }, pat);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: 'rgba(238,58,58,0.18)', 'stroke-width': 2 }, pat);

  // grid + y axis (right side, like a trading terminal)
  const g = el('g', { class: 'grid' }, svg);
  const ax = el('g', { class: 'axis' }, svg);
  niceTicks(lo, hi, 6, log).forEach((v) => {
    const yy = y(v);
    if (yy < M.t - 2 || yy > M.t + ih + 2) return;
    el('line', { x1: M.l, x2: M.l + iw, y1: yy, y2: yy }, g);
    const tx = el('text', { x: M.l + iw + 8, y: yy + 4 }, ax);
    tx.textContent = v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${v < 10 ? v.toFixed(2) : Math.round(v)}`;
  });

  // x axis: one label per year (or per quarter for 1Y)
  const startY = new Date(t0).getUTCFullYear();
  const endY = new Date(t1).getUTCFullYear();
  if (state.range === '1y') {
    const monthStep = iw < 420 ? 4 : iw < 700 ? 3 : 2;
    for (let d = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth() + 1, 1)); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + monthStep)) {
      const tx = el('text', { x: x(d.getTime()), y: H - 8, 'text-anchor': 'middle' }, ax);
      tx.textContent = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    }
  } else {
    const every = endY - startY > 8 || iw < 420 ? 2 : 1;
    for (let yr = startY + 1; yr <= endY; yr += every) {
      const tt = Date.UTC(yr, 0, 1);
      if (tt < t0 || tt > t1) continue;
      const tx = el('text', { x: x(tt), y: H - 8, 'text-anchor': 'middle' }, ax);
      tx.textContent = yr;
    }
  }

  const path = (pts, key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const band = (pts, loK, hiK) => {
    const start = { t: lastHist.t, [loK]: lastHist.close, [hiK]: lastHist.close };
    const all = [start, ...pts];
    return path(all, hiK) + all.slice().reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p[loK]).toFixed(1)}`).join('') + 'Z';
  };

  if (showFuture && fut.length) {
    el('path', { d: band(fut, 'lo95', 'hi95'), fill: 'rgba(238,58,58,0.13)' }, svg);
    el('path', { d: band(fut, 'lo80', 'hi80'), fill: 'rgba(238,58,58,0.20)' }, svg);
  }

  // locked zone for FREE: years 2–5
  if (lockedFuture) {
    const zx = x(fut[fut.length - 1].t);
    const lz = el('g', { class: 'lock-zone' }, svg);
    el('rect', { x: zx, y: M.t, width: M.l + iw - zx, height: ih, rx: 6 }, lz);
    const a = el('a', { href: '#plans' }, lz);
    const tx = el('text', { x: (zx + M.l + iw) / 2, y: M.t + ih / 2, 'text-anchor': 'middle' }, a);
    tx.textContent = M.l + iw - zx < 260 ? '🔒 Premium' : '🔒 Years 2–5 — unlock with Premium';
  }

  // today divider
  if (showFuture) {
    const tg = el('g', { class: 'today' }, svg);
    el('line', { x1: x(lastHist.t), x2: x(lastHist.t), y1: M.t, y2: M.t + ih }, tg);
    const tx = el('text', { x: x(lastHist.t) + 6, y: M.t + 12 }, tg);
    tx.textContent = 'TODAY';
  }

  // lines
  el('path', { d: path(hist, 'close'), fill: 'none', stroke: COLORS.history, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  const join = (pts) => [{ t: lastHist.t, median: lastHist.close }, ...pts];
  const endLabels = [];
  if (models.length) {
    models.forEach((m) => {
      el('path', { d: path(join(m.points), 'median'), fill: 'none', stroke: COLORS[m.key], 'stroke-width': 2, 'stroke-dasharray': m.key === 'drift' ? '' : '6 5', 'stroke-linejoin': 'round' }, svg);
      endLabels.push({ v: m.points[m.points.length - 1].median, color: COLORS[m.key] });
    });
  } else if (fut.length) {
    el('path', { d: path(join(fut), 'median'), fill: 'none', stroke: COLORS.drift, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    if (!lockedFuture) endLabels.push({ v: fut[fut.length - 1].median, color: COLORS.drift });
  }
  if (!showFuture) endLabels.push({ v: lastHist.close, color: COLORS.history });

  // direct end labels (de-collided)
  endLabels.sort((a, b) => y(a.v) - y(b.v));
  let lastY = -Infinity;
  endLabels.forEach((lab) => {
    let yy = Math.max(y(lab.v), lastY + 16);
    lastY = yy;
    const gx = M.l + iw + 6;
    el('rect', { x: gx, y: yy - 9, width: 64, height: 18, rx: 4, fill: '#000', stroke: lab.color, 'stroke-width': 1 }, svg);
    const tx = el('text', { x: gx + 32, y: yy + 4, 'text-anchor': 'middle', class: 'end-label' }, svg);
    tx.textContent = money(lab.v).replace('.00', '');
  });

  // ---------- hover layer ----------
  const timeline = [
    ...hist.map((p) => ({ t: p.t, date: p.date, kind: 'hist', p })),
    ...fut.map((p, i) => ({ t: p.t, date: p.date, kind: 'fut', p, i })),
  ];
  const cross = el('line', { y1: M.t, y2: M.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1, opacity: 0 }, svg);
  const dots = el('g', { opacity: 0 }, svg);
  const hit = el('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' }, svg);
  const tip = $('#tooltip');

  const show = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    const tt = t0 + ((sx - M.l) / iw) * (t1 - t0);
    let best = timeline[0];
    for (const it of timeline) if (Math.abs(it.t - tt) < Math.abs(best.t - tt)) best = it;
    const cx = x(best.t);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('opacity', 1);
    dots.innerHTML = '';
    dots.setAttribute('opacity', 1);
    const dot = (v, c) => el('circle', { cx, cy: y(v), r: 4.5, fill: c, stroke: '#111114', 'stroke-width': 2 }, dots);

    let rows = '';
    if (best.kind === 'hist') {
      dot(best.p.close, COLORS.history);
      rows = `<div class="tt-row"><span><i class="sw" style="background:${COLORS.history}"></i>Close</span><b>${money(best.p.close)}</b></div>`;
    } else {
      const p = best.p;
      if (models.length) {
        models.forEach((m) => {
          const v = m.points[best.i].median;
          dot(v, COLORS[m.key]);
          rows += `<div class="tt-row"><span><i class="sw" style="background:${COLORS[m.key]}"></i>${esc(m.name)}</span><b>${money(v)}</b></div>`;
        });
      } else {
        dot(p.median, COLORS.drift);
        rows += `<div class="tt-row"><span><i class="sw" style="background:${COLORS.drift}"></i>Most likely</span><b>${money(p.median)}</b></div>`;
      }
      rows += `<div class="tt-row"><span>80% range</span><b>${money(p.lo80)} – ${money(p.hi80)}</b></div>`;
      rows += `<div class="tt-row"><span>95% range</span><b>${money(p.lo95)} – ${money(p.hi95)}</b></div>`;
    }
    tip.innerHTML = `<div class="tt-date">${fmtDate(best.date)}${best.kind === 'fut' ? ' · forecast' : ''}</div>${rows}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = clientX + 16 + tw > innerWidth ? clientX - tw - 16 : clientX + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, clientY - 30)}px`;
  };
  const hide = () => {
    cross.setAttribute('opacity', 0);
    dots.setAttribute('opacity', 0);
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
  hit.addEventListener('pointerdown', (e) => show(e.clientX, e.clientY));
  hit.addEventListener('pointerleave', hide);
}

function renderTable() {
  const { hist, fut, models } = seriesFor(state.range);
  $('#chart').hidden = true;
  const wrap = $('#chartTable');
  wrap.hidden = false;
  const every = state.range === '1y' ? 4 : 13; // monthly for 1Y, quarterly otherwise
  const modelCols = models.filter((m) => m.key !== 'drift');
  let rows = '';
  hist.filter((_, i) => i % every === 0 || i === hist.length - 1).forEach((p) => {
    rows += `<tr><td>${fmtDate(p.date)}</td><td>${money(p.close)}</td><td>—</td><td>—</td>${modelCols.map(() => '<td>—</td>').join('')}</tr>`;
  });
  fut.forEach((p, i) => {
    if ((i + 1) % every && i !== fut.length - 1) return;
    rows += `<tr><td>${fmtDate(p.date)} <span style="color:var(--red)">F</span></td><td>${money(p.median)}</td><td>${money(p.lo80)}</td><td>${money(p.hi80)}</td>${modelCols
      .map((m) => `<td>${money(m.points[i].median)}</td>`)
      .join('')}</tr>`;
  });
  wrap.innerHTML = `<table><thead><tr><th>Date</th><th>Price / forecast</th><th>80% low</th><th>80% high</th>${modelCols.map((m) => `<th>${esc(m.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMilestones() {
  const fc = state.fc;
  const box = $('#milestones');
  const tiles = [];
  for (let yr = 1; yr <= 5; yr++) {
    const m = fc.milestones.find((x) => x.years === yr);
    if (m) {
      tiles.push(`<div class="ms"><div class="ms-body">
        <div class="ms-y">${yr} year${yr > 1 ? 's' : ''} · ${new Date(m.date).getUTCFullYear()}</div>
        <div class="ms-p">${money(m.median)}</div>
        <div class="ms-c ${tone(m.change)}">${arrow(m.change)} ${pct(m.change, 1)}</div>
        <div class="ms-r">80%: ${money(m.lo80)} – ${money(m.hi80)}</div></div></div>`);
    } else {
      tiles.push(`<div class="ms locked"><div class="ms-body">
        <div class="ms-y">${yr} years</div><div class="ms-p">$000.00</div><div class="ms-c">+00.0%</div><div class="ms-r">80%: $000 – $000</div></div>
        <a href="#plans">Premium</a></div>`);
    }
  }
  box.innerHTML = tiles.join('');
}

function renderHistory() {
  const fc = state.fc;
  const s = fc.stats;
  const yrs = s.years >= 4.9 ? '5' : s.years.toFixed(1);
  const items = [
    [`${yrs}-yr return`, pct(s.totalReturn, 1), s.totalReturn],
    ['Avg. yearly growth', pct(s.cagr, 1), s.cagr],
    ['Yearly volatility', pct(s.annualVolatility, 1, false), 0],
    ['Worst drop (peak→low)', pct(s.maxDrawdown, 1), s.maxDrawdown],
  ];
  $('#histStats').innerHTML = items
    .map(([label, v, sign]) => `<dl class="kpi"><dt>${label}</dt><dd class="${sign ? tone(sign) : ''}">${v}</dd></dl>`)
    .join('');
  $('#methodNote').innerHTML = `Forecast method: <b>${esc(fc.method)}</b>. It blends this stock's own five-year trend 50/50 with a long-run market average (~8%/yr), then widens the range using the stock's historical volatility. Implied growth: <b>${pct(fc.impliedAnnualReturn, 1)}/yr</b>.`;
}

function renderModels() {
  const fc = state.fc;
  const body = $('#modelsBody');
  if (!fc.models || !fc.backtest) {
    body.innerHTML = `<div class="locked-panel">
      <p>See three forecasting models side by side, and how accurately each one would have predicted the past year.</p>
      <a class="btn btn-red" href="#plans">Unlock with Max</a></div>`;
    return;
  }
  const bestKey = fc.backtest.reduce((a, b) => (b.mape < a.mape ? b : a)).key;
  const rows = fc.models
    .map((m) => {
      const bt = fc.backtest.find((b) => b.key === m.key);
      const end = m.points[m.points.length - 1].median;
      return `<tr>
        <td><span class="model-name"><i style="background:${COLORS[m.key]}"></i>${esc(m.name)}</span>${m.key === bestKey ? '<span class="best">BEST</span>' : ''}</td>
        <td>${money(end)}</td>
        <td>${bt ? pct(bt.mape, 1, false) : '—'}</td>
        <td class="${bt ? tone(bt.endError) : ''}">${bt ? pct(bt.endError, 1) : '—'}</td></tr>`;
    })
    .join('');
  body.innerHTML = `<table><thead><tr><th>Model</th><th>5-yr target</th><th>Avg. miss</th><th>Year-end miss</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Backtest: each model was fit on data up to one year ago, then scored against what actually happened. "Avg. miss" is the mean absolute % error across that year.</p>`;
}

// ---------- controls ----------
document.querySelectorAll('[data-range]').forEach((b) =>
  b.addEventListener('click', () => {
    state.range = b.dataset.range;
    document.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('is-on', x === b));
    if (state.fc) {
      renderLegend();
      state.table ? renderTable() : renderChart();
    }
  })
);
$('#tableToggle').addEventListener('click', (e) => {
  state.table = !state.table;
  e.currentTarget.setAttribute('aria-pressed', state.table);
  if (state.fc) state.table ? renderTable() : renderChart();
});
let resizeT;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => state.fc && !state.table && renderChart(), 150);
});

// ---------- boot ----------
(async function boot() {
  const params = new URLSearchParams(location.search);
  let sym = params.get('s');
  if (!sym) {
    try { sym = localStorage.getItem('mr_last'); } catch {}
  }
  state.symbol = (sym || 'AAPL').toUpperCase();
  await handleCheckoutReturn();
  await loadPlan();
  loadTape();
  load(state.symbol);
})();
