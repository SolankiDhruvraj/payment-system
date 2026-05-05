import paymentService from '../services/PaymentService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ValidationError } from '../utils/AppError.js';
import {
  initiatePaymentSchema,
  verifyPaymentSchema,
  listPaymentsSchema,
  validate,
} from '../validators/payment.validator.js';
import logger from '../config/logger.js';

// ─── Payment Controller ───────────────────────────────────────────────────────

export class PaymentController {
  /**
   * POST /api/v1/payments/initiate
   * Create a new Razorpay order and payment record.
   */
  initiatePayment = asyncHandler(async (req, res) => {
    const { value, error } = validate(initiatePaymentSchema, req.body);
    if (error) {
      throw new ValidationError(
        error.details.map((d) => d.message).join('; '),
        { details: error.details }
      );
    }

    const result = await paymentService.initiatePayment({
      ...value,
      idempotencyKey: req.idempotencyKey, // Injected by idempotency middleware
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment initiated successfully',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/v1/payments/verify
   * Verify Razorpay signature and mark payment as SUCCESS.
   */
  verifyPayment = asyncHandler(async (req, res) => {
    const { value, error } = validate(verifyPaymentSchema, req.body);
    if (error) {
      throw new ValidationError(
        error.details.map((d) => d.message).join('; '),
        { details: error.details }
      );
    }

    const payment = await paymentService.verifyPayment({
      razorpayOrderId: value.razorpay_order_id,
      razorpayPaymentId: value.razorpay_payment_id,
      razorpaySignature: value.razorpay_signature,
    });

    res.status(200).json({
      success: true,
      data: { payment },
      message: 'Payment verified successfully',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/v1/payments/fail
   * Mark a payment as FAILED manually (user cancelled modal).
   */
  failPayment = asyncHandler(async (req, res) => {
    const { razorpay_order_id, error_description } = req.body;
    
    if (!razorpay_order_id) {
      throw new ValidationError('razorpay_order_id is required');
    }

    const payment = await paymentService.handleFailure({
      razorpayOrderId: razorpay_order_id,
      reason: error_description || 'Payment cancelled by user',
      code: 'USER_CANCELLED',
    });

    res.status(200).json({
      success: true,
      data: { payment },
      message: 'Payment marked as failed',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/v1/payments/:id
   * Retrieve a payment with its full audit trail.
   */
  getPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const payment = await paymentService.getPaymentById(id);

    res.status(200).json({
      success: true,
      data: { payment },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/v1/payments
   * Paginated list of payments.
   */
  listPayments = asyncHandler(async (req, res) => {
    const { value, error } = validate(listPaymentsSchema, req.query);
    if (error) {
      throw new ValidationError(error.details.map((d) => d.message).join('; '));
    }

    const result = await paymentService.listPayments(value);

    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/v1/payments/:id/retry
   * Manually trigger retry for a failed payment.
   */
  retryPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const payment = await paymentService.retryPayment(id);

    res.status(200).json({
      success: true,
      data: { payment },
      message: 'Payment retry triggered',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/v1/health
   * Health check with circuit breaker status.
   */
  healthCheck = asyncHandler(async (req, res) => {
    const status = paymentService.getHealthStatus();

    res.status(200).json({
      success: true,
      status: 'healthy',
      data: status,
      timestamp: new Date().toISOString(),
    });
  });
}

export default new PaymentController();
