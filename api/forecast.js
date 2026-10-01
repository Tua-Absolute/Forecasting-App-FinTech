// GET /api/forecast?symbol=AAPL — history plus a forecast sized to the visitor's plan.
//   FREE    → 1-year forecast
//   PREMIUM → 5-year forecast with 80%/95% bands
//   MAX     → 5-year forecast + three-model comparison + one-year backtest accuracy
import { cleanSymbol, getPlan, handle, origin, send } from '../lib/server.js';
import { getHistory } from '../lib/history.js';
import { forecast, TIERS } from '../lib/forecast.js';

async function loadHistory(req, symbol) {
  // Go through our own CDN-cached endpoint first so Alpha Vantage's 25/day limit is shared by all visitors.
  try {
    const r = await fetch(`${origin(req)}/api/history?symbol=${encodeURIComponent(symbol)}`);
    if (r.ok) return await r.json();
    if (r.status === 404 || r.status === 429) {
      const body = await r.json().catch(() => ({}));
      const err = new Error(body.error || 'History unavailable.');
      err.status = r.status;
      throw err;
    }
  } catch (e) {
    if (e.status) throw e;
  }
  return getHistory(symbol);
}

export default handle(async (req, res) => {
  const symbol = cleanSymbol(new URL(req.url, 'http://x').searchParams.get('symbol'));
  const { plan } = getPlan(req);
  const hist = await loadHistory(req, symbol);
  const result = forecast(hist.points, TIERS[plan]);

  send(res, 200, {
    symbol,
    plan,
    source: hist.source,
    history: hist.points.map((p) => ({ date: p.date, close: p.close })),
    ...result,
    locked: {
      fiveYear: plan === 'free',
      models: plan !== 'max',
    },
  });
});
