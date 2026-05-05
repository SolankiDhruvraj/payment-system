import { Router } from 'express';
import webhookController from '../controllers/WebhookController.js';

const router = Router();

// ─── Webhook Routes ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/webhooks/razorpay
 * Receives Razorpay webhook events.
**/
router.post('/razorpay', webhookController.handleRazorpayWebhook);

export default router;
