// GET /api/history?symbol=AAPL — five years of weekly adjusted closes, CDN-cached for 12 hours.
import { cleanSymbol, handle, send } from '../lib/server.js';
import { getHistory } from '../lib/history.js';

export default handle(async (req, res) => {
  const symbol = cleanSymbol(new URL(req.url, 'http://x').searchParams.get('symbol'));
  send(res, 200, await getHistory(symbol), 12 * 3600);
});
