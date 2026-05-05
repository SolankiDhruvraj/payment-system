import prisma from '../config/database.js';
import razorpayGateway from '../gateways/RazorpayGateway.js';
import paymentRepository from '../repositories/PaymentRepository.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { PaymentStatus, isTerminalStatus } from '../constants/paymentStatus.js';
import logger from '../config/logger.js';

// ─── Webhook Service ──────────────────────────────────────────────────────────

export class WebhookService {

  async processWebhook(rawBody, signature, payload) {
    // 1. Verify webhook signature
    const isValid = razorpayGateway.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.error('Webhook signature verification failed', {
        event: payload?.event,
      });
      throw new AppError(
        'Webhook signature verification failed',
        ErrorCodes.WEBHOOK_SIGNATURE_INVALID,
        401
      );
    }

    const eventId = payload.id || payload.event_id;
    const eventType = payload.event;

    logger.info('Webhook received', { eventId, eventType });

    // 2. Check for duplicate event (idempotency)
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { razorpayEventId: eventId },
    });

    if (existingEvent && existingEvent.status === 'PROCESSED') {
      logger.info('Duplicate webhook — already processed', { eventId, eventType });
      return { received: true, message: 'Duplicate event — already processed' };
    }

    // 3. Persist the event first (mark as RECEIVED)
    const webhookEvent = await prisma.webhookEvent.upsert({
      where: { razorpayEventId: eventId },
      update: { status: 'RECEIVED' },
      create: {
        razorpayEventId: eventId,
        eventType,
        payload,
        status: 'RECEIVED',
      },
    });

    // 4. Route to the appropriate handler
    try {
      await this._routeEvent(eventType, payload, webhookEvent.id);

      // Mark event as processed
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      return { received: true, message: 'Webhook processed successfully' };
    } catch (error) {
      logger.error('Webhook processing failed', {
        eventId,
        eventType,
        error: error.message,
      });

      // Mark event as failed — won't retry automatically, but traceable
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
        },
      }).catch(() => {});

      // Re-throw so the controller can respond with 500
      throw error;
    }
  }

  // ── Event Routing ──────────────────────────────────────────────────────────

  async _routeEvent(eventType, payload, webhookEventId) {
    const handlers = {
      'payment.captured': this._handlePaymentCaptured.bind(this),
      'payment.failed': this._handlePaymentFailed.bind(this),
      'payment.authorized': this._handlePaymentAuthorized.bind(this),
      'refund.processed': this._handleRefundProcessed.bind(this),
    };

    const handler = handlers[eventType];
    if (!handler) {
      logger.info('Unhandled webhook event type — ignoring', { eventType });
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'IGNORED' },
      });
      return;
    }

    await handler(payload);
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  async _handlePaymentCaptured(payload) {
    const razorpayPaymentId = payload.payload?.payment?.entity?.id;
    const razorpayOrderId = payload.payload?.payment?.entity?.order_id;
    const amount = payload.payload?.payment?.entity?.amount;

    if (!razorpayOrderId) {
      logger.warn('payment.captured webhook missing order_id', { payload });
      return;
    }

    const payment = await paymentRepository.findByRazorpayOrderId(razorpayOrderId);
    if (!payment) {
      logger.warn('payment.captured: no payment found for order', { razorpayOrderId });
      return;
    }

    // Conflict resolution: never downgrade a terminal state
    if (isTerminalStatus(payment.status)) {
      logger.info('payment.captured webhook: payment already in terminal state', {
        paymentId: payment.id,
        currentStatus: payment.status,
      });
      return;
    }

    await paymentRepository.updateStatusWithAudit(
      payment.id,
      PaymentStatus.SUCCESS,
      {
        razorpayPaymentId,
      },
      'webhook',
      `payment.captured event received from Razorpay`
    );

    logger.info('Payment marked SUCCESS via webhook', {
      paymentId: payment.id,
      razorpayPaymentId,
      amount,
    });
  }

  async _handlePaymentFailed(payload) {
    const razorpayOrderId = payload.payload?.payment?.entity?.order_id;
    const errorCode = payload.payload?.payment?.entity?.error_code;
    const errorDescription = payload.payload?.payment?.entity?.error_description;

    if (!razorpayOrderId) {
      logger.warn('payment.failed webhook missing order_id');
      return;
    }

    const payment = await paymentRepository.findByRazorpayOrderId(razorpayOrderId);
    if (!payment) {
      logger.warn('payment.failed: no payment found for order', { razorpayOrderId });
      return;
    }

    // Never override SUCCESS with FAILED — webhook may arrive out of order
    if (isTerminalStatus(payment.status)) {
      logger.info('payment.failed webhook: payment already in terminal state — ignoring', {
        paymentId: payment.id,
        currentStatus: payment.status,
      });
      return;
    }

    // PROCESSING state: allow transition to FAILED
    await paymentRepository.updateStatusWithAudit(
      payment.id,
      PaymentStatus.FAILED,
      {
        failureReason: errorDescription || 'Payment failed',
        failureCode: errorCode,
      },
      'webhook',
      `payment.failed event received from Razorpay`
    );

    logger.warn('Payment marked FAILED via webhook', {
      paymentId: payment.id,
      errorCode,
      errorDescription,
    });
  }

  async _handlePaymentAuthorized(payload) {
    // payment.authorized fires when payment is authorized but not yet captured
    // In auto-capture mode this is informational only
    const razorpayOrderId = payload.payload?.payment?.entity?.order_id;
    logger.info('Payment authorized webhook received', { razorpayOrderId });
  }

  async _handleRefundProcessed(payload) {
    const razorpayPaymentId = payload.payload?.refund?.entity?.payment_id;
    logger.info('Refund processed webhook received', { razorpayPaymentId });

    if (!razorpayPaymentId) return;

    const payment = await paymentRepository.findOne({ razorpayPaymentId });
    if (!payment) return;

    if (payment.status === PaymentStatus.SUCCESS) {
      await paymentRepository.updateStatusWithAudit(
        payment.id,
        PaymentStatus.REFUNDED,
        {},
        'webhook',
        'Refund processed via webhook'
      );

      logger.info('Payment marked REFUNDED via webhook', {
        paymentId: payment.id,
        razorpayPaymentId,
      });
    }
  }
}

export default new WebhookService();
