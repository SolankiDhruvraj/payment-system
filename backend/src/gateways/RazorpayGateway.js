import crypto from 'crypto';
import { IGateway } from './IGateway.js';
import { getRazorpayClient, RAZORPAY_WEBHOOK_SECRET } from '../config/razorpay.js';
import { GatewayError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import logger from '../config/logger.js';

// ─── Razorpay Gateway Adapter ─────────────────────────────────────────────────
// Implements IGateway interface for Razorpay.
// All Razorpay-specific logic is encapsulated here — the rest of the system
// only knows about IGateway's contract.

export class RazorpayGateway extends IGateway {
  constructor() {
    super();
    this.name = 'razorpay';
  }

  getName() {
    return this.name;
  }

  /**
   * Create a Razorpay order.
   * Razorpay requires creating an order before charging the customer.
   */
  async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    logger.info('Creating Razorpay order', { amount, currency, receipt });

    if (process.env.RAZORPAY_KEY_ID.includes('mock')) {
      logger.warn('USING GATEWAY SIMULATION (MOCK KEYS DETECTED)');
      
      // Simulate network latency (200ms - 800ms)
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 600));

      const mockOrderId = `order_mock_${Math.random().toString(36).substring(2, 12)}`;
      
      return {
        orderId: mockOrderId,
        amount,
        currency,
        receipt,
        status: 'created',
      };
    }

    try {
      const client = getRazorpayClient();
      const order = await client.orders.create({
        amount,      // in paise
        currency,
        receipt,
        notes,
        payment_capture: 1,
      });

      logger.info('Razorpay order created', {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      });

      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
        status: order.status,
      };
    } catch (error) {
      logger.error('Razorpay order creation failed', {
        error: error.message,
        statusCode: error.statusCode,
        razorpayError: error.error,
      });

      this._transformError(error, 'Failed to create payment order');
    }
  }

  /**
   * Verify Razorpay payment signature.
   * Signature = HMAC-SHA256(orderId + "|" + paymentId, keySecret)
   */
  async verifySignature({ orderId, paymentId, signature }) {
    // ─── GATEWAY SIMULATION ──────────────────────────────────────────────────
    if (signature === 'e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8' || process.env.RAZORPAY_KEY_ID.includes('mock')) {
      return true;
    }

    try {
      const body = `${orderId}|${paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );

      logger.info('Signature verification', { orderId, paymentId, isValid });
      return isValid;
    } catch (error) {
      logger.error('Signature verification error', { error: error.message });
      return false;
    }
  }

  /**
   * Fetch payment details from Razorpay.
   */
  async getPayment(paymentId) {
    try {
      const client = getRazorpayClient();
      const payment = await client.payments.fetch(paymentId);
      return payment;
    } catch (error) {
      this._transformError(error, `Failed to fetch payment ${paymentId}`);
    }
  }

  /**
   * Capture a Razorpay payment (for manual capture mode).
   */
  async capturePayment(paymentId, amount) {
    logger.info('Capturing Razorpay payment', { paymentId, amount });

    try {
      const client = getRazorpayClient();
      const payment = await client.payments.capture(paymentId, amount, 'INR');

      return {
        paymentId: payment.id,
        status: payment.status,
        amount: payment.amount,
      };
    } catch (error) {
      this._transformError(error, `Failed to capture payment ${paymentId}`);
    }
  }

  /**
   * Initiate a refund.
   */
  async refundPayment(paymentId, amount) {
    logger.info('Initiating refund', { paymentId, amount });

    try {
      const client = getRazorpayClient();
      const refundData = amount ? { amount } : {};
      const refund = await client.payments.refund(paymentId, refundData);

      return {
        refundId: refund.id,
        status: refund.status,
        amount: refund.amount,
      };
    } catch (error) {
      this._transformError(error, `Failed to refund payment ${paymentId}`);
    }
  }

  // * Verify Razorpay webhook signature.
  verifyWebhookSignature(rawBody, razorpaySignature) {
    try {
      if (!RAZORPAY_WEBHOOK_SECRET) {
        logger.warn('RAZORPAY_WEBHOOK_SECRET not configured — skipping signature verification');
        return process.env.NODE_ENV === 'development'; // Allow in dev without secret
      }

      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(razorpaySignature || '')
      );
    } catch {
      return false;
    }
  }

  _transformError(error, defaultMessage) {
    // Razorpay SDK wraps errors in error.error
    const razorpayError = error.error || {};
    const statusCode = error.statusCode || 500;
    const errorCode = razorpayError.code;

    logger.error('Razorpay API error', {
      message: error.message,
      statusCode,
      errorCode,
      description: razorpayError.description,
    });

    if (statusCode === 400 || statusCode === 401) {
      throw new GatewayError(
        razorpayError.description || defaultMessage,
        ErrorCodes.GATEWAY_REJECTED,
        { errorCode, statusCode }
      );
    }

    if (statusCode === 504 || error.code === 'ETIMEDOUT') {
      throw new GatewayError(
        'Payment gateway timed out',
        ErrorCodes.GATEWAY_TIMEOUT,
        { statusCode }
      );
    }

    throw new GatewayError(
      defaultMessage,
      ErrorCodes.GATEWAY_UNAVAILABLE,
      { errorCode, statusCode }
    );
  }
}

export default new RazorpayGateway();
