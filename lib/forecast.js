// Market Reader forecasting engine — dependency-free.
// Works on weekly, split/dividend-adjusted closes in log space.
// Models: drift + volatility (geometric Brownian motion), Holt's damped trend, log-linear trend.
// Bands are driven by historical weekly volatility and widen with the square root of time.

const WEEKS_PER_YEAR = 52;
const Z80 = 1.2816;
const Z95 = 1.96;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
};

// ---------- models: each returns a function h -> forecast log price (h in weeks ahead) ----------

// Long-run equity market prior: ~8%/yr, expressed as a weekly log return.
const MARKET_PRIOR_WEEKLY = Math.log(1.08) / WEEKS_PER_YEAR;
const SHRINK = 0.5; // weight on the stock's own history vs the market prior

function fitDrift(y) {
  const r = [];
  for (let i = 1; i < y.length; i++) r.push(y[i] - y[i - 1]);
  const muHist = mean(r);
  // Five years of returns estimate drift very noisily, so blend it with the market prior.
  const mu = SHRINK * muHist + (1 - SHRINK) * MARKET_PRIOR_WEEKLY;
  const last = y[y.length - 1];
  return { name: 'Drift + volatility', key: 'drift', predict: (h) => last + mu * h, mu, muHist, sigma: std(r) };
}

function holtSSE(y, a, b, phi) {
  let level = y[0];
  let trend = y[1] - y[0];
  let sse = 0;
  for (let t = 1; t < y.length; t++) {
    const f = level + phi * trend;
    const e = y[t] - f;
    sse += e * e;
    const newLevel = a * y[t] + (1 - a) * (level + phi * trend);
    trend = b * (newLevel - level) + (1 - b) * phi * trend;
    level = newLevel;
  }
  return { sse, level, trend };
}

function fitHolt(y) {
  let best = null;
  for (const a of [0.2, 0.4, 0.6, 0.8, 0.95])
    for (const b of [0.01, 0.03, 0.08, 0.15])
      for (const phi of [0.9, 0.95, 0.98, 0.995]) {
        const r = holtSSE(y, a, b, phi);
        if (!best || r.sse < best.sse) best = { ...r, a, b, phi };
      }
  const { level, trend, phi } = best;
  return {
    name: "Holt's damped trend",
    key: 'holt',
    predict: (h) => {
      // level + trend * (phi + phi^2 + ... + phi^h)
      const damp = phi === 1 ? h : (phi * (1 - phi ** h)) / (1 - phi);
      return level + trend * damp;
    },
    params: { alpha: best.a, beta: best.b, phi },
  };
}

function fitLinear(y) {
  const n = y.length;
  const t = y.map((_, i) => i);
  const mt = mean(t);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (t[i] - mt) * (y[i] - my);
    den += (t[i] - mt) ** 2;
  }
  const slope = num / den;
  const icpt = my - slope * mt;
  // Anchor the trend line at the latest price so the forecast starts where the stock is today.
  const offset = y[n - 1] - (icpt + slope * (n - 1));
  return { name: 'Log-linear trend', key: 'linear', predict: (h) => icpt + slope * (n - 1 + h) + offset, slope };
}

const FITTERS = [fitDrift, fitHolt, fitLinear];

// ---------- backtest: fit on all but the last year, score the held-out year ----------

function backtest(y, holdout = WEEKS_PER_YEAR) {
  if (y.length < holdout + 104) return null; // need at least 2 years of training data
  const train = y.slice(0, y.length - holdout);
  const test = y.slice(y.length - holdout);
  return FITTERS.map((fit) => {
    const m = fit(train);
    let ape = 0;
    for (let h = 1; h <= holdout; h++) {
      const pred = Math.exp(m.predict(h));
      const act = Math.exp(test[h - 1]);
      ape += Math.abs(pred - act) / act;
    }
    const predEnd = Math.exp(m.predict(holdout));
    const actEnd = Math.exp(test[holdout - 1]);
    return {
      key: m.key,
      name: m.name,
      mape: ape / holdout,
      predictedEnd: predEnd,
      actualEnd: actEnd,
      endError: (predEnd - actEnd) / actEnd,
    };
  });
}

// ---------- history statistics ----------

function historyStats(closes) {
  const first = closes[0];
  const last = closes[closes.length - 1];
  const years = closes.length / WEEKS_PER_YEAR;
  let peak = closes[0];
  let maxDD = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDD = Math.min(maxDD, (c - peak) / peak);
  }
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  return {
    totalReturn: last / first - 1,
    cagr: (last / first) ** (1 / years) - 1,
    annualVolatility: std(r) * Math.sqrt(WEEKS_PER_YEAR),
    maxDrawdown: maxDD,
    years,
  };
}

// ---------- public API ----------

/**
 * @param {{date:string, close:number}[]} series weekly adjusted closes, oldest first
 * @param {{horizonWeeks:number, models:boolean, backtest:boolean}} opts
 */
export function forecast(series, opts = {}) {
  const horizon = opts.horizonWeeks ?? 5 * WEEKS_PER_YEAR;
  if (!series || series.length < 60) throw new Error('Not enough history to forecast (need ~1 year of weekly data).');

  const closes = series.map((p) => p.close);
  const y = closes.map(Math.log);
  const lastDate = new Date(series[series.length - 1].date + 'T00:00:00Z');
  const sigma = fitDrift(y).sigma;

  const dateAt = (h) => {
    const d = new Date(lastDate);
    d.setUTCDate(d.getUTCDate() + 7 * h);
    return d.toISOString().slice(0, 10);
  };

  const project = (model) => {
    const pts = [];
    for (let h = 1; h <= horizon; h++) {
      const c = model.predict(h);
      const s = sigma * Math.sqrt(h);
      pts.push({
        date: dateAt(h),
        median: Math.exp(c),
        lo80: Math.exp(c - Z80 * s),
        hi80: Math.exp(c + Z80 * s),
        lo95: Math.exp(c - Z95 * s),
        hi95: Math.exp(c + Z95 * s),
      });
    }
    return pts;
  };

  const fitted = FITTERS.map((f) => f(y));
  const primary = fitted[0];
  const primaryPts = project(primary);
  const lastClose = closes[closes.length - 1];

  const milestones = [1, 2, 3, 4, 5]
    .map((yr) => yr * WEEKS_PER_YEAR)
    .filter((h) => h <= horizon)
    .map((h) => {
      const p = primaryPts[h - 1];
      return {
        years: h / WEEKS_PER_YEAR,
        date: p.date,
        median: p.median,
        lo80: p.lo80,
        hi80: p.hi80,
        change: p.median / lastClose - 1,
      };
    });

  const result = {
    method: primary.name,
    horizonWeeks: horizon,
    lastClose,
    lastDate: series[series.length - 1].date,
    impliedAnnualReturn: Math.exp(primary.mu * WEEKS_PER_YEAR) - 1,
    weeklyVolatility: sigma,
    stats: historyStats(closes),
    forecast: primaryPts,
    milestones,
  };

  if (opts.models) {
    result.models = fitted.map((m) => ({
      key: m.key,
      name: m.name,
      points: project(m).map((p) => ({ date: p.date, median: p.median })),
    }));
  }
  if (opts.backtest) result.backtest = backtest(y);
  return result;
}

export const TIERS = {
  free: { horizonWeeks: WEEKS_PER_YEAR, models: false, backtest: false },
  premium: { horizonWeeks: 5 * WEEKS_PER_YEAR, models: false, backtest: false },
  max: { horizonWeeks: 5 * WEEKS_PER_YEAR, models: true, backtest: true },
};
