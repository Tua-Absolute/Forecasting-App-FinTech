// Saved dashboard state, shared by the stock page and the dashboard.
// Lives in this browser's localStorage (no accounts in this demo), so it is per device.

const KEY = 'sf_dashboard_v1';
export const MAX_STOCKS = 3;
// Validated against the dark surface: red, blue, teal. A stock keeps its color slot
// for as long as it is saved, so removing one never repaints the others.
export const SLOT_COLORS = ['#ee3a3a', '#4a7ff0', '#13a3a0'];
export const DEFAULT_METRICS = ['price', 'dayChange', 'marketCap', 'pe', 'ytdReturn', 'forecast1y'];

const blank = () => ({ stocks: [], metrics: [...DEFAULT_METRICS] });
let memory = null; // fallback when storage is blocked

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.stocks) && Array.isArray(d.metrics)) return d;
    }
  } catch {}
  return memory ? structuredClone(memory) : blank();
}

export function save(d) {
  memory = structuredClone(d);
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
  window.dispatchEvent(new CustomEvent('sf-dashboard', { detail: d }));
}

export function has(symbol) {
  return load().stocks.some((s) => s.symbol === symbol);
}

/** @returns {'added'|'exists'|'full'} */
export function addStock(symbol) {
  const d = load();
  if (d.stocks.some((s) => s.symbol === symbol)) return 'exists';
  if (d.stocks.length >= MAX_STOCKS) return 'full';
  const used = new Set(d.stocks.map((s) => s.slot));
  const slot = [0, 1, 2].find((i) => !used.has(i));
  d.stocks.push({ symbol, slot, shares: null, cost: null, target: null, added: new Date().toISOString().slice(0, 10) });
  save(d);
  return 'added';
}

export function removeStock(symbol) {
  const d = load();
  d.stocks = d.stocks.filter((s) => s.symbol !== symbol);
  save(d);
}

export function updateStock(symbol, patch) {
  const d = load();
  const s = d.stocks.find((x) => x.symbol === symbol);
  if (!s) return;
  Object.assign(s, patch);
  save(d);
}

export function setMetrics(keys) {
  const d = load();
  d.metrics = keys;
  save(d);
}

// Keep the two pages in sync if both are open in different tabs.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) window.dispatchEvent(new CustomEvent('sf-dashboard', { detail: load() }));
});
