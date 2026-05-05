import { v4 as uuidv4 } from 'uuid';
import paymentRepository from '../repositories/PaymentRepository.js';
import idempotencyRepository from '../repositories/IdempotencyRepository.js';
import razorpayGateway from '../gateways/RazorpayGateway.js';
import circuitBreaker from './CircuitBreakerService.js';
import retryService from './RetryService.js';
import { AppError, GatewayError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { PaymentStatus } from '../constants/paymentStatus.js';
import { getNextRetryAt } from '../utils/retryUtils.js';
import logger from '../config/logger.js';

// ─── Payment Service ──────────────────────────────────────────────────────────

export class PaymentService {
  async initiatePayment({ amount, currency = 'INR', metadata = {}, idempotencyKey }) {
    logger.info('Initiating payment', { amount, currency, idempotencyKey });

    // Check if payment already exists for this idempotency key
    const existingPayment = await paymentRepository.findByIdempotencyKey(idempotencyKey);
    if (existingPayment) {
      logger.info('Returning existing payment (idempotent)', {
        paymentId: existingPayment.id,
        idempotencyKey,
      });
      return this._formatInitiationResponse(existingPayment);
    }

    // Create Razorpay order through circuit breaker
    let gatewayOrder;
    try {
      gatewayOrder = await this.circuitBreaker.execute(async () => {
        return await this.gateway.createOrder({
          amount,
          currency,
          receipt: `rcpt_${Date.now()}`,
          notes: { idempotencyKey },
        });
      });
    } catch (error) {
      logger.error('Gateway order creation failed', {
        error: error.message,
        code: error.code,
        idempotencyKey,
      });
      throw error;
    }

    // Persist the payment record
    const payment = await paymentRepository.createWithAudit({
      idempotencyKey,
      razorpayOrderId: gatewayOrder.orderId,
      amount,
      currency,
      status: PaymentStatus.PENDING,
      metadata,
    });

    logger.info('Payment initiated successfully', {
      paymentId: payment.id,
      razorpayOrderId: gatewayOrder.orderId,
      amount,
    });

    return this._formatInitiationResponse(payment, gatewayOrder);
  }

  // ─── 2. Verify Payment ────────────────────────────────────────────────────
  async verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    logger.info('Verifying payment', { razorpayOrderId, razorpayPaymentId });

    // Find the payment by Razorpay order ID
    const payment = await paymentRepository.findByRazorpayOrderId(razorpayOrderId);
    if (!payment) {
      throw new AppError(
        `No payment found for Razorpay order ${razorpayOrderId}`,
        ErrorCodes.PAYMENT_NOT_FOUND,
        404
      );
    }

    // Idempotency — already verified
    if (payment.status === PaymentStatus.SUCCESS) {
      logger.info('Payment already verified (idempotent)', { paymentId: payment.id });
      return payment;
    }

    // Cannot verify a permanently failed payment
    if (payment.status === PaymentStatus.FAILED && payment.retryCount >= payment.maxRetries) {
      throw new AppError(
        'Payment has permanently failed and cannot be verified',
        ErrorCodes.PAYMENT_ALREADY_PROCESSED,
        409
      );
    }

    // Verify the HMAC signature — prevents fraudulent requests
    const isSignatureValid = await this.gateway.verifySignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });

    if (!isSignatureValid) {
      logger.error('Invalid payment signature', { razorpayOrderId, razorpayPaymentId });
      throw new AppError(
        'Payment signature verification failed. Possible tampered request.',
        ErrorCodes.PAYMENT_SIGNATURE_INVALID,
        400
      );
    }

    // Mark as SUCCESS with all Razorpay identifiers
    const updatedPayment = await paymentRepository.updateStatusWithAudit(
      payment.id,
      PaymentStatus.SUCCESS,
      {
        razorpayPaymentId,
        razorpaySignature,
      },
      'payment_service',
      'Signature verified — payment captured'
    );

    logger.info('Payment verified and captured', {
      paymentId: payment.id,
      razorpayPaymentId,
      amount: payment.amount,
    });

    return updatedPayment;
  }

  // ─── 3. Handle Payment Failure ────────────────────────────────────────────

  async handleFailure({ razorpayOrderId, reason, code }) {
    logger.info('Handling payment failure', { razorpayOrderId, reason, code });

    const payment = await paymentRepository.findByRazorpayOrderId(razorpayOrderId);
    if (!payment) return null;

    // Idempotency — already processed
    if (
      payment.status === PaymentStatus.SUCCESS ||
      (payment.status === PaymentStatus.FAILED && payment.failureCode === code)
    ) {
      return payment;
    }

    const nextRetryAt =
      payment.retryCount < payment.maxRetries ? getNextRetryAt(payment.retryCount) : null;

    const updatedPayment = await paymentRepository.updateStatusWithAudit(
      payment.id,
      PaymentStatus.FAILED,
      {
        failureReason: reason,
        failureCode: code,
        nextRetryAt,
      },
      'payment_service',
      `Payment failed: ${reason}`
    );

    logger.warn('Payment marked as FAILED', {
      paymentId: payment.id,
      reason,
      nextRetryAt,
    });

    return updatedPayment;
  }

  // ─── 4. Get Payment Status ────────────────────────────────────────────────
  async getPaymentById(paymentId) {
    const payment = await paymentRepository.findById(paymentId);
    if (!payment) {
      throw new AppError(`Payment ${paymentId} not found`, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    // Enrich with audit logs
    const withAudit = await paymentRepository.findMany({
      where: { id: paymentId },
      include: { auditLogs: { orderBy: { createdAt: 'asc' } } },
    });

    return withAudit[0] || payment;
  }

  // ─── 4. List Payments ─────────────────────────────────────────────────────
  async listPayments(options) {
    return paymentRepository.list(options);
  }

  // ─── 5. Manual Retry ──────────────────────────────────────────────────────
  async retryPayment(paymentId) {
    return retryService.retryPayment(paymentId);
  }

  // ─── 6. Health Status ─────────────────────────────────────────────────────

  /**
   * Get system health including circuit breaker state.
   */
  getHealthStatus() {
    return {
      gateway: this.gateway.getName(),
      circuitBreaker: this.circuitBreaker.getStatus(),
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private: Response Formatting ──────────────────────────────────────────

  _formatInitiationResponse(payment, gatewayOrder = null) {
    return {
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey: payment.idempotencyKey,
        razorpayOrderId: payment.razorpayOrderId,
        createdAt: payment.createdAt,
      },
      order: gatewayOrder
        ? {
            id: gatewayOrder.orderId,
            amount: gatewayOrder.amount,
            currency: gatewayOrder.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
          }
        : {
            id: payment.razorpayOrderId,
            amount: payment.amount,
            currency: payment.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
          },
    };
  }
}

export default new PaymentService();
