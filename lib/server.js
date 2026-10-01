// Shared server helpers for the Vercel functions. No dependencies.
import crypto from 'node:crypto';

export const PRICES = {
  // Stripe sandbox price IDs (FinTech Demo Class sandbox). Override with env vars if you recreate them.
  premium: process.env.STRIPE_PRICE_PREMIUM || 'price_1ULlrxJeF0vfn2BDCovIXver',
  max: process.env.STRIPE_PRICE_MAX || 'price_1ULls1JeF0vfn2BDZ7U4ymf7',
};

export function send(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    cacheSeconds > 0 ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}` : 'no-store'
  );
  res.end(JSON.stringify(body));
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`${name} is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.`);
    err.status = 500;
    throw err;
  }
  return v;
}

export function cleanSymbol(s) {
  const sym = String(s || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) {
    const err = new Error('Enter a valid ticker symbol, e.g. AAPL.');
    err.status = 400;
    throw err;
  }
  return sym;
}

export async function finnhub(path, params = {}) {
  const key = requireEnv('FINNHUB_API_KEY');
  const qs = new URLSearchParams({ ...params, token: key });
  const r = await fetch(`https://finnhub.io/api/v1${path}?${qs}`);
  if (r.status === 429) {
    const err = new Error('Finnhub rate limit reached (60 calls/min on the free plan). Try again in a minute.');
    err.status = 429;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`Finnhub ${path} returned ${r.status}.`);
    err.status = 502;
    throw err;
  }
  return r.json();
}

export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      send(res, e.status || 500, { error: e.message || 'Something went wrong.' });
    }
  };
}

// ---------- plan cookie (signed, so the tier can't be edited in the browser) ----------

const COOKIE = 'mr_plan';

function secret() {
  const base = process.env.PLAN_SECRET || process.env.STRIPE_SECRET_KEY || 'market-reader-dev-secret';
  return crypto.createHash('sha256').update('mr-plan:' + base).digest();
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function getPlan(req) {
  const p = unsign(readCookie(req, COOKIE));
  return p && ['premium', 'max'].includes(p.plan) ? p : { plan: 'free' };
}

export function setPlan(res, data) {
  const exp = Date.now() + 31 * 24 * 3600 * 1000; // a month, like the billing period
  const token = sign({ ...data, exp });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${31 * 24 * 3600}`);
}

export function clearPlan(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// ---------- Stripe REST (form-encoded) ----------

function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

export async function stripe(method, path, params) {
  const key = requireEnv('STRIPE_SECRET_KEY');
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    const err = new Error('This demo only runs with a Stripe test-mode key (sk_test_…).');
    err.status = 500;
    throw err;
  }
  const isGet = method === 'GET';
  const qs = params ? formEncode(params) : '';
  const r = await fetch(`https://api.stripe.com/v1${path}${isGet && qs ? '?' + qs : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: isGet ? undefined : qs,
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error(data?.error?.message || `Stripe returned ${r.status}.`);
    err.status = 502;
    throw err;
  }
  return data;
}

export function origin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
