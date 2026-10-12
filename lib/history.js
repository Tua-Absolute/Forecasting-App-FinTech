// Five years of weekly, split/dividend-adjusted closes from Alpha Vantage (free endpoint).
// Alpha Vantage's free key allows ~25 calls/day, so results are cached in memory here
// and at Vercel's CDN by /api/history (12 hours).
import { requireEnv } from './server.js';

const memo = new Map(); // symbol -> { at, data }
const TTL = 12 * 3600 * 1000;

const inflight = new Map(); // symbol -> Promise, so parallel requests share one upstream call
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getHistory(symbol) {
  const hit = memo.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  if (inflight.has(symbol)) return inflight.get(symbol);
  const p = fetchHistory(symbol).finally(() => inflight.delete(symbol));
  inflight.set(symbol, p);
  return p;
}

async function fetchHistory(symbol) {
  const key = requireEnv('ALPHAVANTAGE_API_KEY');
  const qs = new URLSearchParams({ function: 'TIME_SERIES_WEEKLY_ADJUSTED', symbol, apikey: key });

  let json;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://www.alphavantage.co/query?${qs}`);
    if (!r.ok) {
      const err = new Error(`Alpha Vantage returned ${r.status}.`);
      err.status = 502;
      throw err;
    }
    json = await r.json();
    const note = String(json.Information || json.Note || '');
    if (!note) break;
    // Free keys also allow only ~1 request per second; several charts loading at once trip this.
    if (/per second|sparingly|spreading out|burst/i.test(note) && attempt < 3) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    const daily = /per day|daily|25 requests/i.test(note);
    const err = new Error(
      daily
        ? "Alpha Vantage's free daily limit (25 requests) has been reached. Charts already viewed today still load; new symbols work again tomorrow."
        : `Alpha Vantage: ${note}`
    );
    err.status = daily ? 429 : 502;
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
