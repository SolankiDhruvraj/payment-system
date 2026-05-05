import webhookService from '../services/WebhookService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import logger from '../config/logger.js';

// ─── Webhook Controller ───────────────────────────────────────────────────────

export class WebhookController {
  /**
   * POST /api/v1/webhooks/razorpay
   * Receives and processes Razorpay webhook events.
   */
  handleRazorpayWebhook = asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];

    // req.body is a Buffer (from express.raw()) for signature verification
    const rawBody = req.body;
    let payload;

    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON payload' },
      });
    }

    logger.info('Razorpay webhook received', {
      event: payload.event,
      eventId: payload.id,
      ip: req.ip,
    });

    const result = await webhookService.processWebhook(rawBody, signature, payload);

    // Always return 200 quickly — Razorpay will retry on non-2xx responses
    res.status(200).json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  });
}

export default new WebhookController();
