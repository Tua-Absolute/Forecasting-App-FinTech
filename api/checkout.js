// POST /api/checkout  { "plan": "premium" | "max" } → { url } for Stripe Checkout (test mode).
import { PRICES, handle, origin, send, stripe } from '../lib/server.js';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export default handle(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  const { plan } = await readJson(req);
  const price = PRICES[plan];
  if (!price) return send(res, 400, { error: 'Choose the Premium or Max plan.' });

  const base = origin(req);
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: { 0: { price, quantity: 1 } },
    success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?checkout=cancelled`,
    allow_promotion_codes: 'true',
    metadata: { plan },
    subscription_data: { metadata: { plan, app: 'stealth-forecast' } },
  });

  send(res, 200, { url: session.url });
});
