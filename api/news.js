// GET /api/news?symbol=AAPL — latest company headlines from the past two weeks.
import { cleanSymbol, finnhub, handle, send } from '../lib/server.js';

export default handle(async (req, res) => {
  const symbol = cleanSymbol(new URL(req.url, 'http://x').searchParams.get('symbol'));
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
  const day = (d) => d.toISOString().slice(0, 10);

  const data = await finnhub('/company-news', { symbol, from: day(from), to: day(to) });
  const items = (Array.isArray(data) ? data : [])
    .filter((n) => n.headline && n.url)
    .slice(0, 6)
    .map((n) => ({ headline: n.headline, source: n.source, url: n.url, time: n.datetime }));

  send(res, 200, { items }, 600);
});
