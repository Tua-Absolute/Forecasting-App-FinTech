// GET /api/market — quotes for the ticker strip across the top of the page.
import { finnhub, handle, send } from '../lib/server.js';

const STRIP = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'DIA', label: 'Dow 30' },
  { symbol: 'IWM', label: 'Russell 2000' },
  { symbol: 'AAPL', label: 'Apple' },
  { symbol: 'MSFT', label: 'Microsoft' },
  { symbol: 'NVDA', label: 'Nvidia' },
  { symbol: 'AMZN', label: 'Amazon' },
  { symbol: 'TSLA', label: 'Tesla' },
];

export default handle(async (req, res) => {
  const quotes = await Promise.all(
    STRIP.map(async (s) => {
      try {
        const q = await finnhub('/quote', { symbol: s.symbol });
        return { ...s, price: q.c, changePercent: q.dp };
      } catch {
        return { ...s, price: null, changePercent: null };
      }
    })
  );
  send(res, 200, { quotes }, 60);
});
