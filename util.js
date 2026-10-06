// Shared formatting and fetch helpers for the dashboard.

export const money = (v, cur = 'USD') =>
  v == null || !isFinite(v)
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v);
export const num = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (v, d = 1, signed = true) => (v == null || !isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
export const big = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return num(v, 0);
};
export const tone = (v) => (v == null || !isFinite(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
export const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '■');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
}

export function flash(msg, kind = 'ok', html = false) {
  const el = document.querySelector('#flash');
  if (!el) return;
  el.className = `flash ${kind}`;
  el[html ? 'innerHTML' : 'textContent'] = msg;
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (el.hidden = true), 7000);
}

export const svgEl = (name, attrs = {}, parent) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
