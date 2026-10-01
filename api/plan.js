// GET    /api/plan → { plan }
// DELETE /api/plan → cancels the test subscription in Stripe and returns this browser to FREE.
import { clearPlan, getPlan, handle, send, stripe } from '../lib/server.js';

export default handle(async (req, res) => {
  const current = getPlan(req);
  if (req.method === 'DELETE') {
    if (current.subscription) {
      try {
        await stripe('DELETE', `/subscriptions/${current.subscription}`);
      } catch {
        // Already cancelled in Stripe; still downgrade locally.
      }
    }
    clearPlan(res);
    return send(res, 200, { plan: 'free' });
  }
  send(res, 200, { plan: current.plan });
});
