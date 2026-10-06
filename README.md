# Stealth Forecast

Stock dashboard with five years of price history and a five-year forecast. Red and black theme, no build step, no npm dependencies.

## Setup (Vercel → Project → Settings → Environment Variables)

| Variable | Where to get it |
|---|---|
| `FINNHUB_API_KEY` | finnhub.io dashboard (free plan works) |
| `ALPHAVANTAGE_API_KEY` | alphavantage.co/support/#api-key (free) |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys, **test mode** `sk_test_…` key for the "FinTech Demo Class sandbox" |

Optional: `PLAN_SECRET` (signs the plan cookie; defaults to a hash of the Stripe key), `STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_MAX` (default to the sandbox prices created for this app).

Redeploy after adding variables.

## Data sources
- **Finnhub**: live quote, profile, key metrics, news, symbol search, ticker strip.
- **Alpha Vantage**: weekly split/dividend-adjusted closes (`TIME_SERIES_WEEKLY_ADJUSTED`). The free key allows about 25 calls/day, so `/api/history` is cached at Vercel's CDN for 12 hours per symbol.
  Finnhub's free plan does not include historical candles, which is why history comes from Alpha Vantage.

## Plans (Stripe test mode)
| Plan | Price | Unlocks |
|---|---|---|
| FREE | $0 | quotes, stats, 5-yr history, 1-yr forecast |
| PREMIUM | $20/mo | 5-yr forecast with 80%/95% ranges and yearly targets |
| MAX | $40/mo | + three-model comparison and one-year backtest accuracy |

Checkout uses Stripe Checkout. After payment, `/api/verify` confirms the session with Stripe and stores the plan in a signed, HttpOnly cookie. "Downgrade to Free" cancels the test subscription. Test card: `4242 4242 4242 4242`.

## Dashboard (`/dashboard`)
- Save up to **3 stocks** from the search on the dashboard or the **Add to dashboard** button on any stock page. Each stock keeps its color while it is saved.
- **My position** per stock: shares, average cost and target price → market value, gain/loss and distance to target, plus portfolio totals (market value, cost basis, total gain/loss, today's change).
- **Choose metrics**: 26 metrics across Price, Valuation, Performance, Risk, Fundamentals, Forecast and My position. The comparison table marks the strongest value in each row; the 5-year forecast metric needs Premium.
- **Performance chart**: percent change over 1Y or 5Y, so stocks at different prices compare fairly.
- Saved stocks, positions and metric choices live in the browser's localStorage (no accounts in this demo), so they are per device and never sent to the server.

## Forecast method
Weekly log prices. Main model: drift + volatility, where drift is the stock's own 5-yr average blended 50/50 with an ~8%/yr market prior, and ranges widen with √time using historical volatility. MAX adds Holt's damped trend and a log-linear trend, each backtested on the most recent year.

Not investment advice: forecasts are statistical ranges, not predictions.

## Files
- `index.html`, `styles.css`, `app.js`: stock page
- `dashboard.html`, `dashboard.css`, `dashboard.js`: dashboard · `store.js`: saved dashboard state · `util.js`: shared helpers
- `vercel.json`: clean URLs (`/dashboard`)
- `api/*.js`: Vercel functions (`stock`, `search`, `news`, `market`, `history`, `forecast`, `checkout`, `verify`, `plan`)
- `lib/forecast.js`: forecasting engine · `lib/history.js`: Alpha Vantage · `lib/server.js`: helpers, Stripe REST, signed plan cookie
