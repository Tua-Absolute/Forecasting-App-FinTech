// GET /api/verify?session_id=cs_test_… — confirms the Checkout Session with Stripe, then
// stores the plan in a signed cookie. The plan is never taken from the browser's word.
import { PRICES, handle, send, setPlan, stripe } from '../lib/server.js';

export default handle(async (req, res) => {
  const id = new URL(req.url, 'http://x').searchParams.get('session_id') || '';
  if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) return send(res, 400, { error: 'Invalid checkout session.' });

  const session = await stripe('GET', `/checkout/sessions/${id}`, { expand: { 0: 'line_items' } });
  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    return send(res, 402, { error: 'Payment was not completed.' });
  }

  const priceId = session.line_items?.data?.[0]?.price?.id;
  const plan = Object.keys(PRICES).find((k) => PRICES[k] === priceId);
  if (!plan) return send(res, 400, { error: 'That checkout was not for a Stealth Forecast plan.' });

  setPlan(res, { plan, subscription: session.subscription, customer: session.customer });
  send(res, 200, { plan });
});
