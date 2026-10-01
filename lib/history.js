// Five years of weekly, split/dividend-adjusted closes from Alpha Vantage (free endpoint).
// Alpha Vantage's free key allows ~25 calls/day, so results are cached in memory here
// and at Vercel's CDN by /api/history (12 hours).
import { requireEnv } from './server.js';

const memo = new Map(); // symbol -> { at, data }
const TTL = 12 * 3600 * 1000;

export async function getHistory(symbol) {
  const hit = memo.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const key = requireEnv('ALPHAVANTAGE_API_KEY');
  const qs = new URLSearchParams({ function: 'TIME_SERIES_WEEKLY_ADJUSTED', symbol, apikey: key });
  const r = await fetch(`https://www.alphavantage.co/query?${qs}`);
  if (!r.ok) {
    const err = new Error(`Alpha Vantage returned ${r.status}.`);
    err.status = 502;
    throw err;
  }
  const json = await r.json();

  if (json.Information || json.Note) {
    const err = new Error(
      "Alpha Vantage's free daily limit (25 requests) has been reached. Charts already viewed today still load; new symbols work again tomorrow."
    );
    err.status = 429;
    throw err;
  }
  if (json['Error Message']) {
    const err = new Error(`No price history found for ${symbol}.`);
    err.status = 404;
    throw err;
  }

  const raw = json['Weekly Adjusted Time Series'] || {};
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 5);
  const cut = cutoff.toISOString().slice(0, 10);

  const points = Object.entries(raw)
    .filter(([date]) => date >= cut)
    .map(([date, v]) => ({
      date,
      close: Number(v['5. adjusted close']),
      rawClose: Number(v['4. close']),
      volume: Number(v['6. volume']),
    }))
    .filter((p) => p.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (points.length < 10) {
    const err = new Error(`Not enough price history for ${symbol}.`);
    err.status = 404;
    throw err;
  }

  const data = { symbol, source: 'Alpha Vantage (weekly, adjusted)', points };
  memo.set(symbol, { at: Date.now(), data });
  return data;
}
