// GET /api/search?q=apple — symbol lookup for the search bar (US common stocks and ETFs).
import { finnhub, handle, send } from '../lib/server.js';

export default handle(async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q')?.trim() || '';
  if (q.length < 1 || q.length > 40) return send(res, 200, { results: [] });

  const data = await finnhub('/search', { q, exchange: 'US' });
  const results = (data?.result || [])
    .filter((r) => r.symbol && !r.symbol.includes('.') && ['Common Stock', 'ETP', 'ADR'].includes(r.type))
    .slice(0, 8)
    .map((r) => ({ symbol: r.symbol, name: r.description, type: r.type }));

  send(res, 200, { results }, 3600);
});
