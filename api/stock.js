// GET /api/stock?symbol=AAPL — live quote, company profile and key metrics from Finnhub.
import { cleanSymbol, finnhub, handle, send } from '../lib/server.js';

export default handle(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const symbol = cleanSymbol(url.searchParams.get('symbol'));

  const [quote, profile, metrics] = await Promise.all([
    finnhub('/quote', { symbol }),
    finnhub('/stock/profile2', { symbol }),
    finnhub('/stock/metric', { symbol, metric: 'all' }),
  ]);

  if (!quote || (!quote.c && !quote.pc)) {
    return send(res, 404, { error: `No live quote found for ${symbol}. Finnhub's free plan covers US-listed stocks.` });
  }

  const m = metrics?.metric || {};
  send(
    res,
    200,
    {
      symbol,
      quote: {
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        open: quote.o,
        high: quote.h,
        low: quote.l,
        previousClose: quote.pc,
        time: quote.t,
      },
      profile: {
        name: profile?.name || symbol,
        exchange: profile?.exchange || null,
        industry: profile?.finnhubIndustry || null,
        country: profile?.country || null,
        currency: profile?.currency || 'USD',
        logo: profile?.logo || null,
        website: profile?.weburl || null,
        ipo: profile?.ipo || null,
        marketCap: profile?.marketCapitalization ? profile.marketCapitalization * 1e6 : null,
        sharesOutstanding: profile?.shareOutstanding ? profile.shareOutstanding * 1e6 : null,
      },
      metrics: {
        week52High: m['52WeekHigh'] ?? null,
        week52Low: m['52WeekLow'] ?? null,
        week52Return: m['52WeekPriceReturnDaily'] ?? null,
        ytdReturn: m.yearToDatePriceReturnDaily ?? null,
        pe: m.peTTM ?? m.peBasicExclExtraTTM ?? null,
        eps: m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? null,
        beta: m.beta ?? null,
        dividendYield: m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual ?? null,
        avgVolume10d: m['10DayAverageTradingVolume'] ? m['10DayAverageTradingVolume'] * 1e6 : null,
        priceToBook: m.pbQuarterly ?? m.pbAnnual ?? null,
        netMargin: m.netProfitMarginTTM ?? null,
        revenueGrowth: m.revenueGrowthTTMYoy ?? null,
      },
    },
    30
  );
});
