// Stealth Forecast — dashboard page.
import * as store from './store.js';
import { money, num, pct, big, tone, arrow, esc, api, flash, fmtDate, svgEl } from './util.js';

const $ = (s, root = document) => root.querySelector(s);
const cache = new Map(); // symbol -> { loading, stock, stockErr, fc, fcErr }
let plan = 'free';
let perfRange = '1y';
let slotKey = null; // which symbols the slot DOM was built for (null = not built yet)

// ---------- metric catalog ----------
// get(c) returns the number used for sorting/"best"; show(c) returns the cell HTML.
// better: 'high' | 'low' | null (no "best" marker for neutral metrics like beta or market cap).
const P = (v) => (v == null || !isFinite(v) ? null : v / 100); // Finnhub sends percents as 12.4

const GROUPS = ['Price', 'Valuation', 'Performance', 'Risk', 'Fundamentals', 'Forecast', 'My position'];
const METRICS = [
  { key: 'price', group: 'Price', label: 'Price', get: (c) => c.q?.price, show: (c, v) => money(v, c.cur) },
  { key: 'dayChange', group: 'Price', label: 'Day change', get: (c) => P(c.q?.changePercent), show: (c, v) => pctCell(v), better: 'high' },
  { key: 'dayRange', group: 'Price', label: "Day's range", get: () => null, show: (c) => (c.q ? `${money(c.q.low, c.cur)} – ${money(c.q.high, c.cur)}` : '—') },
  {
    key: 'range52', group: 'Price', label: '52-week position', hint: '0% = at the 52-week low, 100% = at the high',
    get: (c) => (c.q && c.m?.week52High > c.m?.week52Low ? Math.min(1, Math.max(0, (c.q.price - c.m.week52Low) / (c.m.week52High - c.m.week52Low))) : null),
    show: (c, v) => (v == null ? '—' : `${pct(v, 0, false)}<span class="sub2">${money(c.m.week52Low, c.cur)} – ${money(c.m.week52High, c.cur)}</span>`),
  },
  { key: 'marketCap', group: 'Valuation', label: 'Market cap', get: (c) => c.p?.marketCap, show: (c, v) => big(v) },
  { key: 'pe', group: 'Valuation', label: 'P/E ratio', hint: 'Price ÷ earnings; lower is cheaper', get: (c) => c.m?.pe, show: (c, v) => num(v), better: 'low', positiveOnly: true },
  { key: 'eps', group: 'Valuation', label: 'EPS (TTM)', get: (c) => c.m?.eps, show: (c, v) => money(v, c.cur), better: 'high' },
  { key: 'pb', group: 'Valuation', label: 'Price / book', get: (c) => c.m?.priceToBook, show: (c, v) => num(v), better: 'low', positiveOnly: true },
  { key: 'divYield', group: 'Valuation', label: 'Dividend yield', get: (c) => P(c.m?.dividendYield) ?? (c.m ? 0 : null), show: (c, v) => pct(v, 2, false), better: 'high' },
  { key: 'ytdReturn', group: 'Performance', label: 'YTD return', get: (c) => P(c.m?.ytdReturn), show: (c, v) => pctCell(v), better: 'high' },
  { key: 'return52', group: 'Performance', label: '52-week return', get: (c) => P(c.m?.week52Return), show: (c, v) => pctCell(v), better: 'high' },
  { key: 'return5y', group: 'Performance', label: '5-year return', get: (c) => c.fc?.stats?.totalReturn, show: (c, v) => pctCell(v), better: 'high', needs: 'fc' },
  { key: 'cagr', group: 'Performance', label: 'Avg. yearly growth', hint: 'Compound annual growth over 5 years', get: (c) => c.fc?.stats?.cagr, show: (c, v) => pctCell(v), better: 'high', needs: 'fc' },
  { key: 'beta', group: 'Risk', label: 'Beta', hint: '1.0 moves with the market; higher swings more', get: (c) => c.m?.beta, show: (c, v) => num(v) },
  { key: 'volatility', group: 'Risk', label: 'Yearly volatility', get: (c) => c.fc?.stats?.annualVolatility, show: (c, v) => pct(v, 1, false), better: 'low', needs: 'fc' },
  { key: 'drawdown', group: 'Risk', label: 'Worst drop (5 yr)', get: (c) => c.fc?.stats?.maxDrawdown, show: (c, v) => pctCell(v), better: 'high', needs: 'fc' },
  { key: 'netMargin', group: 'Fundamentals', label: 'Net margin', get: (c) => P(c.m?.netMargin), show: (c, v) => pct(v, 1, false), better: 'high' },
  { key: 'revGrowth', group: 'Fundamentals', label: 'Revenue growth (YoY)', get: (c) => P(c.m?.revenueGrowth), show: (c, v) => pctCell(v), better: 'high' },
  { key: 'volume', group: 'Fundamentals', label: 'Avg. volume (10 day)', get: (c) => c.m?.avgVolume10d, show: (c, v) => big(v) },
  {
    key: 'forecast1y', group: 'Forecast', label: '1-year forecast', hint: 'Most likely price in one year',
    get: (c) => ms(c, 1)?.change, show: (c, v) => (v == null ? '—' : `${money(ms(c, 1).median, c.cur)}<span class="sub2 ${tone(v)}">${pct(v)}</span>`), better: 'high', needs: 'fc',
  },
  {
    key: 'range1y', group: 'Forecast', label: '1-year likely range', hint: '80% of outcomes fall inside this range',
    get: () => null, show: (c) => (ms(c, 1) ? `${money(ms(c, 1).lo80, c.cur)} – ${money(ms(c, 1).hi80, c.cur)}` : '—'), needs: 'fc',
  },
  {
    key: 'forecast5y', group: 'Forecast', label: '5-year forecast', premium: true,
    get: (c) => ms(c, 5)?.change, show: (c, v) => (v == null ? '—' : `${money(ms(c, 5).median, c.cur)}<span class="sub2 ${tone(v)}">${pct(v)}</span>`), better: 'high', needs: 'fc',
  },
  { key: 'posValue', group: 'My position', label: 'Market value', get: (c) => pos(c).value, show: (c, v) => money(v, c.cur), needs: 'pos' },
  { key: 'posGain', group: 'My position', label: 'Gain / loss', get: (c) => pos(c).gain, show: (c, v) => (v == null ? '—' : `<span class="${tone(v)}">${v > 0 ? '+' : ''}${money(v, c.cur)}</span>`), better: 'high', needs: 'pos' },
  { key: 'posGainPct', group: 'My position', label: 'Gain / loss %', get: (c) => pos(c).gainPct, show: (c, v) => pctCell(v), better: 'high', needs: 'pos' },
  { key: 'toTarget', group: 'My position', label: 'To my target', hint: 'How far the price is from the target you set', get: (c) => pos(c).toTarget, show: (c, v) => pctCell(v), needs: 'pos' },
];
const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

function pctCell(v) {
  return v == null ? '—' : `<span class="${tone(v)}">${pct(v)}</span>`;
}
function ms(c, years) {
  return c.fc?.milestones?.find((m) => m.years === years) || null;
}
function pos(c) {
  const price = c.q?.price;
  const { shares, cost, target } = c.entry;
  const out = { value: null, gain: null, gainPct: null, toTarget: null, today: null, basis: null };
  if (!price) return out;
  if (shares > 0) {
    out.value = shares * price;
    out.today = shares * (c.q.change || 0);
    if (cost > 0) {
      out.basis = shares * cost;
      out.gain = out.value - out.basis;
    }
  }
  if (cost > 0) out.gainPct = price / cost - 1;
  if (target > 0) out.toTarget = target / price - 1;
  return out;
}

function ctx(entry) {
  const d = cache.get(entry.symbol) || {};
  return {
    entry,
    loading: d.loading,
    q: d.stock?.quote,
    p: d.stock?.profile,
    m: d.stock?.metrics,
    cur: d.stock?.profile?.currency || 'USD',
    fc: d.fc,
    fcErr: d.fcErr,
    stockErr: d.stockErr,
  };
}

// ---------- data ----------
async function loadSymbol(sym, { quotesOnly = false } = {}) {
  const d = cache.get(sym) || {};
  d.loading = !d.stock;
  cache.set(sym, d);
  const jobs = [
    api(`/api/stock?symbol=${encodeURIComponent(sym)}`)
      .then((s) => ((d.stock = s), (d.stockErr = null)))
      .catch((e) => (d.stockErr = e.message)),
  ];
  if (!quotesOnly)
    jobs.push(
      api(`/api/forecast?symbol=${encodeURIComponent(sym)}`)
        .then((f) => {
          d.fc = f;
          d.fcErr = null;
          if (f.plan && f.plan !== plan) {
            plan = f.plan;
            renderPlan();
          }
        })
        .catch((e) => (d.fcErr = e.message))
    );
  await Promise.allSettled(jobs);
  d.loading = false;
  renderData();
}

function loadAll(opts) {
  return Promise.all(store.load().stocks.map((s) => loadSymbol(s.symbol, opts)));
}

async function loadPlan() {
  try {
    plan = (await api('/api/plan')).plan;
  } catch {}
  renderPlan();
}
function renderPlan() {
  const b = $('#planBadge');
  b.dataset.plan = plan;
  b.textContent = plan.toUpperCase();
}

// ---------- rendering ----------
function render() {
  const { stocks } = store.load();
  const key = stocks.map((s) => s.symbol).join(',');
  if (key !== slotKey) buildSlots(stocks);
  slotKey = key;
  renderData();
}

function renderData() {
  const d = store.load();
  const count = $('#count');
  count.textContent = `${d.stocks.length} / ${store.MAX_STOCKS} stocks`;
  count.classList.toggle('full', d.stocks.length >= store.MAX_STOCKS);
  d.stocks.forEach(updateSlot);
  renderPortfolio(d);
  renderCompare(d);
  renderPerf(d);
}

// ----- slots -----
function buildSlots(stocks) {
  const box = $('#slots');
  box.innerHTML = '';
  stocks.forEach((s) => box.appendChild(slotCard(s)));
  for (let i = stocks.length; i < store.MAX_STOCKS; i++) box.appendChild(emptyCard(i === stocks.length, stocks.length));
}

function slotCard(s) {
  const el = document.createElement('article');
  el.className = 'slot';
  el.dataset.sym = s.symbol;
  el.style.setProperty('--slot', store.SLOT_COLORS[s.slot]);
  const field = (name, label, val, step, ph) =>
    `<label>${label}<input type="number" inputmode="decimal" min="0" step="${step}" data-field="${name}" value="${val ?? ''}" placeholder="${ph}" /></label>`;
  el.innerHTML = `
    <div class="slot-top">
      <div class="slot-id">
        <a class="slot-sym" href="/?s=${encodeURIComponent(s.symbol)}" title="Open ${esc(s.symbol)} forecast"><i></i>${esc(s.symbol)}</a>
        <div class="slot-name" data-out="name">Loading…</div>
      </div>
      <button class="icon-btn" data-remove title="Remove ${esc(s.symbol)} from dashboard" aria-label="Remove ${esc(s.symbol)}">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="slot-price" data-out="price">—</div>
    <div class="slot-chg" data-out="chg"></div>
    <div class="spark" data-out="spark" aria-hidden="true"></div>
    <div class="position">
      <h3>My position</h3>
      <div class="pos-inputs">
        ${field('shares', 'Shares', s.shares, 'any', '0')}
        ${field('cost', 'Avg. cost', s.cost, '0.01', '$0.00')}
        ${field('target', 'Target', s.target, '0.01', '$0.00')}
      </div>
      <div data-out="pos"></div>
    </div>`;
  el.querySelector('[data-remove]').addEventListener('click', () => {
    store.removeStock(s.symbol);
    cache.delete(s.symbol);
    flash(`${s.symbol} removed from your dashboard.`);
    render();
  });
  el.querySelectorAll('input[data-field]').forEach((inp) =>
    inp.addEventListener('input', () => {
      const v = inp.value === '' ? null : Number(inp.value);
      store.updateStock(s.symbol, { [inp.dataset.field]: v != null && isFinite(v) && v >= 0 ? v : null });
      renderData();
    })
  );
  return el;
}

function updateSlot(entry) {
  const el = $(`.slot[data-sym="${CSS.escape(entry.symbol)}"]`);
  if (!el) return;
  const c = ctx(entry);
  const out = (k) => el.querySelector(`[data-out="${k}"]`);
  if (c.stockErr && !c.q) {
    out('name').textContent = c.stockErr;
    out('price').textContent = '—';
    out('chg').textContent = '';
  } else if (c.q) {
    out('name').textContent = c.p?.name || entry.symbol;
    out('price').textContent = money(c.q.price, c.cur);
    out('chg').className = `slot-chg ${tone(c.q.change)}`;
    out('chg').textContent = `${arrow(c.q.change)} ${c.q.change > 0 ? '+' : ''}${num(c.q.change)} (${c.q.changePercent > 0 ? '+' : ''}${num(c.q.changePercent)}%) today`;
  }
  drawSpark(out('spark'), c, store.SLOT_COLORS[entry.slot]);

  const p = pos(c);
  const hasPos = entry.shares > 0 || entry.cost > 0 || entry.target > 0;
  out('pos').innerHTML = hasPos
    ? `<div class="pos-out">
        <div>Value<b>${p.value == null ? '—' : money(p.value, c.cur)}</b></div>
        <div>Gain / loss<b class="${tone(p.gain ?? p.gainPct)}">${p.gain != null ? `${p.gain > 0 ? '+' : ''}${money(p.gain, c.cur)}` : pct(p.gainPct)}</b></div>
        <div>To target<b class="${tone(p.toTarget)}">${pct(p.toTarget)}</b></div>
      </div>`
    : `<p class="pos-hint">Enter your shares and average cost to track gain/loss, and a target price to see how far away it is.</p>`;
}

function drawSpark(box, c, color) {
  const pts = c.fc?.history?.slice(-53);
  box.innerHTML = '';
  if (!pts || pts.length < 2) return;
  const W = 300, H = 46;
  const vals = pts.map((p) => p.close);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, box);
  svgEl('line', { x1: 0, x2: W, y1: y(vals[0]), y2: y(vals[0]), stroke: 'var(--line-strong)', 'stroke-dasharray': '3 4', 'vector-effect': 'non-scaling-stroke' }, svg);
  svgEl('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }, svg);
}

function emptyCard(primary, filled) {
  const el = document.createElement('article');
  el.className = 'slot slot-empty';
  if (!primary) {
    el.innerHTML = `<p class="slot-full">Empty slot</p>`;
    return el;
  }
  const saved = new Set(store.load().stocks.map((s) => s.symbol));
  const quick = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA'].filter((s) => !saved.has(s)).slice(0, 5);
  el.innerHTML = `
    <h3>${filled ? 'Add another stock' : 'Add your first stock'}</h3>
    <p>${filled ? `Compare up to ${store.MAX_STOCKS} side by side.` : 'Search by company name or ticker.'}</p>
    <form class="add-search" autocomplete="off">
      <input type="search" placeholder="e.g. Ford or F" aria-label="Add a stock to the dashboard" />
      <ul class="results" role="listbox" hidden></ul>
    </form>
    <div class="quick">${quick.map((s) => `<button type="button" data-q="${s}">+ ${s}</button>`).join('')}</div>`;
  wireSearch(el.querySelector('form'));
  el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => addSymbol(b.dataset.q)));
  return el;
}

function wireSearch(form) {
  const input = form.querySelector('input');
  const list = form.querySelector('.results');
  let results = [];
  let active = -1;
  let t;
  const draw = (msg) => {
    list.innerHTML = msg
      ? `<li class="r-empty">${esc(msg)}</li>`
      : results.map((r, i) => `<li role="option" aria-selected="${i === active}" data-i="${i}"><span class="r-sym">${esc(r.symbol)}</span><span class="r-name">${esc(r.name)}</span></li>`).join('');
    list.hidden = false;
  };
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) return (list.hidden = true);
    t = setTimeout(async () => {
      try {
        results = (await api(`/api/search?q=${encodeURIComponent(q)}`)).results;
        active = results.length ? 0 : -1;
        results.length ? draw() : draw('No US stocks match. Press Enter to add it as a ticker.');
      } catch (e) {
        draw(e.message);
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
    draw();
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    addSymbol(results[+li.dataset.i].symbol);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pick = !list.hidden && results[active] ? results[active].symbol : input.value.trim().toUpperCase();
    if (pick && /^[A-Z0-9.\-]{1,12}$/i.test(pick)) addSymbol(pick.toUpperCase());
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));
}

function addSymbol(sym) {
  const r = store.addStock(sym);
  if (r === 'exists') return flash(`${sym} is already on your dashboard.`, 'err');
  if (r === 'full') return flash(`Your dashboard holds ${store.MAX_STOCKS} stocks. Remove one to add ${sym}.`, 'err');
  render();
  loadSymbol(sym);
}

// ----- portfolio totals -----
function renderPortfolio(d) {
  const box = $('#portfolio');
  const rows = d.stocks.map((e) => ({ c: ctx(e), p: pos(ctx(e)) })).filter((r) => r.p.value != null);
  if (!rows.length) {
    box.hidden = true;
    return;
  }
  const sum = (k) => rows.reduce((a, r) => a + (r.p[k] ?? 0), 0);
  const value = sum('value');
  const withBasis = rows.filter((r) => r.p.basis != null);
  const basis = withBasis.reduce((a, r) => a + r.p.basis, 0);
  const gain = withBasis.reduce((a, r) => a + r.p.gain, 0);
  const today = sum('today');
  const prevValue = value - today;
  const signed = (v) => `${v > 0 ? '+' : ''}${money(v)}`;
  box.hidden = false;
  box.innerHTML = `
    <div><dl><dt>Market value</dt><dd>${money(value)}</dd></dl></div>
    <div><dl><dt>Cost basis</dt><dd>${withBasis.length ? money(basis) : '—'}</dd></dl></div>
    <div><dl><dt>Total gain / loss</dt><dd class="${tone(gain)}">${withBasis.length ? signed(gain) : '—'}${withBasis.length && basis ? `<small>${pct(gain / basis)}</small>` : ''}</dd></dl></div>
    <div><dl><dt>Today</dt><dd class="${tone(today)}">${signed(today)}${prevValue ? `<small>${pct(today / prevValue, 2)}</small>` : ''}</dd></dl></div>`;
}

// ----- metric picker + comparison table -----
function renderPicker() {
  const chosen = new Set(store.load().metrics);
  const box = $('#picker');
  box.innerHTML =
    GROUPS.map(
      (g) => `<fieldset><legend>${g}</legend>${METRICS.filter((m) => m.group === g)
        .map(
          (m) => `<label title="${esc(m.hint || '')}"><input type="checkbox" value="${m.key}" ${chosen.has(m.key) ? 'checked' : ''} />${esc(m.label)}${
            m.premium && plan === 'free' ? ' <span class="lock">PREMIUM</span>' : ''
          }</label>`
        )
        .join('')}</fieldset>`
    ).join('') + `<div class="picker-foot"><button type="button" data-reset>Reset to defaults</button><button type="button" data-done>Done</button></div>`;
  box.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('change', () => {
      const keys = [...box.querySelectorAll('input:checked')].map((i) => i.value);
      store.setMetrics(METRICS.map((m) => m.key).filter((k) => keys.includes(k)));
      renderCompare(store.load());
    })
  );
  box.querySelector('[data-reset]').addEventListener('click', () => {
    store.setMetrics([...store.DEFAULT_METRICS]);
    renderPicker();
    renderCompare(store.load());
  });
  box.querySelector('[data-done]').addEventListener('click', togglePicker);
}

function togglePicker() {
  const box = $('#picker');
  const open = box.hidden;
  box.hidden = !open;
  $('#metricsBtn').setAttribute('aria-expanded', open);
  $('#metricsBtn').textContent = open ? 'Close' : 'Choose metrics';
  if (open) renderPicker();
}

function renderCompare(d) {
  const card = $('#compareCard');
  card.hidden = d.stocks.length === 0;
  if (card.hidden) return;
  const table = $('#compare');
  const keys = d.metrics.filter((k) => METRIC[k]);
  $('#compareSub').textContent = `${keys.length} tracked metric${keys.length === 1 ? '' : 's'}${d.stocks.length > 1 ? '. The strongest value in each row is marked.' : '.'}`;
  if (!keys.length) {
    table.innerHTML = `<tbody><tr><td class="empty-metrics">No metrics selected. Use “Choose metrics” to pick what to track.</td></tr></tbody>`;
    return;
  }
  const cols = d.stocks.map(ctx);
  const head = `<thead><tr><th>Metric</th>${cols
    .map((c) => `<th><span class="col-sym"><i style="background:${store.SLOT_COLORS[c.entry.slot]}"></i>${esc(c.entry.symbol)}</span></th>`)
    .join('')}</tr></thead>`;

  let body = '';
  for (const g of GROUPS) {
    const ms = keys.map((k) => METRIC[k]).filter((m) => m.group === g);
    if (!ms.length) continue;
    body += `<tr class="group-row"><th colspan="${cols.length + 1}">${g}</th></tr>`;
    for (const m of ms) {
      const vals = cols.map((c) => {
        try {
          return m.get(c);
        } catch {
          return null;
        }
      });
      // "best" marker: only with 2+ comparable values
      let bestIdx = -1;
      if (m.better && cols.length > 1) {
        const cands = vals.map((v, i) => [v, i]).filter(([v]) => v != null && isFinite(v) && (!m.positiveOnly || v > 0));
        if (cands.length > 1) {
          cands.sort((a, b) => (m.better === 'high' ? b[0] - a[0] : a[0] - b[0]));
          if (cands[0][0] !== cands[1][0]) bestIdx = cands[0][1];
        }
      }
      const cells = cols
        .map((c, i) => {
          if (c.loading) return `<td>…</td>`;
          if (m.premium && plan === 'free') return `<td class="locked"><a href="/#plans">🔒 Premium</a></td>`;
          if (m.needs === 'fc' && !c.fc) return `<td title="${esc(c.fcErr || '')}">—</td>`;
          if (m.needs === 'pos' && vals[i] == null) return `<td><span class="sub2">Enter position</span></td>`;
          return `<td class="${i === bestIdx ? 'is-best' : ''}">${m.show(c, vals[i])}</td>`;
        })
        .join('');
      body += `<tr><th scope="row">${esc(m.label)}${m.hint ? `<small>${esc(m.hint)}</small>` : ''}</th>${cells}</tr>`;
    }
  }
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

// ----- indexed performance chart -----
function niceStep(span, count) {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => span / s <= count) || mag * 10;
}

function renderPerf(d) {
  const card = $('#perfCard');
  card.hidden = d.stocks.length === 0;
  if (card.hidden) return;
  const box = $('#perfChart');
  const errBox = $('#perfError');
  const series = d.stocks
    .map((e) => {
      const c = ctx(e);
      const hist = c.fc?.history;
      if (!hist?.length) return null;
      const pts = perfRange === '1y' ? hist.slice(-53) : hist;
      const base = pts[0].close;
      return {
        sym: e.symbol,
        color: store.SLOT_COLORS[e.slot],
        pts: pts.map((p) => ({ t: Date.parse(p.date), date: p.date, close: p.close, v: p.close / base - 1 })),
      };
    })
    .filter(Boolean);

  const anyLoading = d.stocks.some((e) => cache.get(e.symbol)?.loading);
  if (!series.length) {
    box.innerHTML = anyLoading ? '<div class="skeleton"></div>' : '';
    $('#perfLegend').innerHTML = '';
    const err = d.stocks.map((e) => cache.get(e.symbol)?.fcErr).find(Boolean);
    errBox.hidden = anyLoading || !err;
    errBox.textContent = err || '';
    return;
  }
  errBox.hidden = true;
  $('#perfLegend').innerHTML =
    series.length > 1
      ? series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.sym)}</span>`).join('')
      : '';
  $('#perfSub').textContent = `Percent change since ${fmtDate(series[0].pts[0].date)}, so stocks at different prices compare fairly.`;

  box.innerHTML = '';
  const W = box.clientWidth || 900;
  const H = box.clientHeight || 360;
  const M = { l: 8, r: 96, t: 12, b: 28 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const all = series.flatMap((s) => s.pts);
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  let lo = Math.min(0, ...all.map((p) => p.v));
  let hi = Math.max(0, ...all.map((p) => p.v));
  const pad = (hi - lo) * 0.08 || 0.05;
  lo -= pad;
  hi += pad;
  const x = (t) => M.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (v) => M.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, box);
  const grid = svgEl('g', { class: 'grid' }, svg);
  const ax = svgEl('g', { class: 'axis' }, svg);
  const step = niceStep(hi - lo, 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const vv = Math.abs(v) < 1e-9 ? 0 : v;
    svgEl('line', { x1: M.l, x2: M.l + iw, y1: y(vv), y2: y(vv), ...(vv === 0 ? { style: 'stroke: var(--ink-3)' } : {}) }, grid);
    const t = svgEl('text', { x: M.l + iw + 8, y: y(vv) + 4 }, ax);
    t.textContent = `${vv > 0 ? '+' : ''}${(vv * 100).toFixed(step < 0.05 ? 1 : 0)}%`;
  }
  // x labels
  if (perfRange === '1y') {
    const d0 = new Date(t0);
    const every = iw < 420 ? 4 : iw < 700 ? 3 : 2;
    for (let dt = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); dt.getTime() <= t1; dt.setUTCMonth(dt.getUTCMonth() + every)) {
      const t = svgEl('text', { x: x(dt.getTime()), y: H - 8, 'text-anchor': 'middle' }, ax);
      t.textContent = dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    }
  } else {
    for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr += iw < 420 ? 2 : 1) {
      const t = svgEl('text', { x: x(Date.UTC(yr, 0, 1)), y: H - 8, 'text-anchor': 'middle' }, ax);
      t.textContent = yr;
    }
  }

  series.forEach((s) =>
    svgEl('path', { d: s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(''), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg)
  );

  // direct end labels, de-collided
  const ends = series.map((s) => ({ s, v: s.pts[s.pts.length - 1].v })).sort((a, b) => y(a.v) - y(b.v));
  let lastY = -Infinity;
  ends.forEach(({ s, v }) => {
    const yy = Math.max(y(v), lastY + 20);
    lastY = yy;
    const gx = M.l + iw + 6;
    svgEl('rect', { x: gx, y: yy - 10, width: 86, height: 20, rx: 4, fill: '#000', stroke: s.color }, svg);
    const t = svgEl('text', { x: gx + 43, y: yy + 4, 'text-anchor': 'middle', class: 'end-label' }, svg);
    t.textContent = `${s.sym} ${pct(v, 0)}`;
  });

  // hover
  const cross = svgEl('line', { y1: M.t, y2: M.t + ih, stroke: 'var(--ink-3)', opacity: 0 }, svg);
  const dots = svgEl('g', {}, svg);
  const hit = svgEl('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' }, svg);
  const tip = $('#tooltip');
  const nearest = (pts, t) => pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), pts[0]);
  const show = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((((cx - r.left) / r.width) * W - M.l) / iw) * (t1 - t0);
    const ref = nearest(series[0].pts, t);
    cross.setAttribute('x1', x(ref.t));
    cross.setAttribute('x2', x(ref.t));
    cross.setAttribute('opacity', 1);
    dots.innerHTML = '';
    const rows = series
      .map((s) => {
        const p = nearest(s.pts, ref.t);
        svgEl('circle', { cx: x(p.t), cy: y(p.v), r: 4.5, fill: s.color, stroke: '#111114', 'stroke-width': 2 }, dots);
        return { s, p };
      })
      .sort((a, b) => b.p.v - a.p.v)
      .map(({ s, p }) => `<div class="tt-row"><span><i class="sw" style="background:${s.color}"></i>${esc(s.sym)}</span><b>${pct(p.v)} · ${money(p.close)}</b></div>`)
      .join('');
    tip.innerHTML = `<div class="tt-date">${fmtDate(ref.date)}</div>${rows}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${cx + 16 + tw > innerWidth ? cx - tw - 16 : cx + 16}px`;
    tip.style.top = `${Math.max(8, cy - 30)}px`;
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
  hit.addEventListener('pointerdown', (e) => show(e.clientX, e.clientY));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    dots.innerHTML = '';
    tip.hidden = true;
  });
}

// ---------- controls ----------
$('#metricsBtn').addEventListener('click', togglePicker);
$('#refreshBtn').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  await loadAll({ quotesOnly: true });
  e.currentTarget.disabled = false;
  flash('Prices refreshed.');
});
document.querySelectorAll('[data-perf]').forEach((b) =>
  b.addEventListener('click', () => {
    perfRange = b.dataset.perf;
    document.querySelectorAll('[data-perf]').forEach((x) => x.classList.toggle('is-on', x === b));
    renderPerf(store.load());
  })
);
let resizeT;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => renderPerf(store.load()), 150);
});
// Another tab (e.g. the stock page) changed the saved list.
addEventListener('storage', () => {
  render();
  store.load().stocks.forEach((s) => !cache.has(s.symbol) && loadSymbol(s.symbol));
});
// Refresh quotes every minute while the page is visible.
setInterval(() => document.visibilityState === 'visible' && store.load().stocks.length && loadAll({ quotesOnly: true }), 60000);

// ---------- boot ----------
render();
loadPlan();
loadAll();
