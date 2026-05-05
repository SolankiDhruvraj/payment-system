import paymentRepository from '../repositories/PaymentRepository.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { PaymentStatus } from '../constants/paymentStatus.js';
import { isRetryableError, getNextRetryAt } from '../utils/retryUtils.js';
import circuitBreaker from './CircuitBreakerService.js';
import razorpayGateway from '../gateways/RazorpayGateway.js';
import logger from '../config/logger.js';

// ─── Retry Service ────────────────────────────────────────────────────────────
export class RetryService {
  constructor(gateway = razorpayGateway, cbService = circuitBreaker) {
    this.gateway = gateway;
    this.circuitBreaker = cbService;
  }

  async retryPayment(paymentId) {
    const payment = await paymentRepository.findById(paymentId);

    if (!payment) {
      throw new AppError(`Payment ${paymentId} not found`, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    // Validate retry eligibility
    this._validateRetryEligibility(payment);

    logger.info('Retrying payment', {
      paymentId,
      retryCount: payment.retryCount,
      maxRetries: payment.maxRetries,
      status: payment.status,
    });

    // Reset to PROCESSING for this attempt
    await paymentRepository.updateStatusWithAudit(
      paymentId,
      PaymentStatus.PROCESSING,
      {},
      'retry_service',
      `Retry attempt ${payment.retryCount + 1} of ${payment.maxRetries}`
    );

    try {
      // Execute through circuit breaker — fail fast if gateway is down
      const result = await this.circuitBreaker.execute(async () => {
        return await this.gateway.getPayment(payment.razorpayPaymentId);
      });

      // If gateway confirms success, update accordingly
      if (result?.status === 'captured') {
        await paymentRepository.updateStatusWithAudit(
          paymentId,
          PaymentStatus.SUCCESS,
          {
            retryCount: payment.retryCount + 1,
            nextRetryAt: null,
          },
          'retry_service',
          'Payment confirmed successful on retry'
        );

        logger.info('Payment retry succeeded', { paymentId });
        return await paymentRepository.findById(paymentId);
      }

      // Payment still not captured — mark as failed with backoff
      return await this._handleRetryFailure(payment, new Error('Payment not yet captured'));
    } catch (error) {
      return await this._handleRetryFailure(payment, error);
    }
  }

  /**
   * Process all payments eligible for automatic retry.
   * This method is designed to be called by a scheduled job/queue worker.
  **/
  async processEligibleRetries() {
    // Use raw SQL to avoid N+1 and safely find eligible payments
    const eligible = await paymentRepository.findMany({
      where: {
        status: PaymentStatus.FAILED,
        nextRetryAt: { lte: new Date() },
      },
    });

    const eligibleFiltered = eligible.filter(p => p.retryCount < p.maxRetries);

    logger.info('Processing eligible retries', { count: eligibleFiltered.length });

    const results = { processed: 0, succeeded: 0, failed: 0 };

    for (const payment of eligibleFiltered) {
      try {
        await this.retryPayment(payment.id);
        results.succeeded++;
      } catch (error) {
        results.failed++;
        logger.error('Auto-retry failed', {
          paymentId: payment.id,
          error: error.message,
        });
      }
      results.processed++;
    }

    return results;
  }

  // ── Private Methods ────────────────────────────────────────────────────────

  _validateRetryEligibility(payment) {
    if (payment.status === PaymentStatus.SUCCESS) {
      throw new AppError(
        'Cannot retry a successful payment',
        ErrorCodes.PAYMENT_ALREADY_PROCESSED,
        409
      );
    }

    if (payment.status === PaymentStatus.PROCESSING) {
      throw new AppError(
        'Payment is already being processed',
        ErrorCodes.PAYMENT_ALREADY_PROCESSED,
        409
      );
    }

    if (payment.retryCount >= payment.maxRetries) {
      throw new AppError(
        `Maximum retry attempts (${payment.maxRetries}) exceeded for payment ${payment.id}`,
        ErrorCodes.PAYMENT_MAX_RETRIES_EXCEEDED,
        422
      );
    }
  }

  async _handleRetryFailure(payment, error) {
    const newRetryCount = payment.retryCount + 1;
    const hasRetriesLeft = newRetryCount < payment.maxRetries;
    const isRetryable = isRetryableError(error);

    if (!isRetryable || !hasRetriesLeft) {
      // Permanently failed
      await paymentRepository.updateStatusWithAudit(
        payment.id,
        PaymentStatus.FAILED,
        {
          retryCount: newRetryCount,
          nextRetryAt: null,
          failureReason: error.message,
          failureCode: error.code,
        },
        'retry_service',
        hasRetriesLeft
          ? `Non-retryable error: ${error.message}`
          : `Max retries exhausted after ${newRetryCount} attempts`
      );

      logger.error('Payment permanently failed', {
        paymentId: payment.id,
        retryCount: newRetryCount,
        reason: error.message,
      });
    } else {
      // Schedule next retry with exponential backoff
      const nextRetryAt = getNextRetryAt(newRetryCount);

      await paymentRepository.updateStatusWithAudit(
        payment.id,
        PaymentStatus.FAILED,
        {
          retryCount: newRetryCount,
          nextRetryAt,
          failureReason: error.message,
          failureCode: error.code,
        },
        'retry_service',
        `Retry ${newRetryCount} failed — scheduled next retry at ${nextRetryAt.toISOString()}`
      );

      logger.warn('Payment retry failed — scheduled next attempt', {
        paymentId: payment.id,
        retryCount: newRetryCount,
        nextRetryAt,
      });
    }

    return paymentRepository.findById(payment.id);
  }
}

export default new RetryService();
