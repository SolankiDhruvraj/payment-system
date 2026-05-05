import { Router } from 'express';
import paymentController from '../controllers/PaymentController.js';
import idempotency from '../middlewares/idempotency.js';
import { paymentInitiateLimiter, retryLimiter } from '../middlewares/rateLimiter.js';

const router = Router();

// ─── Payment Routes ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/initiate
 * Create a new payment order.
 * Rate limited: 10 per minute per IP
 * Requires: Idempotency-Key header
 */
router.post(
  '/initiate',
  paymentInitiateLimiter,
  idempotency,
  paymentController.initiatePayment
);

/**
 * POST /api/v1/payments/verify
 * Verify Razorpay signature after checkout.
 * Requires: Idempotency-Key header
 */
router.post(
  '/verify',
  idempotency,
  paymentController.verifyPayment
);

/**
 * POST /api/v1/payments/fail
 * Mark a payment as failed (e.g. cancelled by user in modal).
 * Requires: Idempotency-Key header
 */
router.post(
  '/fail',
  idempotency,
  paymentController.failPayment
);

/**
 * GET /api/v1/payments
 * Paginated list with optional status filter.
 */
router.get('/', paymentController.listPayments);

/**
 * GET /api/v1/payments/:id
 * Get payment details with full audit trail.
 */
router.get('/:id', paymentController.getPayment);

/**
 * POST /api/v1/payments/:id/retry
 * Manually trigger retry for a failed payment.
 * Rate limited: 5 per 5 minutes per IP
 */
router.post('/:id/retry', retryLimiter, paymentController.retryPayment);

export default router;
